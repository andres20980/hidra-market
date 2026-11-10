import { Near, InMemoryKeyStore } from "near-kit";
import { Sandbox } from "near-kit/sandbox";

const sandbox = await Sandbox.start();
const root = sandbox.rootAccount.id;
const keyStore = new InMemoryKeyStore({ [root]: sandbox.rootAccount.secretKey });
const near = new Near({ network: sandbox, keyStore, defaultSignerId: root });

console.log("Initial block height:", await near.view(root, "get_block_height", {})); 
// Note: get_block_height might not exist on root, but we can check the sandbox state.
