// ตาราง Time Step ของ STK (spec §6.1, จาก stk/map-01a.htm) หน่วยวินาที 32 ค่า
export const STEPS_S: readonly number[] = [
  0.0001, 0.0005, 0.001, 0.005, 0.01, 0.1, 0.5, 1, 3, 5, 10, 30, 60, 180, 300, 600, 1800, 3600, 7200, 14400, 28800,
  57600, 115200, 230400, 460800, 921600, 1843200, 3686400, 7372800, 14745600, 29491200, 31536000,
];

/** Increase Time Step: ค่าในตารางที่น้อยที่สุดที่มากกว่า `s` เกินปลายตารางคงที่ค่าสูงสุด */
export function nextStep(s: number): number {
  return STEPS_S.find((v) => v > s) ?? STEPS_S[STEPS_S.length - 1];
}

/** Decrease Time Step: ค่าในตารางที่มากที่สุดที่น้อยกว่า `s` เกินปลายตารางคงที่ค่าต่ำสุด */
export function prevStep(s: number): number {
  return STEPS_S.findLast((v) => v < s) ?? STEPS_S[0];
}

/** W18: `"60.00 sec"` ค่า ≥ 0.01 ทศนิยม 2 หลัก ค่าน้อยกว่าทศนิยม 4 หลัก */
export function formatStep(s: number): string {
  return `${s.toFixed(s >= 0.01 ? 2 : 4)} sec`;
}
