// Help → STK UI Reference (W21): ตารางของ labels.ts ทั้งหมด (Text, Source, STK ref) พร้อมช่องกรอง ไม่ต่อเน็ต
// ใช้ TanStack Table (global filter แบบ includesString: ตัวพิมพ์ไม่สำคัญ ตรงกับช่องใดช่องหนึ่งก็ผ่าน) ประมาณ 370 แถวเรียบง่าย วาดทั้งหมดได้โดยไม่ต้องทำ virtual list

import {
  columnFilteringFeature, createColumnHelper, createFilteredRowModel, filterFn_includesString, globalFilteringFeature, tableFeatures, useTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { labels, t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import type { PanelProps } from "../../layout/panels";

interface Row {
  text: string;
  /** ชื่อที่แสดงของ source: "STK" หรือ "Added by GNSS Studio" */
  source: string;
  /** "STK ref §A" ฯลฯ; รายการที่เพิ่มเองไม่มี = "" */
  ref: string;
}

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
});
const helper = createColumnHelper<typeof features, Row>();

// ข้อความหัวคอลัมน์มาจากตารางชื่อ (t) ซึ่งคงที่ตลอดอายุแอป จึงสร้างครั้งเดียวที่ระดับโมดูลได้ (TanStack ต้องการ columns ที่ identity คงที่)
const columns = helper.columns([
  helper.accessor("text", { id: "text", header: () => t("help.colText") }),
  helper.accessor("source", { id: "source", header: () => t("help.colSource") }),
  helper.accessor("ref", { id: "ref", header: () => t("help.colRef") }),
]);

const ROWS: Row[] = Object.values(labels).map((label) => ({
  text: label.text,
  source: label.source === "stk" ? t("help.sourceStk") : t("help.sourceOurs"),
  ref: label.ref ?? "",
}));

export function StkReference(_props: Partial<PanelProps>) {
  const [query, setQuery] = useState("");
  const table = useTable({
    features,
    columns,
    data: ROWS,
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: () => true,
    state: { globalFilter: query },
    onGlobalFilterChange: (updater) => setQuery((previous) => (typeof updater === "function" ? updater(previous) : updater)),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className="stkref">
      <div className="stkref-bar">
        <input
          type="search"
          className="field stkref-filter"
          aria-label={t("dialog.catalog.search")}
          placeholder={t("dialog.catalog.search")}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="stkref-count">{msg("stkRef.count", { shown: rows.length, total: ROWS.length })}</span>
      </div>
      <div className="stkref-scroll">
        <table className="stkref-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="stkref-none">{msg("stkRef.noMatch")}</p>}
      </div>
    </div>
  );
}
