// คำขอแก้รายการ access ของ scenario (server §6.6): POST /access/compute|clear|remove ทีละ body ผ่านคิวการเขียนของ useScenario
// (ETag ของคำขอก่อนหน้าไปกับคำขอถัดไป โหลด doc ใหม่ครั้งเดียวหลังเขียน 412 = กล่อง Reload / Cancel ของทั้งแอป)
// ใช้ร่วมกันระหว่าง Access tool และการคำนวณใหม่ของหน้าต่างรายงาน/กราฟ (Report.tsx recompute)

import { useScenario } from "../stores/scenario";
import { recordQueuedJob } from "./startJob";

export type AccessAction = "compute" | "clear" | "remove";

/** body ของคำขอ: compute ใส่ time_period / graphics / timeline เพิ่มได้ */
export interface AccessBody {
  from: string;
  to: string[] | "all";
  [key: string]: unknown;
}

export interface AccessPostResult {
  /** job analyze ที่ได้จากคำตอบ 202 (บันทึกเป็น queued ใน useJobs แล้ว) */
  jobs: string[];
  /** Clear / Remove: จำนวน access ที่ตรงรวมทุกคำขอ (compute = 0) */
  matched: number;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * ส่ง bodies ไปตามลำดับ คืน job และจำนวนที่ตรง ผิดพลาดโยนต่อ (job ของคำขอก่อนหน้าที่สำเร็จถูกบันทึกแล้ว)
 * name = scenario ที่สั่ง (ไม่ใช่ตัวที่เปิดอยู่ = โยนโดยไม่ส่ง)
 */
export async function postAccess(name: string, action: AccessAction, bodies: readonly AccessBody[]): Promise<AccessPostResult> {
  const result: AccessPostResult = { jobs: [], matched: 0 };
  const key = action === "clear" ? "cleared" : action === "remove" ? "removed" : null;
  await useScenario.getState().postEach(name, `/access/${action}`, bodies, (data) => {
    if (!isRecord(data)) return;
    if (typeof data.job === "string") {
      recordQueuedJob(data.job, "analyze", name);
      result.jobs.push(data.job);
    }
    const n = key === null ? null : data[key];
    if (typeof n === "number" && n > 0) result.matched += n;
  });
  return result;
}
