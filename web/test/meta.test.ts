// meta.test.ts v1.0 — document head metadata for link previews and theming
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const has = (needle: string) => html.includes(needle);

describe("index.html metadata", () => {
  it("declares the language and the viewport", () => {
    expect(has('<html lang="es">')).toBe(true);
    expect(has('name="viewport"')).toBe(true);
  });

  it("describes the page for search engines and social previews", () => {
    expect(has('name="description"')).toBe(true);
    expect(has('property="og:type"')).toBe(true);
    expect(has('property="og:title"')).toBe(true);
    expect(has('property="og:description"')).toBe(true);
    expect(has('name="twitter:card"')).toBe(true);
  });

  it("honours light/dark colour schemes on mobile", () => {
    expect(has('name="color-scheme" content="light dark"')).toBe(true);
    expect(has('media="(prefers-color-scheme: light)"')).toBe(true);
    expect(has('media="(prefers-color-scheme: dark)"')).toBe(true);
  });
});
