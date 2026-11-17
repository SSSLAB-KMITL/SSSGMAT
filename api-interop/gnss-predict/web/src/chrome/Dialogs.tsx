// กล่องโต้ตอบกลางของแอป (spec §15): 412 (Reload / Cancel), job ล้มเหลวพร้อม Details, และ confirm(text) ที่ใช้ร่วมกัน
// <Dialogs/> วางครั้งเดียวที่ราก (App) ทั้งสามกล่องอยู่ในนั้น ทุกกล่องคืนโฟกัสให้ element ที่ถือโฟกัสตอนเปิดเมื่อปิด (returnFocus.ts)

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { isActiveJob, useJobs, type Job } from "../stores/jobs";
import { useScenario } from "../stores/scenario";
import { useReturnFocus } from "./returnFocus";

// ---------- 412: scenario ถูกแก้จากที่อื่น ----------

export interface ConflictBoxProps {
  open: boolean;
  /** Reload: คืนเมื่อโหลดเสร็จ; กล่องปิดเมื่อ ผู้เรียกเปลี่ยน open เป็น false (โหลดไม่สำเร็จ = กล่องคงอยู่ให้ลองใหม่) */
  onReload(): Promise<void>;
  /** Cancel / Esc */
  onCancel(): void;
}

/**
 * กล่องข้อความเดียวกันสำหรับ 412 ของ store และหน้าต่างที่ถือค่าแก้ค้างอยู่ (Properties Browser): ข้อความไทยและปุ่ม Reload / Cancel ชุดเดียว
 * เริ่มที่ Cancel: Reload ทิ้งค่าที่ยังไม่ได้ Apply กด Enter เฉย ๆ จึงต้องไม่ทิ้งงานของผู้ใช้ ปิดแล้วโฟกัสกลับไปที่เดิม (returnFocus.ts)
 */
export function ConflictBox({ open, onReload, onCancel }: ConflictBoxProps) {
  const [busy, setBusy] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const returnFocus = useReturnFocus(open);
  const reload = async (): Promise<void> => {
    setBusy(true);
    try {
      await onReload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {/* คลิกนอกกล่องไม่ปิด: ต้องเลือก Reload หรือ Cancel (Esc = Cancel) */}
        <Dialog.Content
          className="dlg dlg-message"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        >
          <Dialog.Title className="dlg-title">{msg("conflict.title")}</Dialog.Title>
          <Dialog.Description className="dlg-text">{msg("conflict.body")}</Dialog.Description>
          <div className="dlg-buttons">
            <button type="button" className="btn" disabled={busy} onClick={() => void reload()}>
              {t("dialog.reload")}
            </button>
            <button type="button" className="btn" ref={cancel} onClick={onCancel}>
              {t("dialog.cancel")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConflictDialog() {
  const open = useScenario((s) => s.conflict);
  // Reload สำเร็จ = reload() ล้างธง conflict แล้วกล่องปิดเอง; ล้มเหลว = กล่องคงอยู่ให้ลองใหม่
  return (
    <ConflictBox
      open={open}
      onReload={async () => {
        await useScenario.getState().reload();
      }}
      onCancel={() => useScenario.getState().clearConflict()}
    />
  );
}

// ---------- job ที่ผู้ใช้สั่งล้มเหลว ----------

/**
 * ขึ้นกล่องครั้งเดียวต่อ job ที่ origin == "user" และ state == "failed" ของ scenario ที่เปิดอยู่ โดยไม่ดูนาฬิกาเลย (นาฬิกา browser กับ server อาจเหลื่อมกัน):
 * ขึ้นเฉพาะ job ที่หน้านี้เคย "เห็น" ว่า queued หรือ running แล้วเห็นต่อมาว่า failed (ผ่าน SSE หรือการดึงรายการใหม่ก็ได้)
 * job ที่ failed อยู่แล้วตั้งแต่หน้านี้ดึงรายการครั้งแรกคือประวัติ ไม่ขึ้น
 * event `job` ของ SSE ไม่มี origin: job ที่ล้มเหลวและยังไม่รู้ origin ทำให้ดึงรายการเต็มจาก server เพื่อดูว่าใครสั่ง
 * (นับว่าถามแล้วต่อเมื่อดึงสำเร็จ ดึงไม่ได้ก็ถามใหม่เมื่อรายการ job เปลี่ยนครั้งถัดไป) เปลี่ยน scenario ที่เปิด = ล้างคิว
 */
function JobFailedDialog() {
  const [queue, setQueue] = useState<Job[]>([]);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const seenActive = new Set<string>();
    const handled = new Set<string>();
    const asked = new Set<string>();
    const asking = new Set<string>();

    const ask = (id: string): void => {
      if (asking.has(id)) return;
      asking.add(id);
      void useJobs.getState().fetchAll().then((ok) => {
        asking.delete(id);
        if (ok) asked.add(id); // ผลมาเข้า store แล้ว (ถ้า job ยังอยู่ จะมี origin) ถามซ้ำไม่มีประโยชน์
      });
    };

    const scan = (jobs: Record<string, Job>): void => {
      const scenario = useScenario.getState().name;
      const fresh: Job[] = [];
      for (const job of Object.values(jobs).sort((a, b) => a.id.localeCompare(b.id))) {
        if (isActiveJob(job)) {
          seenActive.add(job.id);
          continue;
        }
        if (job.state !== "failed" || handled.has(job.id) || !seenActive.has(job.id)) continue;
        if (scenario === null || job.scenario !== scenario) {
          handled.add(job.id); // ล้มเหลวตอนที่ scenario นี้ไม่ได้เปิดอยู่: เปิดทีหลังก็ไม่ขึ้น
          continue;
        }
        if (job.origin === undefined) {
          if (asked.has(job.id)) handled.add(job.id); // ถามแล้วก็ยังไม่รู้ว่าใครสั่ง: ไม่ขึ้น
          else ask(job.id);
          continue;
        }
        handled.add(job.id);
        if (job.origin === "user") fresh.push(job);
      }
      if (fresh.length > 0) setQueue((q) => [...q, ...fresh]);
    };

    scan(useJobs.getState().jobs); // รายการที่มีอยู่แล้วตอนเริ่ม: ที่กำลังรันถือว่าเห็นแล้ว ที่ failed ไปแล้วเป็นประวัติ
    const offJobs = useJobs.subscribe((state, prev) => {
      if (state.jobs !== prev.jobs) scan(state.jobs);
    });
    const offScenario = useScenario.subscribe((state, prev) => {
      if (state.name !== prev.name) {
        setQueue([]);
        setDetails(false);
      }
    });
    return () => {
      offJobs();
      offScenario();
    };
  }, []);

  const job = queue[0];
  const returnFocus = useReturnFocus(job !== undefined);
  const close = (): void => {
    setQueue((q) => q.slice(1));
    setDetails(false);
  };
  return (
    <Dialog.Root open={job !== undefined} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        {job !== undefined && (
          <Dialog.Content className="dlg dlg-message" onCloseAutoFocus={returnFocus.onCloseAutoFocus}>
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
  id: number;
  text: string;
  okLabel: string | undefined;
  /** ชื่อปุ่มปฏิเสธ (คำถามแบบ Yes / No) ไม่ระบุ = Cancel */
  cancelLabel: string | undefined;
  resolve(answer: boolean): void;
}

/** คำขอที่รอคำตอบ ถามทีละข้อตามลำดับ */
const useConfirmQueue = create<{ queue: ConfirmRequest[] }>()(() => ({ queue: [] }));
let hosts = 0;
let nextRequestId = 1;

function answerAll(answer: boolean): void {
  const { queue } = useConfirmQueue.getState();
  useConfirmQueue.setState({ queue: [] });
  for (const request of queue) request.resolve(answer);
}

/**
 * ถามยืนยันด้วยกล่องเดียวร่วมกัน: ตอบ OK = true, Cancel / Esc = false
 * ไม่มี <Dialogs/> ให้ถาม (ยังไม่ mount) = false เสมอ เพื่อไม่ทำสิ่งที่ผู้ใช้ไม่ได้ยืนยัน
 */
export function confirm(text: string, opts: { okLabel?: string; cancelLabel?: string } = {}): Promise<boolean> {
  if (hosts === 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    useConfirmQueue.setState((s) => ({ queue: [...s.queue, { id: nextRequestId++, text, okLabel: opts.okLabel, cancelLabel: opts.cancelLabel, resolve }] }));
  });
}

function ConfirmHost() {
  const request = useConfirmQueue((s) => s.queue[0]);
  const cancel = useRef<HTMLButtonElement>(null);
  // กล่องเดียวเปิดค้างตลอดคิว: จำที่โฟกัสอยู่ตอนคำขอแรก แล้วคืนให้เมื่อคิวหมด
  const returnFocus = useReturnFocus(request !== undefined);

  // กล่องเดียวใช้ต่อทุกคำขอ onOpenAutoFocus จึงทำงานแค่ตอนเปิดครั้งแรก: คำขอถัดไปในคิวต้องคืนโฟกัสให้ Cancel เองทุกครั้งที่เปลี่ยนคำขอ
  const requestId = request?.id;
  useEffect(() => {
    if (requestId !== undefined) cancel.current?.focus();
  }, [requestId]);

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
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <Dialog.Title className="dlg-title">{t("dialog.confirm")}</Dialog.Title>
            <Dialog.Description className="dlg-text">{request.text}</Dialog.Description>
            <div className="dlg-buttons">
              <button type="button" className="btn" onClick={() => answer(true)}>
                {request.okLabel ?? t("dialog.ok")}
              </button>
              <button type="button" className="btn" ref={cancel} onClick={() => answer(false)}>
                {request.cancelLabel ?? t("dialog.cancel")}
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
