import { ImportSatellites } from "./ImportSatellites";
// Search Satellite Catalog (spec §11, STK ref §B "Search Standard Object Data"): เลือกดาวจาก snapshot ที่ scenario ใช้แล้ว Insert ด้วยคำขอเดียว
// - Data Sources: Local snapshot (ตั้งต้น) / Online CelesTrak ซึ่งแค่เปิด Fetch Orbit Data (การดึงจริงอยู่ที่ปุ่ม Fetch Now ของหน้านั้นที่ถามยืนยันก่อน) แล้วคืนตัวเลือกเป็น Local snapshot
// - ดึง GET /catalog?snapshot&start&stop ครั้งเดียวต่อการเปิดหน้าต่าง (ซ้ำเฉพาะเมื่อ snapshot หรือช่วงวิเคราะห์ของ scenario เปลี่ยน) แล้วกรองในหน้าเว็บ:
//   System (ทั้งหมด / G / R / E / C / Imaging = X) และคำค้น (ไม่สนตัวพิมพ์ ค้น PRN SVN NORAD Block ชื่อ CelesTrak และชื่อที่แสดง)
//   Imaging กับ snapshot ที่ไม่มีดาวถ่ายภาพเลย (orbit_snapshot ตั้งตอนสร้าง scenario: Fetch ใหม่ไม่เติมให้ scenario เดิม) = ข้อความบอกทางแทน "ไม่พบดาว"
// - ตาราง PRN, SVN, NORAD, Block, Name (display_name: ดาวถ่ายภาพ = ชื่อ preset เช่น Terra, GNSS = ชื่อ CelesTrak), Age, Status (ธง; ดาวที่อยู่ใน scenario แล้ว = "มีแล้ว") เลือกหลายแถว: คลิก, Ctrl/Cmd-คลิก (เพิ่ม/เอาออก),
//   Shift-คลิก (ช่วงจากแถวที่คลิกล่าสุด; Ctrl+Shift เพิ่มช่วง) คีย์บอร์ด: ลูกศรเลื่อน (Shift ขยายช่วง) Space สลับ Ctrl/Cmd+A เลือกทั้งหมดที่เห็น
//   แถวที่มี NORAD ตรงกับดาวใน scenario เลือกไม่ได้ ตัวกรองที่ซ่อนแถวที่เลือกไว้ = เอาแถวนั้นออกจากที่เลือก (Insert ส่งเฉพาะที่เห็นอยู่)
// - Create Constellation from Selected + ชื่อ (กติกาชื่อเดียวกับ server และไม่ซ้ำ object ใน scenario) Insert = POST /objects ครั้งเดียวพร้อม norads ทั้งหมด
//   (ตามลำดับในตาราง) สำเร็จ = เลือก object แรกที่สร้างและปิดหน้าต่าง; 409/422 ขึ้นที่ช่องชื่อ (create_constellation) หรือเหนือปุ่ม (norads)
// - Add Primary Sensor (ข2 Ruling m, ติ๊กเป็นค่าตั้งต้น): ส่ง primary_sensors: true เฉพาะเมื่อติ๊กและที่เลือกมีดาวถ่ายภาพ (X) อย่างน้อยหนึ่งดวง
//   ไม่งั้นไม่มีช่องนี้ (Insert ของ GNSS ล้วนส่งเหมือนเดิมทุกไบต์)
// - ตารางนี้ไม่ใช้ virtual list: catalog สี่ระบบมีราว 130 ดาว (ราว 1,000 เซลล์) ซึ่ง DOM จัดการได้สบาย

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { apiGet, errorText } from "../../api/client";
import { isObjectName } from "../../api/names";
import { isConflict, isFieldError, reportWriteError } from "../../api/writes";
import { FormField } from "../../chrome/FormField";
import type { CatalogEntry } from "../../data/catalog";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { useLayout } from "../../stores/layout";
import { useScenario } from "../../stores/scenario";
import { parseIsoUtc } from "../../time/parse";
import { insertObjects } from "../InsertObjects/insert";
import { flagLine, flagName } from "../ObjectBrowser/tree";

type Load = { status: "loading" } | { status: "ready"; entries: CatalogEntry[] } | { status: "error"; message: string };

const SYSTEM_OPTIONS = [
  { value: "", label: "option.system.all" },
  { value: "G", label: "option.system.gps" },
  { value: "R", label: "option.system.glonass" },
  { value: "E", label: "option.system.galileo" },
  { value: "C", label: "option.system.beidou" },
  { value: "X", label: "option.system.imaging" },
  { value: "U", label: "option.system.custom" },
] as const;

/** อักษรระบบของดาวถ่ายภาพ (IMAGING_LETTER ของ engine) */
const IMAGING = "X";

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

const text = (x: unknown): string => (typeof x === "string" ? x : "");

/**
 * แถวจาก server -> CatalogEntry ที่หน้าต่างอ่านได้โดยไม่ล้ม: ต้องมี PRN (ข้อความ), system (ข้อความ) และ NORAD (เลขจำนวนเต็ม) ไม่งั้นทิ้ง (แยกดาวไม่ได้)
 * ช่องอื่นที่ผิดชนิดหรือเป็น null (SVN, block, ชื่อ CelesTrak = "" ; age_days = NaN แสดง "—" ; flags เก็บเฉพาะที่เป็นข้อความ)
 */
function toEntry(x: unknown): CatalogEntry | null {
  if (!isRecord(x) || typeof x.prn !== "string" || typeof x.system !== "string" || !Number.isInteger(x.norad)) return null;
  return {
    prn: x.prn,
    system: x.system,
    svn: text(x.svn),
    norad: x.norad as number,
    block: text(x.block),
    celestrak_name: text(x.celestrak_name),
    omm_epoch: text(x.omm_epoch),
    age_days: typeof x.age_days === "number" ? x.age_days : Number.NaN,
    flags: Array.isArray(x.flags) ? x.flags.filter((f): f is string => typeof f === "string") : [],
    // server ก่อน ข2 ไม่ส่งสองช่องนี้: แยกชนิดจากอักษรระบบ ชื่อที่แสดง = ชื่อ CelesTrak
    category: typeof x.category === "string" ? x.category : x.system === IMAGING ? "imaging" : "gnss",
    display_name: typeof x.display_name === "string" && x.display_name !== "" ? x.display_name : text(x.celestrak_name),
  };
}

const displayName = (entry: CatalogEntry): string => entry.display_name ?? entry.celestrak_name;
const isImaging = (entry: CatalogEntry): boolean => entry.category === "imaging" || entry.system === IMAGING;

/** ISO ที่ server รับ: เหมือน store (Date.toISOString()) อ่านไม่ได้ก็ส่งตามที่เก็บไว้ ให้ server เป็นคนปฏิเสธ */
const isoOf = (text: string): string => parseIsoUtc(text)?.toISOString() ?? text;

function queryOf(snapshot: string, start: string, stop: string): string {
  return new URLSearchParams({ snapshot, start: isoOf(start), stop: isoOf(stop) }).toString();
}

function matches(entry: CatalogEntry, needle: string): boolean {
  return [entry.prn, entry.svn, String(entry.norad), entry.block, entry.celestrak_name, displayName(entry)].some((field) => field.toLowerCase().includes(needle));
}

const ageText = (days: number): string => (Number.isFinite(days) ? `${days.toFixed(1)} d` : "—");

export function SatelliteCatalog({ panelId = "satelliteCatalog", params = {} }: Partial<PanelProps>) {
  const doc = useScenario((s) => s.doc);
  const snapshot = doc?.orbit_snapshot;
  const start = doc?.analysis_period.start;
  const stop = doc?.analysis_period.stop;
  const query = snapshot === undefined || start === undefined || stop === undefined ? null : queryOf(snapshot, start, stop);

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [system, setSystem] = useState(params.catalogMode === "gnss" ? "gnss" : "");
  useEffect(() => {
    if (params.requestId !== undefined) setSystem(params.catalogMode === "gnss" ? "gnss" : "");
  }, [params.requestId, params.catalogMode]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [makeConstellation, setMakeConstellation] = useState(false);
  const [constellationName, setConstellationName] = useState("");
  const [primarySensors, setPrimarySensors] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLElement>());

  // ครั้งเดียวต่อการเปิดหน้าต่าง และต่อ (snapshot, ช่วงวิเคราะห์) ใหม่ — การแก้ส่วนอื่นของ scenario ไม่ทำให้ดึงซ้ำ
  useEffect(() => {
    if (query === null) return;
    const ctl = new AbortController();
    setLoad({ status: "loading" });
    apiGet<unknown>(`/catalog?${query}`, { signal: ctl.signal })
      .then(({ data }) => {
        if (!Array.isArray(data)) throw new RangeError("the catalog is not a list");
        setLoad({ status: "ready", entries: data.flatMap((x) => toEntry(x) ?? []) });
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setLoad({ status: "error", message: errorText(e) });
      });
    return () => ctl.abort();
  }, [query]);

  // NORAD ของดาวที่อยู่ใน scenario แล้ว (จับคู่ด้วย NORAD ไม่ใช่ชื่อ: ดาวที่เปลี่ยนชื่อก็นับ)
  const present = useMemo(
    () => new Set((doc?.objects ?? []).flatMap((o) => (o.class === "Satellite" ? [o.norad] : []))),
    [doc],
  );
  const entries = load.status === "ready" ? load.entries : null;
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => (system === "" || (system === "gnss" ? ["G", "R", "E", "C"].includes(e.system) : e.system === system)) && (needle === "" || matches(e, needle)));
  }, [entries, system, search]);
  const selectable = useMemo(() => visible.filter((e) => !present.has(e.norad)), [visible, present]);
  // System = Imaging แต่ snapshot ของ scenario ไม่มีดาวถ่ายภาพเลย: บอกทาง (Fetch ใหม่แล้วสร้าง scenario ใหม่) แทน "ไม่พบดาว"
  const noImaging = system === IMAGING && entries !== null && !entries.some((e) => e.category === "imaging");

  // ตัวกรองซ่อนแถวที่เลือกไว้ = เอาออกจากที่เลือก (กลับมาแสดงแล้วไม่กลับมาเลือกเอง)
  useEffect(() => {
    const shown = new Set(selectable.map((e) => e.norad));
    setSelected((prev) => (Array.from(prev).every((n) => shown.has(n)) ? prev : new Set(Array.from(prev).filter((n) => shown.has(n)))));
  }, [selectable]);

  const chosen = useMemo(() => selectable.filter((e) => selected.has(e.norad)), [selectable, selected]);

  /** ช่วงแถวที่เลือกได้ระหว่างสองแถว (ตามลำดับที่เห็น) */
  const rangeBetween = (from: number, to: number): number[] => {
    const a = visible.findIndex((e) => e.norad === from);
    const b = visible.findIndex((e) => e.norad === to);
    if (a < 0 || b < 0) return [to];
    return visible
      .slice(Math.min(a, b), Math.max(a, b) + 1)
      .filter((e) => !present.has(e.norad))
      .map((e) => e.norad);
  };

  /** การเลือกด้วยเมาส์และคีย์บอร์ดใช้ร่วมกัน: toggle = Ctrl/Cmd (เพิ่ม/เอาออกทีละแถว), extend = Shift (ช่วงจากแถวที่ยึดไว้) */
  const choose = (norad: number, mods: { toggle: boolean; extend: boolean }): void => {
    if (present.has(norad) || busy) return;
    setGeneral(null);
    if (mods.extend && anchor !== null && visible.some((e) => e.norad === anchor)) {
      const range = rangeBetween(anchor, norad);
      setSelected((prev) => new Set(mods.toggle ? [...prev, ...range] : range));
      return;
    }
    setAnchor(norad);
    setSelected((prev) => {
      if (!mods.toggle) return new Set([norad]);
      const next = new Set(prev);
      if (next.has(norad)) next.delete(norad);
      else next.add(norad);
      return next;
    });
  };

  const onRowClick = (e: MouseEvent, norad: number): void => choose(norad, { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey });

  const focusRow = (index: number): void => {
    const target = visible[index];
    if (target !== undefined) rowRefs.current.get(target.norad)?.focus();
  };

  const onRowKeyDown = (e: KeyboardEvent, index: number): void => {
    const norad = visible[index].norad;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(visible.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)));
      focusRow(next);
      if (e.shiftKey && next !== index) choose(visible[next].norad, { toggle: false, extend: true });
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      choose(norad, { toggle: true, extend: false });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(selectable.map((x) => x.norad)));
    }
  };

  const pickSource = (source: "local" | "online"): void => {
    // Online CelesTrak: เปิดหน้า Fetch Orbit Data เท่านั้น (ไม่ดึงเอง) ตัวเลือกคงเป็น Local snapshot เพราะรายการในตารางยังมาจาก snapshot ในเครื่อง
    if (source === "online") useLayout.getState().openPanel("fetchOrbitData");
  };

  const close = (): void => useLayout.getState().closePanel(panelId);

  const insert = async (): Promise<void> => {
    if (busy || chosen.length === 0) return;
    setGeneral(null);
    setNameError(null);
    if (makeConstellation) {
      if (!isObjectName(constellationName)) {
        setNameError(msg("ob.nameInvalid"));
        return;
      }
      const taken = (doc?.objects ?? []).find((o) => o.name.toLowerCase() === constellationName.toLowerCase());
      if (taken !== undefined) {
        setNameError(msg("catalog.nameTaken", { name: taken.name }));
        return;
      }
    }
    setBusy(true);
    try {
      await insertObjects({
        class: "Satellite",
        method: "From Satellite Catalog",
        norads: chosen.map((e) => e.norad),
        ...(makeConstellation ? { create_constellation: constellationName } : {}),
        ...(primarySensors && chosen.some(isImaging) ? { primary_sensors: true } : {}),
      });
      close();
    } catch (e) {
      if (isFieldError(e) && e.field === "create_constellation") {
        setNameError(e.text);
      } else if (isFieldError(e) && e.field === "primary_sensors") {
        setGeneral(msg("catalog.primaryClash", { message: e.text })); // ชื่อ sensor หลักทั้งสองแบบถูกใช้แล้ว: บอกทางออก (Insert โดยไม่สร้าง sensor)
      } else if (isFieldError(e)) {
        setGeneral(e.text); // norads: NORAD ที่ไม่มีใน catalog หรือชื่อดาว (PRN) ซ้ำ
      } else {
        reportWriteError(e);
        setGeneral(isConflict(e) ? null : errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const tabbable = focused !== null && visible.some((e) => e.norad === focused) ? focused : visible[0]?.norad;

  return (
    <div className="catalog">
      <ImportSatellites key={params.requestId ?? "default"} initialFormat={params.importFormat === "gpredict_local" ? "gpredict_local" : "norad"} initiallyOpen={params.expandImport === true} />
      <div className="catalog-bar">
        <fieldset className="catalog-sources">
          <legend>{t("dialog.catalog.dataSources")}</legend>
          <label className="insert-choice">
            <input type="radio" name="catalog-source" checked onChange={() => pickSource("local")} />
            {t("dialog.catalog.sourceLocal")}
          </label>
          <label className="insert-choice">
            <input type="radio" name="catalog-source" checked={false} onChange={() => pickSource("online")} />
            {t("dialog.catalog.sourceOnline")}
          </label>
        </fieldset>
        <div className="catalog-filters">
          <FormField label={t("field.system")}>
            {(control) => (
              <select {...control} value={system} onChange={(e) => setSystem(e.target.value)}>
                {(params.catalogMode === "gnss" || system === "gnss") && <option value="gnss">GNSS ทั้ง 4 ระบบ</option>}
                {SYSTEM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={t("dialog.catalog.search")}>
            {(control) => <input {...control} type="text" value={search} spellCheck={false} autoComplete="off" onChange={(e) => setSearch(e.target.value)} />}
          </FormField>
        </div>
      </div>
      <p className="catalog-hint">{msg("catalog.onlineHint")}</p>

      <div className="catalog-scroll">
        {doc === null && <p className="catalog-note">{msg("tooltip.noScenario")}</p>}
        {doc !== null && load.status === "loading" && <p className="catalog-note">{msg("catalog.loading")}</p>}
        {load.status === "error" && (
          <p className="form-error catalog-note" role="alert">
            {msg("catalog.windowFailed", { message: load.message })}
          </p>
        )}
        {doc !== null && load.status === "ready" && (
          <table className="catalog-table" role="grid" aria-multiselectable="true" aria-label={t("window.satelliteCatalog")}>
            <thead>
              <tr>
                <th>{t("field.prn")}</th>
                <th>{t("field.svn")}</th>
                <th>{t("field.norad")}</th>
                <th>{t("field.block")}</th>
                <th>{t("field.name")}</th>
                <th>{t("field.age")}</th>
                <th>{t("field.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e, index) => {
                const there = present.has(e.norad);
                return (
                  <tr
                    key={e.norad}
                    ref={(el) => {
                      if (el === null) rowRefs.current.delete(e.norad);
                      else rowRefs.current.set(e.norad, el);
                    }}
                    className={there ? "catalog-row catalog-present" : "catalog-row"}
                    aria-selected={there ? undefined : selected.has(e.norad)}
                    aria-disabled={there ? true : undefined}
                    tabIndex={e.norad === tabbable ? 0 : -1}
                    onClick={(ev) => onRowClick(ev, e.norad)}
                    onFocus={() => setFocused(e.norad)}
                    onKeyDown={(ev) => onRowKeyDown(ev, index)}
                  >
                    <td>{e.prn}</td>
                    <td>{e.svn}</td>
                    <td className="catalog-num">{e.norad}</td>
                    <td>{e.block}</td>
                    <td>{displayName(e)}</td>
                    <td className="catalog-num">{ageText(e.age_days)}</td>
                    <td title={e.flags.length === 0 ? undefined : e.flags.map(flagLine).join("\n")}>
                      {there ? msg("catalog.inScenario") : e.flags.map(flagName).join(", ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {doc !== null && load.status === "ready" && visible.length === 0 && (
          <p className="catalog-note">
            {noImaging ? msg("catalog.noImaging", { snapshot: snapshot ?? "" }) : msg("catalog.noMatch")}
          </p>
        )}
      </div>

      <div className="catalog-footer">
        <div className="catalog-constellation">
          <label className="catalog-check">
            <input
              type="checkbox"
              checked={makeConstellation}
              disabled={busy}
              onChange={(e) => {
                setMakeConstellation(e.target.checked);
                setNameError(null);
              }}
            />
            {t("dialog.catalog.createConstellation")}
          </label>
          <FormField label={t("field.name")} error={nameError}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={constellationName}
                disabled={!makeConstellation || busy}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setConstellationName(e.target.value);
                  setNameError(null);
                }}
              />
            )}
          </FormField>
        </div>
        <label className="catalog-check">
          <input type="checkbox" checked={primarySensors} disabled={busy} onChange={(e) => setPrimarySensors(e.target.checked)} />
          {t("dialog.catalog.addPrimarySensor")}
        </label>
        {general !== null && (
          <p className="form-error catalog-note" role="alert">
            {general}
          </p>
        )}
        <div className="catalog-actions">
          <span className="catalog-count">{msg("catalog.selected", { n: chosen.length })}</span>
          <button type="button" className="btn" disabled={busy || chosen.length === 0 || doc === null} onClick={() => void insert()}>
            {t("dialog.catalog.insert")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={close}>
            {t("dialog.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ลงทะเบียน Search Satellite Catalog เป็นหน้าต่างชนิด satelliteCatalog (แทนตัวแทนชั่วคราว) ชื่อ ชนิด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerSatelliteCatalogPanel(): void {
  const base = getPanelDef("satelliteCatalog");
  if (base === undefined) throw new Error('panel kind "satelliteCatalog" is not registered');
  registerPanel("satelliteCatalog", { ...base, component: SatelliteCatalog, size: { width: 820, height: 540 } });
}
