// ที่มาของแต่ละ enum ใน ENUMS: [model, property] ใน components.schemas ของ src/api/openapi.json ที่ประกาศ Literal นั้น
// ตัวที่ 3 (ถ้ามี) คือที่อื่นที่ใช้ alias เดียวกัน ต้องได้ค่าเท่ากัน
// ใช้ร่วมกันระหว่าง tools/gen-enums.mjs (สร้างไฟล์) กับ tests/unit/enums.test.ts (ตรวจว่าไฟล์ตรงกับ openapi.json)
export const SOURCES = {
  MarkerStyle: ["Graphics2DSat", "marker_style", [["Graphics2DFac", "marker_style"]]],
  LineStyle: ["Graphics2DSat", "line_style"],
  LeadType: ["PassSettings", "lead_type"],
  TrailType: ["PassSettings", "trail_type"],
  VisibleSides: ["PassSettings", "visible_sides"],
  SwathOptions: ["SwathSettings", "options"],
  OrbitSystem: ["Graphics3DSat", "orbit_system"],
  UpdateMode: ["Animation", "update_mode"],
  Cycle: ["Animation", "cycle"],
  DateFormat: ["Units", "date_format"],
};
