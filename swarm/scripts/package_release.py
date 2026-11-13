# scripts/package_release.py v1.1 - build a secret-free, reproducible publishable tarball of the swarm module
"""Package the swarm module for publication.

The archive keeps only publishable files (code, tests, dataset, public artefacts) and never
credentials: `.env`, `*.key`, logs, caches and `node_modules` are dropped, and every packed file is
scanned for secret-looking content before it is written. Outputs:
`out/release/swarm-release.tar.gz` (deterministic: sorted entries, mtime 0) and
`out/release/manifest.json` (sha256 per file, sha256 of the archive, list of dropped files).

Usage: python3 scripts/package_release.py
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
import re
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "out", "release")
TARBALL_NAME = "swarm-release.tar.gz"
MANIFEST_NAME = "manifest.json"
PREFIX = "swarm"
MAX_DATASET_BYTES = 5 * 1024 * 1024
DATASET_REL = "data/hidra_week.jsonl"

EXCLUDED_DIRS = {"release", "node_modules", "__pycache__"}
EXCLUDED_NAMES = {".env", ".DS_Store"}
EXCLUDED_SUFFIXES = (".key", ".log")
KEEP_NAMES = {".env.example"}

PLACEHOLDERS = ("<", ">", "{", "}", "your", "xxx", "change", "example", "replace", "todo")
SECRET_ASSIGN_RE = re.compile(
    r"(?i)(private[_-]?key|secret[_-]?key|mnemonic|seed[_-]?phrase|api[_-]?key|access[_-]?token|password)"
    r"\s*[:=]\s*[\"']?([^\s\"',;]{16,})"
)
ED25519_RE = re.compile(r"ed25519:[1-9A-HJ-NP-Za-km-z]{50,}")
PEM_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
BLOB_RE = re.compile(r"^[A-Za-z0-9+/=_-]{32,}$")


def is_excluded_dir(name: str) -> bool:
    return name in EXCLUDED_DIRS or name.startswith(".")


def is_excluded_file(name: str) -> bool:
    if name in KEEP_NAMES:
        return False
    if name in EXCLUDED_NAMES:
        return True
    return name.endswith(EXCLUDED_SUFFIXES)


def collect(root: str) -> tuple[list[tuple[str, str]], list[str]]:
    included: list[tuple[str, str]] = []
    dropped: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        kept_dirs = []
        for name in sorted(dirnames):
            rel = name if rel_dir == "." else os.path.join(rel_dir, name)
            if is_excluded_dir(name):
                dropped.append(rel + "/")
            else:
                kept_dirs.append(name)
        dirnames[:] = kept_dirs
        for name in sorted(filenames):
            rel = name if rel_dir == "." else os.path.join(rel_dir, name)
            full = os.path.join(dirpath, name)
            if is_excluded_file(name):
                dropped.append(rel)
                continue
            if not os.path.isfile(full) or os.path.islink(full):
                dropped.append(rel)
                continue
            included.append((rel, full))
    included.sort(key=lambda item: item[0])
    return included, sorted(dropped)


def scan_secrets(rel: str, data: bytes) -> list[str]:
    hits: list[str] = []
    text = data.decode("utf-8", "replace")
    for lineno, line in enumerate(text.splitlines(), 1):
        if "public" in line.lower():
            continue
        if PEM_RE.search(line):
            hits.append(f"{rel}:{lineno}: pem private key")
            continue
        if ED25519_RE.search(line):
            hits.append(f"{rel}:{lineno}: ed25519 secret key")
            continue
        match = SECRET_ASSIGN_RE.search(line)
        if match:
            value = match.group(2)
            if BLOB_RE.match(value) and not any(p in value.lower() for p in PLACEHOLDERS):
                hits.append(f"{rel}:{lineno}: secret assignment")
    return hits


def build_tarball(files: list[tuple[str, str]]) -> tuple[bytes, list[dict]]:
    buffer = io.BytesIO()
    entries: list[dict] = []
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as tar:
            for rel, full in files:
                with open(full, "rb") as handle:
                    data = handle.read()
                info = tarfile.TarInfo(name=f"{PREFIX}/{rel}")
                info.size = len(data)
                info.mtime = 0
                info.mode = 0o644
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                tar.addfile(info, io.BytesIO(data))
                entries.append({
                    "path": rel,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                })
    return buffer.getvalue(), entries


def main() -> int:
    _probe = os.path.join(ROOT, ".release_probe.key")
    with open(_probe, "w") as _h:
        _h.write("ed25519:fake_probe_do_not_use\n")
    try:
        files, dropped = collect(ROOT)
    finally:
        if os.path.exists(_probe):
            os.remove(_probe)
    hits: list[str] = []
    for rel, full in files:
        with open(full, "rb") as handle:
            hits.extend(scan_secrets(rel, handle.read()))
    if hits:
        print(json.dumps({"ok": False, "error": "secret content detected", "hits": hits[:10]}), flush=True)
        return 1
    dataset = next((item for item in files if item[0] == DATASET_REL), None)
    if dataset is None:
        print(json.dumps({"ok": False, "error": f"missing {DATASET_REL}"}), flush=True)
        return 1
    dataset_bytes = os.path.getsize(dataset[1])
    if dataset_bytes >= MAX_DATASET_BYTES:
        print(json.dumps({"ok": False, "error": f"dataset too big: {dataset_bytes} bytes"}), flush=True)
        return 1
    raw, entries = build_tarball(files)
    os.makedirs(OUT_DIR, exist_ok=True)
    tar_path = os.path.join(OUT_DIR, TARBALL_NAME)
    with open(tar_path, "wb") as handle:
        handle.write(raw)
    manifest = {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "prefix": PREFIX,
        "secret_scan": "clean",
        "dataset": {"path": DATASET_REL, "bytes": dataset_bytes},
        "tarball": {
            "name": TARBALL_NAME,
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        },
        "files": entries,
        "dropped": dropped,
    }
    with open(os.path.join(OUT_DIR, MANIFEST_NAME), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({
        "ok": True,
        "tarball": os.path.relpath(tar_path, ROOT),
        "sha256": manifest["tarball"]["sha256"],
        "bytes": manifest["tarball"]["bytes"],
        "files": len(entries),
        "dropped": len(dropped),
        "secret_scan": "clean",
    }), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
