// contrast.test.ts v1.0 — WCAG AA contrast guard for the color tokens in src/style.css
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const m = css.match(new RegExp(selector + "\\s*\\{([^}]*)\\}"));
  if (!m) throw new Error("missing block " + selector);
  const vars: Record<string, string> = {};
  for (const v of m[1].matchAll(/--([a-z]+):\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    const h = v[2];
    vars[v[1]] = h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h;
  }
  return vars;
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = [
  [":root", block(":root")],
  ["[data-theme='dark']", block("[data-theme='dark']")],
] as const;

describe("WCAG AA contrast of style tokens", () => {
  it.each(themes)("text and states pass AA in %s", (_sel, v) => {
    expect(ratio(v.fg, v.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v.muted, v.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v.ok, v.panel)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v.bad, v.panel)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(themes)("accent (focus ring, borders) passes 3:1 in %s", (_sel, v) => {
    expect(ratio(v.accent, v.panel)).toBeGreaterThanOrEqual(3);
    expect(ratio(v.accent, v.bg)).toBeGreaterThanOrEqual(3);
  });
});
