import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Near, InMemoryKeyStore } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, "..", "..", "contract", "target", "wasm32-unknown-unknown", "release", "contract.wasm");

const sandbox = await Sandbox.start();
const root = sandbox.rootAccount.id;
const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });

const market = `market.${root}`;
try {
    const wasm = readFileSync(WASM);
    await near.transaction(root).createAccount(market).transfer(market, "50 NEAR").deployContract(market, wasm).send();
    console.log("Contract deployed");
    await near.transaction(root).functionCall(market, "init", { cap_per_agent: "100000000000000000000000000" }, { gas: "60 Tgas" }).send();
    console.log("Contract initialized with object");
} catch (e) {
    console.error("Error:", e);
}
