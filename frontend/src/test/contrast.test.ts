import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Color = [number, number, number];
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function palette(selector: string) {
  const values: Record<string, Color> = {};
  const blocks = css.matchAll(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]+)}`, "g"));
  for (const block of blocks) {
    for (const match of (block[1] ?? "").matchAll(
      /--([\w-]+):\s*oklch\(([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\)/g,
    )) {
      values[match[1]!] = [Number(match[2]), Number(match[3]), Number(match[4])];
    }
  }
  return values;
}

// WCAG relative luminance after Oklab-to-linear-sRGB conversion and gamut clipping.
function luminance([l, c, h]: Color) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const ll = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * ll - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.reduce(
    (sum, value, index) => sum + Math.max(0, Math.min(1, value)) * [0.2126, 0.7152, 0.0722][index]!,
    0,
  );
}
function contrast(a: Color, b: Color) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}

describe("theme text contrast", () => {
  for (const theme of ["light", "dark"]) {
    const colors = { ...palette(":root"), ...(theme === "dark" ? palette(".dark") : {}) };
    for (const foreground of [
      "foreground",
      "muted-foreground",
      "primary",
      "success",
      "warning",
      "destructive",
    ]) {
      for (const background of ["background", "card", "muted"]) {
        it(`${theme} ${foreground} text on ${background} meets 4.5:1`, () => {
          expect(contrast(colors[foreground]!, colors[background]!)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme} primary button text meets 4.5:1`, () => {
      expect(contrast(colors["primary-foreground"]!, colors["primary"]!)).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});
