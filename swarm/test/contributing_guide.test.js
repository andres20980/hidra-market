// test/contributing_guide.test.js v1.0
// Sustainability lock: CONTRIBUTING.md must stay honest. Every `npm run X` it
// cites has to exist in package.json, and the non-negotiable maintenance rules
// (single gate, dataset freeze, testnet budget cap, .env-only secrets) must be
// present. Fails if the guide drifts from the real scripts or drops a rule.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const guide = readFileSync(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const scripts = pkg.scripts;

describe("CONTRIBUTING.md stays pinned to real scripts and rules", () => {
  it("every `npm run <script>` it cites exists in package.json", () => {
    const cited = [...guide.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
    expect(cited.length).toBeGreaterThan(0);
    const missing = [...new Set(cited)].filter((s) => !(s in scripts));
    expect(missing).toEqual([]);
  });

  it("points to the single delivery gate `verify:all`", () => {
    expect(guide).toContain("npm run verify:all");
    expect("verify:all" in scripts).toBe(true);
  });

  it("keeps the dataset-freeze rule", () => {
    expect(guide).toMatch(/CONGELADO/);
    expect(guide).toContain("data/hidra_week.jsonl");
  });

  it("keeps the testnet budget cap and .env-only secrets rule", () => {
    expect(guide).toMatch(/2,5 NEAR/);
    expect(guide).toContain(".env");
    expect(guide).toMatch(/nunca mainnet/i);
  });
});
