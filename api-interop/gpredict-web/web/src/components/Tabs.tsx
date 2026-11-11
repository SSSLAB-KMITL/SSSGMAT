import { useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { reorderTabs } from "../tabs";

interface Props {
  tabs: readonly string[];
  active: string | null;
  onSelect: (name: string) => void;
  /** new order after a drag; the caller saves it with PUT /api/session/tabs */
  onReorder: (order: string[]) => void;
}

/** Notebook tabs, labelled with the module name. Hidden when only one module is open; drag a tab to reorder (ref §1). */
export function Tabs({ tabs, active, onSelect, onReorder }: Props) {
  // the tab being dragged: a ref for the handlers (events can follow each other before a re-render), state for the styles
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (tabs.length <= 1) return null;

  const end = () => {
    dragged.current = null;
    setDragging(null);
    setOver(null);
  };
  const dragStart = (e: DragEvent, name: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", name); // Firefox starts no drag without data
    dragged.current = name;
    setDragging(name);
  };
  const dragOver = (e: DragEvent, name: string) => {
    if (dragged.current === null) return; // not one of our tabs
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(name);
  };
  const drop = (e: DragEvent, name: string) => {
    e.preventDefault();
    const from = dragged.current;
    if (from !== null && from !== name) onReorder(reorderTabs(tabs, from, name));
    end();
  };
  const key = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    const target = to === null ? undefined : tabs[to];
    if (target !== undefined) {
      e.preventDefault();
      onSelect(target);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(tabs[i]!);
    }
  };

  return (
    <div className="tabs" role="tablist">
      {tabs.map((name, i) => (
        <div
          key={name}
          role="tab"
          aria-selected={name === active}
          tabIndex={name === active ? 0 : -1}
          draggable
          className={`tab${name === active ? " active" : ""}${over === name && dragging !== name ? " drop-target" : ""}${dragging === name ? " dragging" : ""}`}
          onClick={() => onSelect(name)}
          onKeyDown={(e) => key(e, i)}
          onDragStart={(e) => dragStart(e, name)}
          onDragOver={(e) => dragOver(e, name)}
          onDrop={(e) => drop(e, name)}
          onDragEnd={end}
        >
          {name}
        </div>
      ))}
    </div>
  );
}
