// Find ใน Object Browser: กล่องเล็กลอยในหน้าต่าง (ไม่ใช่ modal ผู้ใช้ยังเลื่อนต้นไม้ได้) ช่องคำค้น + Find Next / Find Previous
// - Enter ในช่องคำค้น = ถัดไป, Shift+Enter = ก่อนหน้า, Esc = ปิด (Enter ที่ปุ่มเป็นการกดปุ่มนั้น); ตัวค้นจริงอยู่ที่ ObjectBrowser (onFind) เพราะต้องรู้แถวทั้งต้นไม้และเปิดโฟลเดอร์ที่พับอยู่
// - ไม่พบ = บอกเป็นภาษาไทยใต้ช่อง ไม่เปลี่ยนการเลือก

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";

export interface FindDialogProps {
  /** คืนว่าพบหรือไม่ */
  onFind(query: string, direction: 1 | -1): boolean;
  onClose(): void;
  /** เปลี่ยนค่า = โฟกัสช่องคำค้นอีกครั้ง (สั่ง Find ซ้ำตอนกล่องเปิดอยู่แล้ว) */
  focusToken: number;
}

export function FindDialog({ onFind, onClose, focusToken }: FindDialogProps) {
  const [query, setQuery] = useState("");
  const [missed, setMissed] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    box.current?.focus();
    box.current?.select();
  }, [focusToken]);

  const go = (direction: 1 | -1): void => {
    if (query.trim() === "") return;
    setMissed(onFind(query, direction) ? null : query);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && e.target === box.current) {
      // Enter ในช่องคำค้นเท่านั้น: ที่ปุ่ม Enter คือการกดปุ่มนั้น (Find Previous ย้อนกลับ, Close ปิด) ไม่ใช่ "ถัดไป"
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="ob-find" role="dialog" aria-label={t("ob.find")} onKeyDown={onKeyDown}>
      <div className="ob-find-row">
        <input
          ref={box}
          type="text"
          className="field ob-find-input"
          aria-label={t("ob.findWhat")}
          placeholder={t("ob.findWhat")}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setMissed(null);
          }}
        />
        <button type="button" className="tool-btn" aria-label={t("ob.findNext")} title={t("ob.findNext")} onClick={() => go(1)}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tool-btn" aria-label={t("ob.findPrevious")} title={t("ob.findPrevious")} onClick={() => go(-1)}>
          <ChevronUp size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tool-btn" aria-label={t("dialog.windows.close")} title={t("dialog.windows.close")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {missed !== null && (
        <div className="ob-find-miss" role="status">
          {msg("ob.findNoMatch", { query: missed })}
        </div>
      )}
    </div>
  );
}
