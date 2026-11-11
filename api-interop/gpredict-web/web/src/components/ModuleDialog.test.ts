import { describe, expect, it } from "vitest";
import { validateModuleForm } from "../moduleForm";

// File → New module: what OK does with the form (ref §3 "Errors", mod-cfg.c:966 and :69-70)

const form = (over: Partial<{ name: string; qth: string | null; satellites: number[] }> = {}) => ({
  name: "Amateur",
  qth: null,
  satellites: [25544],
  ...over,
});

describe("validateModuleForm", () => {
  it("accepts a new module with a good name and at least one satellite", () => {
    expect(validateModuleForm(form(), [])).toEqual({});
    expect(validateModuleForm(form({ name: "a".repeat(25) }), ["Weather"])).toEqual({});
  });

  it("asks to select a satellite, in Gpredict's words, when there is none", () => {
    expect(validateModuleForm(form({ satellites: [] }), [])).toEqual({ error: "Please select at least one satellite from the list." });
  });

  it("asks before overwriting a module with the same name, in Gpredict's words", () => {
    expect(validateModuleForm(form({ name: "X" }), ["X", "Y"])).toEqual({
      confirmOverwrite: "There is already a module called X.\nDo you want to overwrite this module?",
    });
  });

  it("names the module of the dialog in the question", () => {
    expect(validateModuleForm(form({ name: "Amateur" }), ["Amateur"]).confirmOverwrite).toBe(
      "There is already a module called Amateur.\nDo you want to overwrite this module?",
    );
  });

  it("refuses a name of 26 characters", () => {
    const r = validateModuleForm(form({ name: "a".repeat(26) }), []);
    expect(r.error).toBe("ชื่อ module ต้องเป็นตัวอักษร A-Z, a-z, ตัวเลข, _ หรือ - ยาว 1-25 ตัว");
    expect(r.confirmOverwrite).toBeUndefined();
  });

  it("refuses a name with a space or another character that is not allowed", () => {
    for (const name of ["my module", "a/b", "ไทย", "a.b", "a\n"]) {
      expect(validateModuleForm(form({ name }), []).error, name).toBeDefined();
    }
  });

  it("refuses an empty name (the OK button is off then in the dialog)", () => {
    expect(validateModuleForm(form({ name: "" }), []).error).toBeDefined();
  });

  it("checks the name before the satellites, and the satellites before the name that is taken (Gpredict's order)", () => {
    expect(validateModuleForm(form({ name: "a b", satellites: [] }), ["a b"]).error).toContain("ชื่อ module");
    expect(validateModuleForm(form({ name: "X", satellites: [] }), ["X"])).toEqual({
      error: "Please select at least one satellite from the list.",
    });
  });

  it("refuses a name that differs from a module's only in case: the files would be the same on a disk that ignores case", () => {
    const r = validateModuleForm(form({ name: "amateur" }), ["Amateur"]);
    expect(r.error).toBe("มี module ชื่อ Amateur อยู่แล้ว ชื่อที่ต่างกันแค่ตัวพิมพ์เล็ก-ใหญ่ใช้ด้วยกันไม่ได้");
    expect(r.confirmOverwrite).toBeUndefined();
  });

  it("refuses to overwrite a module that is open, and points to Configure (ของเรา)", () => {
    const r = validateModuleForm(form({ name: "Amateur" }), ["Amateur", "Weather"], ["Amateur"]);
    expect(r.error).toBe("module Amateur เปิดอยู่ แก้ไขได้จาก Module → Configure (ถ้าจะสร้างใหม่ทับ ให้ปิด module ก่อน)");
    expect(r.confirmOverwrite).toBeUndefined();
  });

  it("asks about a module that exists but is closed even when others are open", () => {
    expect(validateModuleForm(form({ name: "Weather" }), ["Amateur", "Weather"], ["Amateur"]).confirmOverwrite).toBeDefined();
  });
});
