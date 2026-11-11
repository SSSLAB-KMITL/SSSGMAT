// สถานะของฟอร์มหน้าต่าง Properties หนึ่งบาน (ทั้งของ object และของ Scenario): โหลด แก้ Apply และชนกับการแก้จากที่อื่น
//
// - base = root ที่ server เก็บ ณ ตอนที่เปิดหน้าต่างหรือโหลดล่าสุด; values = ข้อความ/ค่าที่ผู้ใช้เห็นและแก้; dirty = values ต่างจากค่าที่ base ให้
// - store โหลด doc ใหม่เงียบ ๆ เมื่อแท็บอื่นแก้ scenario (ETag เปลี่ยน) ฟอร์มจึงต้องเทียบเองว่าสิ่งที่มันถืออยู่ยังตรงกับ server ไหม:
//     ฟอร์มสะอาด + root ใหม่ต่างจาก base -> เปลี่ยน base และช่องเงียบ ๆ
//     ฟอร์มมีค่าแก้ค้าง + root ใหม่ต่างจาก base -> conflicted (Apply ถามด้วยกล่อง Reload / Cancel แทนการส่ง)
//     root ใหม่เท่า base (แท็บอื่นแก้ object อื่น) -> ไม่เกี่ยวกับฟอร์มนี้ ค่าที่แก้ค้างส่งต่อได้ด้วย ETag ใหม่ล่าสุด
//   การเทียบแต่ละครั้งเป็น GET หนึ่งครั้ง: มีใหม่กว่าเข้ามา = ยกเลิกอันเก่า (ผลที่ตอบทีหลังทิ้ง) และ Apply ที่กดระหว่างที่การเทียบยังค้างอยู่
//   รอให้การเทียบจบก่อนแล้วค่อยตัดสินว่าส่งหรือถามด้วยกล่อง (ไม่ตัดสินจากสถานะที่ยังไม่รู้ว่าเก่าไหม)
// - Apply ส่งผ่าน store (คิวเขียนทีละอย่าง ETag ล่าสุด) ตรวจก่อนส่งในเครื่อง ส่งเฉพาะที่เปลี่ยน; สำเร็จ = โหลดค่าที่ server เก็บจริงมาแทน
//   (store รีเฟรชผลลัพธ์เองเมื่อผลลัพธ์เก่า จึงไม่ต้องสั่งซ้ำที่นี่)
//   ระหว่างที่หน้าต่างเขียนเองหรือกำลัง Reload ETag ที่เปลี่ยนเป็นของตัวเอง ไม่นับเป็นการแก้จากที่อื่น
// - 412 จริง (ETag เก่าตอนส่ง): store ตั้ง conflict ซึ่งจะเปิดกล่องของทั้งแอป หน้าต่างนี้รับกล่องเป็นของตัวเอง (clearConflict แล้วเปิดกล่องของตน)
//   เพื่อให้ Reload ดึงทั้ง scenario และค่าของ object นี้ใหม่ และทิ้งค่าที่แก้ไว้ ส่วน Cancel เก็บค่าที่แก้ไว้และยังเป็น conflicted
// - Reload ใช้ข้อมูลใหม่ได้ก็ต่อเมื่อมาถึงจริง: useScenario.reload() คืน false เมื่อโหลดไม่สำเร็จ (มันรายงานเองแล้วไม่โยน) -> กล่องคงอยู่ ค่าที่แก้คงอยู่ ไม่ส่งอะไร

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorText, isAbortError } from "../../api/client";
import { isConflict, reportWriteError } from "../../api/writes";
import { msg } from "../../labels/messages.th";
import { useScenario } from "../../stores/scenario";
import {
  applyValues, deepEqual, diffTree, fieldFromServer, isDirty, locateField, valuesFrom,
  type Errors, type PageFields, type Spec, type TimeContext, type Tree, type Value, type Values,
} from "./form";

export interface EditorConfig {
  /** เปลี่ยนค่านี้ = เป็นหน้าต่างของ object อื่น: โหลดใหม่ตั้งแต่ต้น */
  identity: string;
  specs: readonly Spec[];
  pages: readonly PageFields[];
  /** object ที่ลง Message Viewer เมื่อ Apply ล้มเหลว (path; null = Scenario) */
  object: string | null;
  /** อ่าน root ล่าสุดจากต้นทาง (object: GET ของ server; Scenario: doc ใน store) */
  load(signal: AbortSignal | undefined): Promise<Tree>;
  /** ส่ง patch (เฉพาะที่เปลี่ยน) ผ่าน store */
  save(patch: Tree): Promise<unknown>;
  /** รูปแบบเวลาของช่องเวลา (Scenario) */
  timeContext(base: Tree): TimeContext;
  /** state ของ store เปลี่ยนในแบบที่อาจหมายถึง root นี้เปลี่ยน */
  watches(next: StoreSnapshot, prev: StoreSnapshot): boolean;
  /** ขอให้หน้าต่างแสดงหน้านี้ (หน้าที่มีช่องผิด) */
  showPage(id: string): void;
}

export interface StoreSnapshot {
  etag: string | null;
  doc: unknown;
}

export interface Editor {
  status: "loading" | "ready" | "failed";
  loadError: string | null;
  base: Tree | null;
  values: Values;
  errors: Errors;
  /** ข้อผิดพลาดของ Apply ที่ไม่ใช่ของช่องใดที่แสดงอยู่ */
  general: string | null;
  dirty: boolean;
  busy: boolean;
  conflicted: boolean;
  conflictOpen: boolean;
  ui: Record<string, boolean>;
  set(key: string, value: Value): void;
  setUi(key: string, value: boolean): void;
  /** true = ไม่มีอะไรค้าง (ไม่ได้แก้ หรือส่งสำเร็จ) false = ยังค้างอยู่ (ผิด ขัดแย้ง หรือ server ปฏิเสธ) */
  apply(): Promise<boolean>;
  /** Reload ในกล่อง conflict: ได้ข้อมูลใหม่จริง = ทิ้งค่าที่แก้แล้วปิดกล่อง; ไม่ได้ = กล่องคงอยู่ ค่าที่แก้คงอยู่ */
  reload(): Promise<void>;
  /** Cancel ในกล่อง conflict: เก็บค่าที่แก้ไว้ */
  dismissConflict(): void;
}

const EMPTY_VALUES: Values = {};
const NONE: Record<string, boolean> = {};

export function useEditor(config: EditorConfig): Editor {
  const [status, setStatus] = useState<Editor["status"]>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [base, setBase] = useState<Tree | null>(null);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Errors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [ui, setUiState] = useState<Record<string, boolean>>(NONE);

  const cfg = useRef(config);
  cfg.current = config;
  // specs ของแต่ละชนิด object คงที่ต่อชนิด object; timeContext อ่านจาก base เอง จึงคำนวณใหม่เมื่อ base เปลี่ยนเท่านั้น
  const initial = useMemo(() => (base === null ? EMPTY_VALUES : valuesFrom(base, config.specs, cfg.current.timeContext(base))), [base, config.specs]);
  const dirty = base !== null && isDirty(values, initial);

  // callback ของ store และ promise ที่ตอบทีหลังอ่านค่าล่าสุดผ่าน ref (ไม่ใช่ค่าที่ closure ตอนสร้าง)
  // (render ตั้งทุกครั้ง; adopt และ markConflicted ตั้งทันทีด้วย เพื่อให้ Apply ที่รอการเทียบอ่านผลของการเทียบนั้นได้โดยไม่ต้องรอ render)
  const latest = useRef({ base, values, dirty, conflicted });
  latest.current = { base, values, dirty, conflicted };
  /** กำลังเขียนหรือ Reload เอง: ETag ที่เปลี่ยนระหว่างนี้เป็นของเรา */
  const working = useRef(false);
  /** Apply กำลังทำงาน (รวมช่วงรอการเทียบ): กดซ้ำไม่ทำอะไร */
  const entered = useRef(false);
  const seq = useRef(0);
  /** การเทียบกับ server ที่ค้างอยู่ (ล่าสุดเท่านั้น) และตัวยกเลิกของมัน */
  const checking = useRef<Promise<void> | null>(null);
  const checkCtl = useRef<AbortController | null>(null);

  const markConflicted = useCallback((value: boolean): void => {
    latest.current.conflicted = value;
    setConflicted(value);
  }, []);

  /**
   * root ใหม่ทั้งก้อน: ทิ้งค่าที่แก้ ข้อผิดพลาด และสถานะขัดแย้ง
   * keepAdded = ตามค่าของ server เงียบ ๆ หรือหลัง Apply (ไม่ใช่ Reload): แถวที่ผู้ใช้เพิ่มเองใน ui (true) ยังอยู่ ไม่หายไปพร้อมการโหลดค่าใหม่
   */
  const adopt = useCallback((root: Tree, keepAdded = false): void => {
    const next = valuesFrom(root, cfg.current.specs, cfg.current.timeContext(root));
    latest.current = { base: root, values: next, dirty: false, conflicted: false };
    setBase(root);
    setValues(next);
    setErrors({});
    setGeneral(null);
    setConflicted(false);
    setUiState((u) => {
      const added = keepAdded ? Object.entries(u).filter(([, v]) => v) : [];
      return added.length === 0 ? NONE : Object.fromEntries(added);
    });
    setLoadError(null);
    setStatus("ready");
  }, []);

  const fail = useCallback((e: unknown): void => {
    setLoadError(errorText(e));
    setStatus("failed");
    setConflictOpen(false);
  }, []);

  // ---------- โหลดครั้งแรก ----------
  useEffect(() => {
    const ctl = new AbortController();
    const mine = ++seq.current;
    setStatus("loading");
    cfg.current.load(ctl.signal).then(
      (root) => {
        if (mine === seq.current) adopt(root);
      },
      (e: unknown) => {
        if (!isAbortError(e) && mine === seq.current) fail(e);
      },
    );
    return () => ctl.abort();
  }, [config.identity, adopt, fail]);

  // ---------- การแก้จากที่อื่น ----------
  useEffect(() => {
    const unsubscribe = useScenario.subscribe((next, prev) => {
      if (working.current || latest.current.base === null) return;
      if (!cfg.current.watches(next, prev)) return;
      checkCtl.current?.abort(); // การเทียบเก่ากว่านี้ไม่มีความหมายแล้ว (และไม่ต้องรอคำตอบของมัน)
      const ctl = new AbortController();
      checkCtl.current = ctl;
      const done: Promise<void> = cfg.current.load(ctl.signal).then(
        (fresh) => {
          const now = latest.current;
          if (ctl !== checkCtl.current || working.current || now.base === null) return;
          if (deepEqual(fresh, now.base)) markConflicted(false); // แท็บอื่นแก้อย่างอื่น: ไม่เกี่ยวกับฟอร์มนี้
          else if (now.dirty) markConflicted(true);
          else adopt(fresh, true);
        },
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404 && ctl === checkCtl.current) fail(e); // object ถูกลบหรือเปลี่ยนชื่อ
        },
      ).finally(() => {
        if (checking.current === done) checking.current = null;
      });
      checking.current = done;
    });
    return () => {
      unsubscribe();
      checkCtl.current?.abort();
      checkCtl.current = null;
      checking.current = null;
    };
  }, [config.identity, adopt, fail, markConflicted]);

  // ขัดแย้งแต่ผู้ใช้แก้คืนจนไม่เหลือค่าที่แก้ไว้แล้ว: ไม่มีอะไรให้เสีย ตามค่าของ server ทันที (ไม่ปล่อยให้ฟอร์มสะอาดแสดงค่าเก่า)
  useEffect(() => {
    if (!conflicted || dirty || working.current) return;
    const ctl = new AbortController();
    cfg.current.load(ctl.signal).then((fresh) => adopt(fresh, true), () => undefined);
    return () => ctl.abort();
  }, [conflicted, dirty, adopt]);

  const set = useCallback((key: string, value: Value): void => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (e[key] === undefined) return e;
      const { [key]: _gone, ...rest } = e;
      return rest;
    });
  }, []);

  const setUi = useCallback((key: string, value: boolean): void => setUiState((u) => ({ ...u, [key]: value })), []);

  /** แสดงหน้าแรก (ตามลำดับหน้า) ที่มีช่องผิด */
  const showFirstError = useCallback((keys: string[]): void => {
    const { pages, showPage } = cfg.current;
    const located = keys.map((k) => locateField(pages, k)).filter((x): x is NonNullable<typeof x> => x !== null);
    const first = pages.find((p) => located.some((l) => l.page === p.id));
    if (first !== undefined) showPage(first.id);
  }, []);

  const send = useCallback(async (): Promise<boolean> => {
    const now = latest.current;
    const c = cfg.current;
    if (now.base === null) return false;
    if (!now.dirty) return true;
    if (now.conflicted) {
      setConflictOpen(true);
      return false;
    }
    const { edited, errors: found } = applyValues(now.base, now.values, c.specs, c.timeContext(now.base));
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setGeneral(null);
      showFirstError(Object.keys(found));
      return false;
    }
    const patch = diffTree(now.base, edited);
    working.current = true;
    setBusy(true);
    setErrors({});
    setGeneral(null);
    try {
      if (Object.keys(patch).length > 0) await c.save(patch);
      try {
        adopt(await c.load(undefined), true);
      } catch {
        adopt(edited, true); // เขียนสำเร็จแต่อ่านกลับไม่ได้: ใช้ค่าที่เพิ่งส่ง การแก้ครั้งถัดไปจากที่อื่นจะทำให้เทียบใหม่
      }
      return true;
    } catch (e) {
      if (isConflict(e)) {
        useScenario.getState().clearConflict(); // หน้าต่างนี้รับกล่อง 412 ไว้เอง (Reload ต้องดึงค่าของ object นี้ใหม่ด้วย)
        markConflicted(true);
        setConflictOpen(true);
        return false;
      }
      const field = e instanceof ApiError && e.status === 422 ? locateField(c.pages, fieldFromServer(e.field ?? "")) : null;
      if (field !== null && e instanceof ApiError) {
        setErrors({ [field.field]: e.text });
        c.showPage(field.page);
      } else {
        reportWriteError(e, c.object);
        setGeneral(msg("props.generalError", { message: errorText(e) }));
      }
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [adopt, markConflicted, showFirstError]);

  const apply = useCallback(async (): Promise<boolean> => {
    if (entered.current || working.current || latest.current.base === null) return false;
    entered.current = true;
    try {
      // การเทียบกับ server ที่ยังค้างอยู่ตัดสินก่อน: ถ้า object เปลี่ยนไปแล้ว ต้องถามด้วยกล่อง ไม่ใช่ส่งทับ
      if (checking.current !== null) {
        setBusy(true);
        try {
          while (checking.current !== null) await checking.current;
        } finally {
          setBusy(false);
        }
      }
      return await send();
    } finally {
      entered.current = false;
    }
  }, [send]);

  const reload = useCallback(async (): Promise<void> => {
    working.current = true;
    setBusy(true);
    try {
      // useScenario.reload() ไม่โยนเมื่อโหลดไม่สำเร็จ (รายงานเองแล้วคืน false): ถ้าไม่ได้ข้อมูลใหม่จริง ห้ามถือว่า store สดและห้ามทิ้งค่าที่แก้
      if (!(await useScenario.getState().reload())) return;
      adopt(await cfg.current.load(undefined));
      setConflictOpen(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) fail(e);
      else reportWriteError(e, cfg.current.object);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, [adopt, fail]);

  const dismissConflict = useCallback((): void => setConflictOpen(false), []);

  return { status, loadError, base, values, errors, general, dirty, busy, conflicted, conflictOpen, ui, set, setUi, apply, reload, dismissConflict };
}
