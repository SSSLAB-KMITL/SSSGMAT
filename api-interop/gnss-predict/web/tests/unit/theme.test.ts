import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const WEB_ROOT = resolve(import.meta.dirname, "../..");

/** ตัวแปร CSS (`--name: value;`) ทุกตัวในไฟล์ CSS ที่ path เทียบกับโฟลเดอร์ web/ (ตัดคอมเมนต์ก่อนอ่าน) */
function readCssVars(path: string): Record<string, string> {
  const css = readFileSync(resolve(WEB_ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/** relative luminance ตาม WCAG 2.1 ของสี #rgb หรือ #rrggbb */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** contrast ratio ตาม WCAG 2.1: (L1 + 0.05) / (L2 + 0.05) โดย L1 คือค่าที่สว่างกว่า */
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast() follows WCAG 2.1", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#fff", "#fff")).toBeCloseTo(1, 5);
  expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);   // เกณฑ์ AA: #767676 บนขาวพอดีเกิน 4.5
  expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
});

test("every token of the theme contract exists", () => {
  const v = readCssVars("src/theme.css");
  for (const name of ["--bg", "--panel", "--border", "--text", "--text-muted", "--menu-bg", "--menu-text",
                      "--titlebar-bg", "--titlebar-active-bg", "--titlebar-active-text", "--selected-bg", "--selected-text",
                      "--danger", "--warning", "--font-ui", "--font-mono", "--font-size",
                      "--color-gps", "--color-glonass", "--color-galileo", "--color-beidou", "--color-facility", "--color-access"])
    expect(v[name], name).toBeTruthy();
});

test("text tokens meet WCAG AA on their backgrounds", () => {
  const v = readCssVars("src/theme.css");
  for (const [fg, bg] of [["--text", "--bg"], ["--text", "--panel"], ["--text-muted", "--panel"],
                          ["--menu-text", "--menu-bg"], ["--selected-text", "--selected-bg"],
                          ["--titlebar-active-text", "--titlebar-active-bg"],
                          // แท็บหน้าต่าง dockview ที่ไม่ได้เลือก (วางบนแถบชื่อ)
                          ["--text", "--titlebar-bg"], ["--text-muted", "--titlebar-bg"]])
    expect(contrast(v[fg], v[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
});

test("system colour tokens exist with the spec §14 hues", () => {
  const v = readCssVars("src/theme.css");
  expect(v["--color-gps"]).toBe("#ffd23f"); expect(v["--color-glonass"]).toBe("#ff6b6b");
  expect(v["--color-galileo"]).toBe("#4fd47e"); expect(v["--color-beidou"]).toBe("#45c8ff");
  expect(v["--color-facility"]).toBe("#ff79e6"); expect(v["--color-access"]).toBe("#9dff6b");
  expect(v["--font-size"]).toBe("12px");
});

test("the dockview theme maps every tab and surface variable onto the tokens, with no raw hex colours", () => {
  const css = readFileSync(resolve(WEB_ROOT, "src/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /\.dockview-theme-gnss\s*\{([^}]*)\}/.exec(css)?.[1];
  expect(block, ".dockview-theme-gnss block").toBeTruthy();
  const vars = Object.fromEntries([...block!.matchAll(/(--dv-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  for (const name of ["--dv-group-view-background-color", "--dv-tabs-and-actions-container-background-color", "--dv-tabs-and-actions-container-height",
                      "--dv-activegroup-visiblepanel-tab-background-color", "--dv-activegroup-visiblepanel-tab-color",
                      "--dv-activegroup-hiddenpanel-tab-background-color", "--dv-activegroup-hiddenpanel-tab-color",
                      "--dv-inactivegroup-visiblepanel-tab-background-color", "--dv-inactivegroup-visiblepanel-tab-color",
                      "--dv-inactivegroup-hiddenpanel-tab-background-color", "--dv-inactivegroup-hiddenpanel-tab-color",
                      "--dv-separator-border", "--dv-floating-border", "--dv-floating-box-shadow"])
    expect(vars[name], name).toBeTruthy();
  expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  // แท็บที่ active ใช้คู่เดียวกับแถบชื่อ: ตัวอักษรขาวบนน้ำเงินเข้ม และแท็บที่เห็นอยู่ของกลุ่มที่ไม่ active ใช้พื้น panel
  expect(vars["--dv-activegroup-visiblepanel-tab-background-color"]).toBe("var(--titlebar-active-bg)");
  expect(vars["--dv-activegroup-visiblepanel-tab-color"]).toBe("var(--titlebar-active-text)");
  expect(vars["--dv-inactivegroup-visiblepanel-tab-background-color"]).toBe("var(--panel)");
  expect(vars["--dv-inactivegroup-visiblepanel-tab-color"]).toBe("var(--text)");
});
