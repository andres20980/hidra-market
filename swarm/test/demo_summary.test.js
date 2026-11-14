// demo_summary.test.js v1.0
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("demo headline provenance", () => {
  it("separates the measured-ledger headline from the simulated benchmark", () => {
    const root = resolve(import.meta.dirname, "../..");
    const baseline = JSON.parse(readFileSync(resolve(root, "swarm/out/baseline_compare.json"), "utf8"));
    const output = execFileSync("python3", [
      resolve(root, "scripts/demo_summary.py"), "--root", root, "--since", "0",
    ], { encoding: "utf8" });
    const headlines = output.split("\n").filter((line) => line.includes("Headline"));
    expect(headlines).toHaveLength(1);
    expect(headlines[0]).toContain(`${baseline.ahorro_real.factor_coste.toFixed(1)}x cheaper per verified result`);
    expect(headlines[0]).not.toMatch(/40x|4000/);
    expect(output).toMatch(/Benchmark\s+simulated benchmark scenario:.*40x/);
  });
});
