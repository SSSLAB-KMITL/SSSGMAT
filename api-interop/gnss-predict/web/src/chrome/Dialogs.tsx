// กล่องโต้ตอบกลางของแอป (spec §15): 412 (Reload / Cancel), job ล้มเหลวพร้อม Details, และ confirm(text) ที่ใช้ร่วมกัน
// <Dialogs/> วางครั้งเดียวที่ราก (App) ทั้งสามกล่องอยู่ในนั้น

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { useJobs, type Job } from "../stores/jobs";
import { useScenario } from "../stores/scenario";
import { parseIsoUtc } from "../time/parse";

// ---------- 412: scenario ถูกแก้จากที่อื่น ----------

function ConflictDialog() {
  const open = useScenario((s) => s.conflict);
  const [busy, setBusy] = useState(false);
  const reload = async (): Promise<void> => {
    setBusy(true);
    try {
      await useScenario.getState().reload(); // สำเร็จ = reload() ล้างธง conflict แล้วกล่องปิดเอง; ล้มเหลว = กล่องคงอยู่ให้ลองใหม่
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && useScenario.getState().clearConflict()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {/* คลิกนอกกล่องไม่ปิด: ต้องเลือก Reload หรือ Cancel (Esc = Cancel) */}
        <Dialog.Content className="dlg dlg-message" onInteractOutside={(e) => e.preventDefault()}>
          <Dialog.Title className="dlg-title">{msg("conflict.title")}</Dialog.Title>
          <Dialog.Description className="dlg-text">{msg("conflict.body")}</Dialog.Description>
          <div className="dlg-buttons">
            <button type="button" className="btn" disabled={busy} onClick={() => void reload()}>
              {t("dialog.reload")}
            </button>
            <button type="button" className="btn" onClick={() => useScenario.getState().clearConflict()}>
              {t("dialog.cancel")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- job ที่ผู้ใช้สั่งล้มเหลว ----------

/**
 * ขึ้นกล่องครั้งเดียวต่อ job ที่ origin == "user" และ state == "failed" ของ scenario ที่เปิดอยู่
 * - job ที่ล้มเหลวก่อนหน้าเปิดหน้านี้ (มากับ GET /api/jobs ตอนต่อ SSE) ไม่ขึ้น: ดู finished_utc เทียบเวลาที่กล่องนี้เริ่ม
 * - event `job` ของ SSE ไม่มี origin: ถ้า job ล้มเหลวและยังไม่รู้ origin จะดึงรายการเต็มจาก server หนึ่งครั้งเพื่อดูว่าใครสั่ง
 */
function JobFailedDialog() {
  const jobs = useJobs((s) => s.jobs);
  const scenario = useScenario((s) => s.name);
  const [queue, setQueue] = useState<Job[]>([]);
  const [details, setDetails] = useState(false);
  const handled = useRef(new Set<string>());
  const asked = useRef(new Set<string>());
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (scenario === null) return;
    const fresh: Job[] = [];
    for (const job of Object.values(jobs).sort((a, b) => a.id.localeCompare(b.id))) {
      if (job.state !== "failed" || job.scenario !== scenario || handled.current.has(job.id)) continue;
      if (job.origin === undefined) {
        if (!asked.current.has(job.id)) {
          asked.current.add(job.id);
          void useJobs.getState().refresh();
        }
        continue;
      }
      handled.current.add(job.id);
      if (job.origin !== "user") continue;
      const finished = job.finished_utc ? parseIsoUtc(job.finished_utc) : null;
      if (finished !== null && finished.getTime() < openedAt.current) continue;
      fresh.push(job);
    }
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
  }, [jobs, scenario]);

  const job = queue[0];
  const close = (): void => {
    setQueue((q) => q.slice(1));
    setDetails(false);
  };
  return (
    <Dialog.Root open={job !== undefined} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {job !== undefined && (
          <Dialog.Content className="dlg dlg-message">
            <Dialog.Title className="dlg-title">{msg("job.failed", { message: job.error?.text ?? job.id })}</Dialog.Title>
            <Dialog.Description className="dlg-text">{`${job.kind} · ${job.id}`}</Dialog.Description>
            {details && job.error?.detail != null && <pre className="dlg-detail">{job.error.detail}</pre>}
            <div className="dlg-buttons">
              {job.error?.detail != null && (
                <button type="button" className="btn" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
                  {t("mv.details")}
                </button>
              )}
              <button type="button" className="btn" onClick={close}>
                {t("dialog.ok")}
              </button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- confirm(text) ----------

interface ConfirmRequest {
  text: string;
  okLabel: string | undefined;
  resolve(answer: boolean): void;
}

/** คำขอที่รอคำตอบ ถามทีละข้อตามลำดับ */
const useConfirmQueue = create<{ queue: ConfirmRequest[] }>()(() => ({ queue: [] }));
let hosts = 0;

function answerAll(answer: boolean): void {
  const { queue } = useConfirmQueue.getState();
  useConfirmQueue.setState({ queue: [] });
  for (const request of queue) request.resolve(answer);
}

/**
 * ถามยืนยันด้วยกล่องเดียวร่วมกัน: ตอบ OK = true, Cancel / Esc = false
 * ไม่มี <Dialogs/> ให้ถาม (ยังไม่ mount) = false เสมอ เพื่อไม่ทำสิ่งที่ผู้ใช้ไม่ได้ยืนยัน
 */
export function confirm(text: string, opts: { okLabel?: string } = {}): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    useConfirmQueue.setState((s) => ({ queue: [...s.queue, { text, okLabel: opts.okLabel, resolve }] }));
  });
}

function ConfirmHost() {
  const request = useConfirmQueue((s) => s.queue[0]);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      if (hosts === 0) answerAll(false);
    };
  }, []);

  const answer = (value: boolean): void => {
    const [first, ...rest] = useConfirmQueue.getState().queue;
    useConfirmQueue.setState({ queue: rest });
    first?.resolve(value);
  };

  return (
    <Dialog.Root open={request !== undefined} onOpenChange={(next) => !next && answer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {request !== undefined && (
          <Dialog.Content
            className="dlg dlg-message"
            onOpenAutoFocus={(e) => {
              e.preventDefault(); // เริ่มที่ Cancel: กด Enter เฉย ๆ ไม่ยืนยันการลบโดยไม่ตั้งใจ
              cancel.current?.focus();
            }}
          >
            <Dialog.Title className="dlg-title">{t("dialog.confirm")}</Dialog.Title>
            <Dialog.Description className="dlg-text">{request.text}</Dialog.Description>
            <div className="dlg-buttons">
              <button type="button" className="btn" onClick={() => answer(true)}>
                {request.okLabel ?? t("dialog.ok")}
              </button>
              <button type="button" className="btn" ref={cancel} onClick={() => answer(false)}>
                {t("dialog.cancel")}
              </button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Dialogs() {
  return (
    <>
      <ConflictDialog />
      <JobFailedDialog />
      <ConfirmHost />
    </>
  );
}
