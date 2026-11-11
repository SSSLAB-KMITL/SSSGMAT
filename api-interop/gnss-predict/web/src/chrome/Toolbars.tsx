// แถบเครื่องมือ Default และ Animation (spec §5.2) แสดง/ซ่อนจาก View → Toolbars (useLayout.toolbars)
// ปุ่มทุกปุ่มเรียกคำสั่งผ่านทะเบียนและมี tooltip ชื่อจาก labels.ts; ช่อง Current Scenario Time และ X Real Time Multiplier
// ไม่ใช่ปุ่มจึงเขียน useTime ตรง ๆ (ผ่านฟังก์ชัน setCurrent / setMultiplier ที่ตรวจค่าให้)

import {
  ChartBar, ChevronsDown, ChevronsUp, Clock, FastForward, FilePlus, FolderOpen, Gauge, Link, PackagePlus, Pause, Play, RotateCcw, Save,
  SlidersHorizontal, StepBack, StepForward,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { t } from "../labels/labels";
import { msg } from "../labels/messages.th";
import { useLayout } from "../stores/layout";
import { useScenario } from "../stores/scenario";
import { useTime } from "../stores/time";
import { formatStep } from "../time/steps";
import { parseTime } from "../time/parse";
import { useThrottledTime, useTimeFormatter } from "./hooks";
import { TipProvider } from "./Tip";
import { ToolButton } from "./ToolButton";

function DefaultToolbar() {
  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.default")}>
      <ToolButton command="file.new" label="toolbar.new" icon={FilePlus} />
      <ToolButton command="file.open" label="toolbar.open" icon={FolderOpen} />
      <ToolButton command="file.save" label="toolbar.save" icon={Save} />
      <span className="toolbar-sep" aria-hidden="true" />
      <ToolButton command="insert.new" label="toolbar.insertObject" icon={PackagePlus} />
      <ToolButton command="object.properties" label="toolbar.properties" icon={SlidersHorizontal} />
      <ToolButton command="analysis.access" label="toolbar.access" icon={Link} />
      <ToolButton command="analysis.reportGraphManager" label="toolbar.reportGraphManager" icon={ChartBar} />
    </div>
  );
}

/**
 * ช่องที่พิมพ์แก้แล้วกด Enter รับค่า: ข้อความที่พิมพ์ค้างไว้ (draft) แสดงแทนค่าจริงตั้งแต่โฟกัสจนออกจากช่อง
 * snapshot = ข้อความตอนเข้าช่อง (หรือตอนกด Escape) Enter โดยไม่ได้แก้อะไร (draft เท่า snapshot) ไม่ใช่การรับค่า:
 * ไม่งั้นนาฬิกาที่เดินอยู่ระหว่างที่ช่องถูกโฟกัสจะถูกดึงกลับไปเวลาตอนเข้าช่อง
 * enabled = false (ไม่มี scenario) ล้างสิ่งที่พิมพ์ค้างทิ้ง เพราะช่องที่ถูกปิดขณะโฟกัสอยู่ไม่ส่ง blur
 */
function useDraft(initial: () => string, enabled: boolean) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const snapshot = useRef("");
  useEffect(() => {
    if (!enabled) {
      setDraft(null);
      setInvalid(false);
    }
  }, [enabled]);
  const capture = (): string => {
    snapshot.current = initial();
    return snapshot.current;
  };
  return {
    draft,
    invalid,
    /** เข้าช่อง: จับค่าปัจจุบันไว้ ไม่ให้นาฬิกาที่เดินอยู่เขียนทับระหว่างพิมพ์ */
    begin: () => setDraft(capture()),
    edit: (text: string) => {
      setDraft(text);
      setInvalid(false);
    },
    /** ข้อความที่พิมพ์ต่างจากตอนเข้าช่อง */
    changed: () => draft !== null && draft !== snapshot.current,
    reject: () => setInvalid(true),
    /** Escape: กลับเป็นค่าปัจจุบัน (ยังอยู่ในช่อง) */
    revert: () => {
      setDraft(capture());
      setInvalid(false);
    },
    /** ออกจากช่องหรือรับค่าแล้ว: แสดงค่าจริงตามนาฬิกาอีกครั้ง */
    end: () => {
      setDraft(null);
      setInvalid(false);
    },
  };
}

function TimeField() {
  const { fmt, ltz, format } = useTimeFormatter();
  const current = useThrottledTime();
  const open = useScenario((s) => s.name !== null);
  const field = useDraft(() => format(useTime.getState().current), open);
  const errorId = useId();
  const name = t("anim.currentTime");
  const error = msg("time.invalid", { example: format(useTime.getState().current) });

  const commit = (input: HTMLInputElement): void => {
    if (!field.changed()) {
      field.end(); // ไม่ได้แก้อะไร: แค่ออกจากช่อง ไม่แตะนาฬิกา
      input.blur();
      return;
    }
    const d = parseTime(field.draft ?? "", fmt, ltz);
    if (d === null) {
      field.reject();
      return;
    }
    useTime.getState().setCurrent(d);
    field.end();
    input.blur();
  };

  return (
    <>
      <input
        type="text"
        className={`field field-time${field.invalid ? " field-invalid" : ""}`}
        aria-label={name}
        disabled={!open}
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.invalid ? errorId : undefined}
        title={field.invalid ? error : name}
        spellCheck={false}
        autoComplete="off"
        value={field.draft ?? format(current)}
        onFocus={field.begin}
        onBlur={field.end}
        onChange={(e) => field.edit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget);
          } else if (e.key === "Escape") {
            e.preventDefault();
            field.revert();
          }
        }}
      />
      {field.invalid && (
        <span id={errorId} role="alert" className="sr-only">
          {error}
        </span>
      )}
    </>
  );
}

/** Time Step: ข้อความอ่านอย่างเดียวตาม STK (เปลี่ยนด้วยปุ่ม Increase / Decrease Time Step) */
function StepField() {
  const step = useTime((s) => s.step_s);
  const name = t("anim.timeStep");
  return <input type="text" className="field field-step" aria-label={name} title={name} readOnly value={formatStep(step)} />;
}

function MultiplierField() {
  const multiplier = useTime((s) => s.multiplier);
  const open = useScenario((s) => s.name !== null);
  const field = useDraft(() => String(useTime.getState().multiplier), open);
  const name = t("anim.xRealTimeMultiplier");

  const commit = (input: HTMLInputElement): void => {
    if (!field.changed()) {
      field.end();
      input.blur();
      return;
    }
    const text = (field.draft ?? "").trim();
    const x = Number(text);
    if (text === "" || !Number.isFinite(x) || x <= 0) {
      field.reject();
      return;
    }
    useTime.getState().setMultiplier(x);
    field.end();
    input.blur();
  };

  return (
    <input
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      className={`field field-multiplier${field.invalid ? " field-invalid" : ""}`}
      aria-label={name}
      disabled={!open}
      aria-invalid={field.invalid || undefined}
      title={name}
      value={field.draft ?? String(multiplier)}
      onFocus={field.begin}
      onBlur={field.end}
      onChange={(e) => field.edit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(e.currentTarget);
        } else if (e.key === "Escape") {
          e.preventDefault();
          field.revert();
        }
      }}
    />
  );
}

function AnimationToolbar() {
  const mode = useTime((s) => s.mode);
  const direction = useTime((s) => s.direction);
  return (
    <div className="toolbar" role="toolbar" aria-label={t("toolbar.animation")}>
      <ToolButton command="anim.reset" label="anim.reset" icon={RotateCcw} />
      <ToolButton command="anim.stepBackward" label="anim.stepBackward" icon={StepBack} />
      <ToolButton command="anim.reverse" label="anim.reverse" icon={Play} mirror pressed={direction === -1} />
      <ToolButton command="anim.pause" label="anim.pause" icon={Pause} />
      <ToolButton command="anim.start" label="anim.start" icon={Play} pressed={direction === 1} />
      <ToolButton command="anim.stepForward" label="anim.stepForward" icon={StepForward} />
      <span className="toolbar-sep" aria-hidden="true" />
      <ToolButton command="anim.decreaseStep" label="anim.decreaseStep" icon={ChevronsDown} />
      <ToolButton command="anim.increaseStep" label="anim.increaseStep" icon={ChevronsUp} />
      <span className="toolbar-sep" aria-hidden="true" />
      <ToolButton command="anim.normal" label="anim.normalMode" icon={Gauge} pressed={mode === "normal"} />
      <ToolButton command="anim.realtime" label="anim.realTimeMode" icon={Clock} pressed={mode === "realtime"} />
      <ToolButton command="anim.xrealtime" label="anim.xRealTimeMode" icon={FastForward} pressed={mode === "xrealtime"} />
      <span className="toolbar-sep" aria-hidden="true" />
      <TimeField />
      <StepField />
      {mode === "xrealtime" && <MultiplierField />}
    </div>
  );
}

export function Toolbars() {
  const showDefault = useLayout((s) => s.toolbars.default);
  const showAnimation = useLayout((s) => s.toolbars.animation);
  if (!showDefault && !showAnimation) return null;
  return (
    <TipProvider>
      <div className="toolbars">
        {showDefault && <DefaultToolbar />}
        {showAnimation && <AnimationToolbar />}
      </div>
    </TipProvider>
  );
}
