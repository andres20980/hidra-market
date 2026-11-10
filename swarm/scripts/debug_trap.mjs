import { Sandbox } from 'near-sandbox';
import { Near } from 'near-api-js';
import { InMemoryKeyStore } from 'near-api-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = join(HERE, '..', '..', 'contract', 'target', 'wasm32-unknown-unknown', 'release', 'contract.wasm');

async function run() {
  const sandbox = await Sandbox.start();
  const root = sandbox.rootAccount.id;
  const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
  const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });
  const market = `market.${root}`;

  try {
    const wasm = readFileSync(WASM);
    console.log('Deploying contract...');
    await near.transaction(root).createAccount(market).transfer(market, '50 NEAR').deployContract(market, wasm).send();
    
    console.log('Calling init...');
    // Intentamos con un valor u128 válido (100 NEAR = 100 * 10^22 yoctoNEAR)
    const cap = "1000000000000000000000000"; 
    await near.transaction(root).functionCall(market, 'init', cap, { gas: '60 Tgas' }).send();
    console.log('Init success!');
  } catch (e) {
    console.error('Error during execution:', e);
  } finally {
    await sandbox.stop();
  }
}
run();
