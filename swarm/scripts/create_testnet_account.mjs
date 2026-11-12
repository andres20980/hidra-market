// create_testnet_account.mjs v1.0 - create a faucet-funded NEAR testnet account and write swarm/.env (mode 600)
// Same faucet as near-cli-rs `sponsor-by-faucet-service`. The private key is written to .env only, never printed.
// Usage: node scripts/create_testnet_account.mjs [account-id.testnet]   (refuses if .env already holds a live account)
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { KeyPair } from "near-api-js";

const RPC = "https://test.rpc.fastnear.com";
const FAUCET = process.env.NEAR_FAUCET_URL || "https://helper.nearprotocol.com/account";
const ENV = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");

const rpc = async (method, params) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
};
const viewAccount = (accountId) =>
  rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });

const readEnv = () => {
  if (!existsSync(ENV)) return {};
  return Object.fromEntries(
    readFileSync(ENV, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]),
  );
};

const current = readEnv();
if (current.NEAR_ACCOUNT_ID) {
  const r = await viewAccount(current.NEAR_ACCOUNT_ID);
  if (r.result) {
    console.error(`BLOCKED: .env already holds live account ${current.NEAR_ACCOUNT_ID}; not overwriting`);
    process.exit(2);
  }
}

const accountId = process.argv[2] || `hidra-mkt-${String(randomInt(0, 1e6)).padStart(6, "0")}.testnet`;
if (!/^[a-z0-9-]+\.testnet$/.test(accountId)) {
  console.error("BLOCKED: account id must be a top-level <name>.testnet");
  process.exit(2);
}
const key = KeyPair.fromRandom("ed25519");
const res = await fetch(FAUCET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
});
const body = (await res.text()).slice(0, 300);
if (!res.ok) {
  console.error(`FAIL: faucet HTTP ${res.status}: ${body}`);
  process.exit(1);
}

let account = null;
for (let i = 0; i < 30 && !account; i++) {
  const r = await viewAccount(accountId);
  if (r.result) account = r.result;
  else await new Promise((ok) => setTimeout(ok, 2000));
}
if (!account) {
  console.error(`FAIL: ${accountId} not visible on RPC after faucet HTTP ${res.status}`);
  process.exit(1);
}

const lines = [
  "# swarm/.env - NEAR testnet credentials (git-ignored, mode 600). Never commit.",
  `NEAR_ACCOUNT_ID=${accountId}`,
  `NEAR_PRIVATE_KEY=${key.toString()}`,
  `NEAR_CONTRACT_ID=market.${accountId}`,
  `NEAR_RPC_URL=${RPC}`,
  current.NEAR_SANDBOX_BIN_PATH ? `NEAR_SANDBOX_BIN_PATH=${current.NEAR_SANDBOX_BIN_PATH}` : "",
].filter(Boolean);
writeFileSync(ENV, lines.join("\n") + "\n", { mode: 0o600 });
chmodSync(ENV, 0o600);
console.log(`OK ${accountId}: balance ${(BigInt(account.amount) / 10n ** 21n).toString()} mNEAR, public key ${key.getPublicKey().toString()}`);
