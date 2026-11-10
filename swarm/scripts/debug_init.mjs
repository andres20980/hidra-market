// debug_init.mjs v1.1
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Near, InMemoryKeyStore } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WASM = join(HERE, "..", "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm");
const enc = (s) => new TextEncoder().encode(s);
const variants = [
  ["num_small", { cap_per_agent: 10000 }],
  ["raw_bignum", enc('{"cap_per_agent":100000000000000000000000000}')],
  ["raw_string", enc('{"cap_per_agent":"100000000000000000000000000"}')],
];
const sandbox = await Sandbox.start();
const root = sandbox.rootAccount.id;
const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });
try {
  for (const [name, args] of variants) {
    const id = `m${Math.random().toString(36).slice(2, 6)}.${root}`;
    await near.transaction(root).createAccount(id).transfer(id, "50 NEAR").deployContract(id, readFileSync(WASM)).send();
    try {
      await near.call(id, "init", args);
      console.log(`OK ${name}`);
    } catch (e) {
      console.log(`FAIL ${name}: ${String(e).split("\n").find((l) => l.includes("panicked")) || String(e).slice(0, 100)}`);
    }
  }
} finally {
  await sandbox.stop();
}
