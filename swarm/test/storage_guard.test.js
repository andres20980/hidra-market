// storage_guard.test.js v1.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEPLOY_TX, EXPECTED_CODE_HASH, EXPECTED_WASM_SHA256, GUARDED_METHODS, inspectCode,
} from "../scripts/prove_storage_guard_testnet.mjs";
import { REQUIRE_MESSAGE } from "../scripts/prove_round_spam_testnet.mjs";

const proof = JSON.parse(readFileSync(new URL("../out/testnet_storage_guard.json", import.meta.url)));
const redeploy = JSON.parse(readFileSync(new URL("../out/testnet_redeploy.json", import.meta.url)));

describe("storage guard proof (offline)", () => {
  it("inspectCode hashes and detects the require message and guarded methods", () => {
    const fake = Buffer.concat([Buffer.from("\0asm"), Buffer.from(REQUIRE_MESSAGE), Buffer.from(GUARDED_METHODS.join(" "))]);
    const r = inspectCode(fake.toString("base64"));
    expect(r.wasm_bytes).toBe(fake.length);
    expect(r.require_message_embedded).toBe(true);
    expect(r.methods_exported).toEqual(GUARDED_METHODS);
    expect(inspectCode(Buffer.from("\0asm").toString("base64")).require_message_embedded).toBe(false);
  });

  it("live proof: deployed code is byte-for-byte the LISTO-DEPLOY wasm", () => {
    expect(proof.live_code_matches_listo_deploy).toBe(true);
    expect(proof.wasm_sha256).toBe(EXPECTED_WASM_SHA256);
    expect(proof.code_hash).toBe(EXPECTED_CODE_HASH);
    expect(proof.require_message_embedded).toBe(true);
    expect(proof.guard_satisfied).toBe(true);
  });

  it("is consistent with the code-only redeploy record", () => {
    expect(redeploy.action).toBe("deploy_code_only");
    expect(redeploy.wasm_sha256).toBe(EXPECTED_WASM_SHA256);
    expect(redeploy.code_hash_after).toBe(EXPECTED_CODE_HASH);
    expect(redeploy.tx).toBe(DEPLOY_TX);
    expect(proof.deploy_tx).toBe(DEPLOY_TX);
  });
});
