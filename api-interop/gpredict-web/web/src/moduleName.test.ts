import { describe, expect, it } from "vitest";
import { cloneNameError, isModuleName, MODULE_NAME_MAX, NAME_TIP, sanitizeModuleName } from "./moduleName";

describe("sanitizeModuleName (Gpredict's entry deletes a character that is not allowed as it is typed)", () => {
  it("keeps 0..9, a..z, A..Z, - and _", () => {
    expect(sanitizeModuleName("Amateur_2-b")).toBe("Amateur_2-b");
  });

  it("removes spaces, dots, slashes and Thai letters", () => {
    expect(sanitizeModuleName("my module/../ก")).toBe("mymodule");
  });

  it("cuts the name to 25 characters", () => {
    expect(MODULE_NAME_MAX).toBe(25);
    expect(sanitizeModuleName("a".repeat(30))).toBe("a".repeat(25));
  });
});

describe("isModuleName (same rule as the server: ^[A-Za-z0-9_-]{1,25}$)", () => {
  it("accepts 1 to 25 allowed characters", () => {
    expect(isModuleName("a")).toBe(true);
    expect(isModuleName("a".repeat(25))).toBe(true);
  });

  it("refuses an empty name, 26 characters and anything with a space", () => {
    expect(isModuleName("")).toBe(false);
    expect(isModuleName("a".repeat(26))).toBe(false);
    expect(isModuleName("a b")).toBe(false);
    expect(isModuleName("a\n")).toBe(false);
  });
});

describe("cloneNameError", () => {
  const existing = ["Amateur", "Weather"];

  it("is null for a free, valid name", () => {
    expect(cloneNameError("Amateur2", existing)).toBeNull();
  });

  it("is null for an empty name: the OK button is off then, and no error is shown (Gpredict)", () => {
    expect(cloneNameError("", existing)).toBeNull();
  });

  it("names the module in Thai when the name is taken, ignoring case like the server", () => {
    expect(cloneNameError("Amateur", existing)).toBe("มี module ชื่อ Amateur อยู่แล้ว");
    expect(cloneNameError("weather", existing)).toBe("มี module ชื่อ Weather อยู่แล้ว");
  });

  it("says in Thai which characters are allowed when the name is not valid", () => {
    expect(cloneNameError("a b", existing)).toBe("ชื่อ module ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว");
    expect(cloneNameError("a".repeat(26), existing)).toBe("ชื่อ module ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว");
  });
});

describe("NAME_TIP", () => {
  it("is the tooltip of Gpredict's name entry", () => {
    expect(NAME_TIP).toBe("Enter a short name for this module.\nAllowed characters: 0..9, a..z, A..Z, - and _");
  });
});
