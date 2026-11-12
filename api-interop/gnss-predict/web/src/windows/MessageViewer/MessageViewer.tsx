// Message Viewer (spec §11, STK ref §A): ข้อความจาก server (SSE) และที่หน้าเว็บสร้างเอง
// - แท็บ All Messages / Errors / Infos / Warnings พร้อมจำนวน ตารางคอลัมน์ Time (DateFormat ของ scenario; ไม่มี scenario = UTCG), Level, Code, Object, Message
//   เรียงเก่า -> ใหม่ ข้อความใหม่อยู่ล่างสุด: ถ้ารายการอยู่ที่ท้ายอยู่แล้วเลื่อนตามข้อความใหม่ ถ้าผู้ใช้เลื่อนขึ้นไปอ่านก็ไม่ดึงกลับ
// - วาดแบบ virtual list (TanStack Virtual) ข้อความได้ถึง 5,000 รายการ มีใน DOM เฉพาะแถวใกล้พื้นที่เห็น (ตัววัดพื้นที่เห็นร่วมกับ Object Browser: virtualList.ts)
// - เลือกแถว (คลิก หรือ ↑ ↓ Home End); ปุ่ม Details หรือดับเบิลคลิก (Enter) เปิดกล่องข้อความเต็ม รายละเอียด (detail) รหัส object และเวลา
// - Clear this Tab / Clear all Tabs ซ่อนข้อความ (ไม่ลบ) เฉพาะแท็บที่สั่ง (stores/messages.ts)
// - แถบสถานะนับข้อความที่ยังไม่อ่านโดยดูว่าหน้าต่างนี้เห็นอยู่ไหน (chrome/StatusBar.tsx) หน้าต่างนี้ไม่ต้องทำอะไรเพิ่ม

import { useVirtualizer, type Rect } from "@tanstack/react-virtual";
import * as Dialog from "@radix-ui/react-dialog";
import { CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTimeFormatter } from "../../chrome/hooks";
import { useReturnFocus } from "../../chrome/returnFocus";
import { t, type LabelKey } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { usePanelResize } from "../../stores/layout";
import { messageKey, useMessages, useVisibleMessages, type Message, type MessageLevel, type MessageTab } from "../../stores/messages";
import { parseIsoUtc } from "../../time/parse";
import { observeViewportWithFallback } from "../virtualList";

const ROW_HEIGHT = 22;
/** แถวหัวตาราง: อยู่ในพื้นที่เลื่อนแบบ sticky จึงเป็นระยะเว้นต้นของ virtual list */
const HEADER_HEIGHT = 22;
/** ใกล้ท้ายรายการเท่านี้ (พิกเซล) ยังนับว่าอยู่ท้ายรายการ */
const BOTTOM_SLACK = ROW_HEIGHT;
/** ขนาดพื้นที่เห็นที่ใช้เมื่อยังวัดไม่ได้ (jsdom, หน้าต่างเพิ่งสร้าง) = ขนาดตั้งต้นของหน้าต่าง */
const FALLBACK_RECT: Rect = { width: 720, height: 280 };
const observeViewport = observeViewportWithFallback(FALLBACK_RECT);

const TABS: { tab: MessageTab; label: LabelKey }[] = [
  { tab: "all", label: "mv.tab.all" },
  { tab: "error", label: "mv.tab.errors" },
  { tab: "info", label: "mv.tab.infos" },
  { tab: "warning", label: "mv.tab.warnings" },
];

const LEVELS: Record<MessageLevel, { label: LabelKey; Icon: LucideIcon }> = {
  info: { label: "mv.level.info", Icon: Info },
  warning: { label: "mv.level.warning", Icon: TriangleAlert },
  error: { label: "mv.level.error", Icon: CircleX },
};

export function MessageViewer({ panelId }: Partial<PanelProps>) {
  const { format } = useTimeFormatter();
  const lists: Record<MessageTab, Message[]> = {
    all: useVisibleMessages("all"),
    error: useVisibleMessages("error"),
    info: useVisibleMessages("info"),
    warning: useVisibleMessages("warning"),
  };
  const [tab, setTab] = useState<MessageTab>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Message | null>(null);
  const items = lists[tab];
  const selectedIndex = selected === null ? -1 : items.findIndex((m) => messageKey(m) === selected);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** รายการอยู่ที่ท้ายอยู่ (หรือกำลังจะไปท้าย): ข้อความใหม่เลื่อนตาม */
  const stick = useRef(true);
  const tabRefs = useRef<Record<MessageTab, HTMLButtonElement | null>>({ all: null, error: null, info: null, warning: null });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    paddingStart: HEADER_HEIGHT,
    initialRect: FALLBACK_RECT,
    observeElementRect: observeViewport,
    getItemKey: (index) => (items[index] === undefined ? index : messageKey(items[index])),
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  }, [items.length, tab]);

  // แท็บที่ถูกซ่อนแล้วกลับมาแสดง (หรือหน้าต่างเปลี่ยนขนาด) ตำแหน่งเลื่อนอาจหายไป: ถ้ากำลังตามข้อความล่าสุดอยู่ก็กลับไปท้ายรายการ
  usePanelResize(panelId ?? "", () => {
    const el = scrollRef.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el !== null) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
  };

  const timeText = (m: Message): string => {
    const d = parseIsoUtc(m.time);
    return d === null ? m.time : format(d);
  };

  const openDetails = (m: Message): void => {
    setSelected(messageKey(m));
    setDetails(m);
  };

  const move = (index: number): void => {
    const m = items[index];
    if (m === undefined) return;
    setSelected(messageKey(m));
    virtualizer.scrollToIndex(index, { align: "auto" });
  };

  const onGridKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const last = items.length - 1;
    switch (e.key) {
      case "ArrowDown":
        move(selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, last));
        break;
      case "ArrowUp":
        move(selectedIndex < 0 ? last : Math.max(selectedIndex - 1, 0));
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "Enter":
        if (selectedIndex >= 0) setDetails(items[selectedIndex]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onTabKeyDown = (e: KeyboardEvent): void => {
    const at = TABS.findIndex((x) => x.tab === tab);
    const next = e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at + TABS.length - 1) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    chooseTab(TABS[next].tab);
    tabRefs.current[TABS[next].tab]?.focus();
  };

  const chooseTab = (next: MessageTab): void => {
    stick.current = true; // แท็บใหม่เปิดที่ข้อความล่าสุด
    setTab(next);
  };

  const selectedMessage = selectedIndex >= 0 ? items[selectedIndex] : null;

  return (
    <div className="mv">
      <div className="mv-tabs" role="tablist" aria-label={t("window.messageViewer")} onKeyDown={onTabKeyDown}>
        {TABS.map(({ tab: id, label }) => (
          <button
            key={id}
            ref={(el) => { tabRefs.current[id] = el; }}
            id={`mv-tab-${id}`}
            type="button"
            role="tab"
            className="mv-tab"
            aria-selected={tab === id}
            aria-controls="mv-panel"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => chooseTab(id)}
          >
            {`${t(label)} (${lists[id].length})`}
          </button>
        ))}
      </div>

      <div id="mv-panel" className="mv-panel" role="tabpanel" aria-labelledby={`mv-tab-${tab}`}>
        <div ref={scrollRef} className="mv-scroll" onScroll={onScroll}>
          <div
            className="mv-body"
            role="grid"
            aria-label={t("window.messageViewer")}
            aria-rowcount={items.length + 1}
            tabIndex={0}
            style={{ height: virtualizer.getTotalSize() }}
            onKeyDown={onGridKeyDown}
          >
            <div className="mv-row mv-head" role="row" aria-rowindex={1}>
              <span role="columnheader">{t("mv.col.time")}</span>
              <span role="columnheader">{t("mv.col.level")}</span>
              <span role="columnheader">{t("mv.col.code")}</span>
              <span role="columnheader">{t("mv.col.object")}</span>
              <span role="columnheader">{t("mv.col.message")}</span>
            </div>
            {virtualizer.getVirtualItems().map((item) => {
              const m = items[item.index];
              if (m === undefined) return null;
              const { label, Icon } = LEVELS[m.level];
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  aria-selected={item.index === selectedIndex}
                  data-level={m.level}
                  className="mv-row"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                  onClick={() => setSelected(messageKey(m))}
                  onDoubleClick={() => openDetails(m)}
                >
                  <span role="gridcell" className="mv-time">{timeText(m)}</span>
                  <span role="gridcell" className={`mv-level mv-level-${m.level}`}>
                    <Icon size={12} aria-hidden="true" />
                    {t(label)}
                  </span>
                  <span role="gridcell" className="mv-code">{m.code}</span>
                  <span role="gridcell" className="mv-object">{m.object ?? ""}</span>
                  <span role="gridcell" className="mv-text" title={m.text}>{m.text}</span>
                </div>
              );
            })}
          </div>
          {items.length === 0 && <p className="mv-empty">{msg("mv.empty")}</p>}
        </div>
      </div>

      <div className="mv-buttons">
        <button
          type="button"
          className="btn"
          disabled={selectedMessage === null}
          title={selectedMessage === null ? msg("mv.selectFirst") : undefined}
          onClick={() => selectedMessage !== null && setDetails(selectedMessage)}
        >
          {t("mv.details")}
        </button>
        <span className="mv-spacer" />
        <button type="button" className="btn" onClick={() => useMessages.getState().clearTab(tab)}>
          {t("mv.clearTab")}
        </button>
        <button type="button" className="btn" onClick={() => useMessages.getState().clearAll()}>
          {t("mv.clearAll")}
        </button>
      </div>

      <DetailsDialog message={details} time={details === null ? "" : timeText(details)} onClose={() => setDetails(null)} />
    </div>
  );
}

/** กล่อง Details: ข้อความเต็ม รายละเอียด รหัส object และเวลาของข้อความที่เลือก */
function DetailsDialog({ message, time, onClose }: { message: Message | null; time: string; onClose(): void }) {
  const returnFocus = useReturnFocus(message !== null); // ปิดแล้วกลับไปที่ปุ่ม Details หรือรายการ (คีย์ลูกศรใช้ต่อได้)
  return (
    <Dialog.Root open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg mv-dialog" aria-describedby={undefined} onCloseAutoFocus={returnFocus.onCloseAutoFocus}>
          <Dialog.Title className="dlg-title">{t("mv.details")}</Dialog.Title>
          {message !== null && (
            <div className="mv-dialog-body">
              <dl className="mv-fields">
                <dt>{t("mv.col.time")}</dt>
                <dd className="mv-mono">{time}</dd>
                <dt>{t("mv.col.level")}</dt>
                <dd>{t(LEVELS[message.level].label)}</dd>
                <dt>{t("mv.col.code")}</dt>
                <dd className="mv-mono">{message.code}</dd>
                {message.object !== null && message.object !== "" && (
                  <>
                    <dt>{t("mv.col.object")}</dt>
                    <dd className="mv-mono">{message.object}</dd>
                  </>
                )}
                <dt>{t("mv.col.message")}</dt>
                <dd className="mv-full">{message.text}</dd>
              </dl>
              {message.detail !== undefined && message.detail !== null && message.detail !== "" ? (
                <pre className="dlg-detail">{message.detail}</pre>
              ) : (
                <p className="mv-nodetail">{msg("mv.noDetail")}</p>
              )}
            </div>
          )}
          <div className="dlg-buttons">
            <button type="button" className="btn" onClick={onClose}>
              {t("dialog.windows.close")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** ลงทะเบียน Message Viewer เป็นหน้าต่างชนิด messageViewer (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตามที่ลงไว้ใน layout/panels.ts ลงซ้ำได้ */
export function registerMessageViewerPanel(): void {
  const base = getPanelDef("messageViewer");
  if (base === undefined) throw new Error('panel kind "messageViewer" is not registered');
  registerPanel("messageViewer", { ...base, component: MessageViewer });
}
