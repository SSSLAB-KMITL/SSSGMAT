// สั่งงานที่ server ทำเบื้องหลัง (POST แล้วตอบ 202 {job}) และบอก store ของงานทันที
//
// event `job` ของ SSE (state queued) อาจมาถึงช้ากว่าคำตอบของ POST: กล่อง "งานล้มเหลว" ต้องเห็นว่า job นี้เคย queued/running
// จึงใส่ record queued เข้า useJobs ทันทีที่ได้ id (event ที่มาถึงก่อนคำตอบและเดินหน้าไปแล้ว เช่น running ไม่ถูกดึงกลับเป็น queued)
// ใช้กับงานที่ผู้ใช้สั่งและไม่ผูกกับ scenario: POST /orbits/fetch, POST /daily/run

import { useJobs, type JobKind } from "../stores/jobs";
import { apiSend } from "./client";

/** POST path (ไม่มี body) แล้วคืน id ของ job; ผิดพลาดโยน ApiError ตามปกติของ client, คำตอบที่ไม่มี id โยน RangeError */
export async function startJob(path: string, kind: JobKind): Promise<string> {
  const { data } = await apiSend<{ job?: unknown }>("POST", path);
  const id = typeof data?.job === "string" ? data.job : null;
  if (id === null) throw new RangeError("the server did not return a job id");
  const jobs = useJobs.getState();
  if (jobs.jobs[id] === undefined) jobs.onJobEvent({ id, kind, scenario: null, state: "queued", progress: { stage: null, fraction: null } });
  return id;
}
