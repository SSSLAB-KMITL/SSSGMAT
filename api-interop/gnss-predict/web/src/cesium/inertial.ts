// Orbit System = Inertial by Window (spec §9.2): วาดเส้นทางของดาวในกรอบ inertial เพื่อการแสดงผลเท่านั้น (ไม่ใช่ผลคำนวณ)
//
// ตำแหน่งใน CZML เป็น Earth-fixed (FIXED) ณ เวลาของแต่ละตัวอย่าง: หมุนกลับเป็น TEME ด้วย M(tᵢ)ᵀ แล้วหมุนเป็น fixed ณ เวลาอ้างอิงด้วย M(ref)
//   pᵢ' = M(ref) · M(tᵢ)ᵀ · pᵢ   เมื่อ M(t) = Transforms.computeTemeToPseudoFixedMatrix(t) (หมุนรอบแกน z ตาม GMST)
// ผลยังเป็นพิกัด FIXED จึงวาดเป็น polyline ของ entity ได้ตรง ๆ: ที่ tᵢ = ref ได้จุดเดิม ส่วนจุดอื่นเป็นวงโคจรที่ไม่ถูกโลกหมุนบิด
// (pseudo-fixed ไม่รวม polar motion ซึ่งเล็กกว่าที่ตาเห็นมาก)

import { Cartesian3, Matrix3, Transforms, type JulianDate } from "cesium";

export interface PositionSample {
  t: JulianDate;
  /** ตำแหน่ง Earth-fixed (เมตร) ณ t */
  p: Cartesian3;
}

/** ตำแหน่งของตัวอย่างในกรอบ inertial ที่ตรึงไว้ ณ ref แสดงเป็นพิกัด FIXED ของเวลา ref (ไม่แก้ค่าของ samples) */
export function toInertial(samples: readonly PositionSample[], ref: JulianDate): Cartesian3[] {
  if (samples.length === 0) return [];
  const atRef = Transforms.computeTemeToPseudoFixedMatrix(ref, new Matrix3());
  const m = new Matrix3();
  const back = new Matrix3();
  const teme = new Cartesian3();
  return samples.map(({ t, p }) => {
    Transforms.computeTemeToPseudoFixedMatrix(t, m);
    Matrix3.transpose(m, back); // เมทริกซ์หมุน: ผกผัน = transpose
    Matrix3.multiplyByVector(back, p, teme);
    return Matrix3.multiplyByVector(atRef, teme, new Cartesian3());
  });
}
