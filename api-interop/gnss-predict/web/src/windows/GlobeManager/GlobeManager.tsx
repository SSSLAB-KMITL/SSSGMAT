// Globe Manager (imagery spec §5.1, spec ภาพละเอียด §4.2-§4.3): ภาพพื้นโลกออนไลน์แบ่งเป็นสี่กลุ่มตามแหล่ง ตามลำดับ NASA GIBS, Sentinel-2 cloudless (EOX), OpenStreetMap, Cesium ion
// - แต่ละกลุ่มมีสวิตช์ของตัวเองซึ่งเป็นของ server (settings.json) เปลี่ยนผ่าน useImagery.setSource(id, on) (GET แล้ว PUT /settings ทั้งเอกสาร ที่แก้แค่ช่องของแหล่งนั้น)
//   เปิด = ถามยืนยันภาษาไทยก่อนทุกครั้ง (กล่องเดียวกับ confirm ของแอป) ข้อความของแต่ละแหล่งบอก host สิ่งที่ส่งออก และบอกว่า server หรือ browser เป็นผู้ติดต่อ (messages.th.ts)
//   ยกเลิก (หรือ Esc) = ไม่ส่งอะไรเลย ปิด = PUT ทันทีไม่ถาม ล้มเหลว = store รายงานคำเตือนไทยเอง (ระบุชื่อแหล่ง) และสวิตช์คงค่าเดิม (ที่นี่ไม่แสดงซ้ำ)
//   การบันทึกทุกอย่างของหน้าต่างนี้ (สวิตช์ และ token) เป็น GET-แก้-PUT ทั้งเอกสาร จึงทำทีละอย่าง: ระหว่างถามและระหว่างบันทึกกดอะไรซ้ำไม่ได้ทั้งหน้าต่าง
// - ตารางชั้นภาพของแต่ละกลุ่ม: แถว Natural Earth II (ออฟไลน์ เป็นฐานเสมอ ปิดไม่ได้ อยู่นอกกลุ่ม) แล้ว GIBS ตามลำดับที่ server ส่ง, EOX (ชั้นของ catalog source eox), OpenStreetMap (OSM_LAYER คงที่)
//   Show และ % Translucency ของแต่ละชั้นอยู่ใน workbook (useLayout.globe: ใช้ร่วมกันทุกหน้าต่าง 3D และ Sensor View) ที่นี่ไม่เก็บค่าเอง
//   ค่าตั้งต้น (Blue Marble + VIIRS NOAA-20 + Sentinel-2 cloudless + OpenStreetMap แสดง) มาจาก DEFAULT_GLOBE: เปิดสวิตช์จึงไม่เขียนทับค่าที่ผู้ใช้เลือกไว้
// - % Translucency ส่งเข้า setGlobeLayer เฉพาะจำนวนเต็ม 0-100 (store ไม่ตรวจเอง): พิมพ์แล้วบันทึกเมื่อออกจากช่องหรือกด Enter, ค่าไม่ถูกต้องคืนค่าเดิม, Escape ยกเลิก
// - แถวของกลุ่มใช้ได้เมื่อสวิตช์ของแหล่งนั้นเปิด (ปิด = แถวปิดใช้พร้อมคำอธิบายของกลุ่ม) อ่านสวิตช์และรายการจาก server ไม่ได้ (loaded = false) =
//   ทุกสวิตช์ปิดใช้พร้อมข้อความไทยหนึ่งข้อความ เหลือแต่ Natural Earth II
// - Cesium ion: ช่อง token (password ไม่ใส่ค่าที่บันทึกไว้กลับลงช่อง ไม่แสดงเป็นข้อความ บอกแค่ว่ามีหรือไม่) บันทึกด้วย PUT ทั้งเอกสารที่เก็บทุกสวิตช์ไว้ตามที่ server มี
//   ไม่เขียน token ลง console, Message Viewer หรือ URL; ข้อความผิดพลาดมีแต่ข้อความของ server/เครือข่าย
//   บันทึกสำเร็จแล้วสวิตช์ทุกแหล่งตามเอกสารที่ server ตอบ (useImagery.updateSettings ตัวเดียวกับสวิตช์) ; ปิดสวิตช์ ion สำเร็จ = ลืมการปฏิเสธของ ion (setIonFailure(null))
//   asset แบบ radio (None, preset ของ ionAssets.ts, Asset ID ที่กรอกเอง จำนวนเต็ม > 0) เขียนลง useLayout.globe.ion; เปิดสวิตช์ ion ที่ยังไม่มี asset = เลือก preset แรก
//   ion แสดงอยู่ (ionState.ts: สวิตช์ ion เปิด + มี asset + มี token และ ion ไม่ปฏิเสธ) = ชั้นอื่นทั้งหมดถูกซ่อนในทุก viewer: ทุกแถวของแหล่งอื่น (รวม Natural Earth II) บอกด้วยข้อความไทย

import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from "react";
import { errorText } from "../../api/client";
import { ION_PRESETS } from "../../cesium/ionAssets";
import { ionStatus, onIonStatusChange, setIonFailure, type IonStatus } from "../../cesium/ionState";
import { confirm } from "../../chrome/Dialogs";
import { t, type LabelKey } from "../../labels/labels";
import { msg, type MsgKey } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import { isIonAssetId, type GlobeLayerSetting } from "../../layout/workbook";
import { OSM_LAYER, useImagery, type ImageryLayerInfo, type ImagerySourceId } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";
import { useSettings } from "../../stores/settings";

/** จำนวนเต็ม 0-100 (ตัวเลข ASCII เท่านั้น เว้นวรรคหัวท้ายได้) ไม่ใช่ = null */
function parseTranslucency(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
}

/** Asset ID ที่กรอกเอง: ตัวเลข ASCII ล้วน (เว้นวรรคหัวท้ายได้) เป็นจำนวนเต็มปลอดภัย > 0 ไม่ใช่ = null */
function parseAssetId(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return isIonAssetId(n) ? n : null;
}

interface SourceDef {
  id: ImagerySourceId;
  /** ป้ายของสวิตช์ (และชื่อของกลุ่ม) */
  label: LabelKey;
  consent: MsgKey;
  /** ข้อความของกลุ่มตอนสวิตช์ปิด */
  offHint: MsgKey;
}

/** สี่กลุ่มตามลำดับบนจอ (ลำดับเดียวกับลำดับวาด ยกเว้น ion ที่แสดงแทนทั้งหมด) */
const SOURCES: readonly SourceDef[] = [
  { id: "gibs", label: "field.onlineImagery", consent: "globe.consent", offHint: "globe.offHint" },
  { id: "eox", label: "field.onlineImageryEox", consent: "globe.consentEox", offHint: "globe.offHintEox" },
  { id: "osm", label: "field.onlineImageryOsm", consent: "globe.consentOsm", offHint: "globe.offHintOsm" },
  { id: "ion", label: "field.onlineImageryIon", consent: "globe.consentIon", offHint: "globe.offHintIon" },
];

/** สถานะของ ion ที่วาดซ้ำเมื่อ store ที่มันอ่านเปลี่ยน (สวิตช์, asset, token) หรือเมื่อ ion ปฏิเสธ asset + token (ไม่ได้มาจาก store) */
function useIonStatus(): IonStatus {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onIonStatusChange(redraw), []);
  useImagery((s) => s.sources.ion);
  useLayout((s) => s.globe.ion?.assetId);
  useSettings((s) => s.settings?.cesium_ion_token);
  return ionStatus();
}

interface TranslucencyInputProps {
  label: string;
  /** ค่าที่ store ถืออยู่ */
  value: number;
  disabled: boolean;
  onCommit(n: number): void;
}

/** ช่อง % Translucency: พิมพ์ได้อิสระ ค่าที่ถูกต้องและต่างจากเดิมส่งผ่าน onCommit เมื่อออกจากช่องหรือกด Enter; นอกนั้นคืนค่าที่ store ถือ */
function TranslucencyInput({ label, value, disabled, onCommit }: TranslucencyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const n = parseTranslucency(draft);
    setDraft(null);
    if (n !== null && n !== value) onCommit(n);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      className="field globe-num"
      aria-label={label}
      value={draft ?? String(value)}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

const NO_SETTING: GlobeLayerSetting = { show: false, translucency: 0 };

/** ข้อความท้ายชื่อแถวที่ถูกซ่อนเพราะ ion แสดงอยู่ */
function HiddenNote({ hidden }: { hidden: boolean }) {
  return hidden ? <span className="globe-note">{msg("globe.hiddenByIon")}</span> : null;
}

function LayerRow({ info, disabled, hiddenByIon }: { info: ImageryLayerInfo; disabled: boolean; hiddenByIon: boolean }) {
  const setting = useLayout((s) => s.globe.layers[info.id]) ?? NO_SETTING;
  const setGlobeLayer = useLayout((s) => s.setGlobeLayer);
  return (
    <tr>
      <th scope="row" title={info.credit}>
        {info.title}
        <HiddenNote hidden={hiddenByIon} />
      </th>
      <td>
        <input
          type="checkbox"
          className="form-check"
          aria-label={`${info.title} ${t("ob.show")}`}
          checked={setting.show}
          disabled={disabled}
          onChange={(e) => setGlobeLayer(info.id, { show: e.target.checked })}
        />
      </td>
      <td>
        <TranslucencyInput
          label={`${info.title} ${t("field.translucency")}`}
          value={setting.translucency}
          disabled={disabled}
          onCommit={(translucency) => setGlobeLayer(info.id, { translucency })}
        />
      </td>
    </tr>
  );
}

/** ตารางหนึ่งตาราง (หัวคอลัมน์ Layer, Show, % Translucency) ของกลุ่มหรือของภาพฐาน */
function LayerTable({ children }: { children: ReactNode }) {
  return (
    <table className="globe-table">
      <thead>
        <tr>
          <th scope="col">{t("field.globeLayer")}</th>
          <th scope="col">{t("ob.show")}</th>
          <th scope="col">{t("field.translucency")}</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** Natural Earth II: ภาพฐานออฟไลน์ ติ๊กไว้และเปลี่ยนไม่ได้ (ion แสดงอยู่ = alpha 0 จึงบอกเหมือนแถวอื่น) */
function BaseRow({ hiddenByIon }: { hiddenByIon: boolean }) {
  const naturalEarth = t("option.globe.naturalEarthII");
  return (
    <tr>
      <th scope="row">
        {naturalEarth}
        <HiddenNote hidden={hiddenByIon} />
      </th>
      <td>
        <input type="checkbox" className="form-check" aria-label={`${naturalEarth} ${t("ob.show")}`} checked disabled />
      </td>
      <td>
        <input type="text" className="field globe-num" aria-label={`${naturalEarth} ${t("field.translucency")}`} value="0" disabled />
      </td>
    </tr>
  );
}

interface GroupProps {
  def: SourceDef;
  on: boolean;
  /** สวิตช์ใช้ไม่ได้ (อ่านจาก server ไม่ได้ หรือกำลังบันทึก/ถามอยู่) */
  locked: boolean;
  loaded: boolean;
  onToggle(on: boolean): void;
  children?: ReactNode;
}

/** กลุ่มของหนึ่งแหล่ง: สวิตช์ ข้อความตอนปิด และเนื้อหาของกลุ่ม */
function SourceGroup({ def, on, locked, loaded, onToggle, children }: GroupProps) {
  return (
    <section className="globe-group" aria-label={t(def.label)}>
      <label className="globe-switch">
        <input type="checkbox" className="form-check" checked={on} disabled={locked} onChange={(e) => onToggle(e.target.checked)} />
        <span>{t(def.label)}</span>
      </label>
      {loaded && !on && <p className="globe-hint">{msg(def.offHint)}</p>}
      {loaded && children}
    </section>
  );
}

/** แก้ token ใน settings.json: อ่านค่าล่าสุดก่อนแล้ว PUT ทั้งเอกสาร (สวิตช์ทุกแหล่งและ daily กลับไปตามที่ server มี) แล้วสวิตช์ตามเอกสารที่ server ตอบ เหมือนการเปลี่ยนสวิตช์ */
const saveToken = (token: string): Promise<void> => useImagery.getState().updateSettings((current) => ({ ...current, cesium_ion_token: token }));

interface IonProps {
  /** สวิตช์ ion เปิดอยู่ */
  on: boolean;
  busy: boolean;
  /** ทำงานที่แก้เอกสารค่าตั้งทีละอย่าง (ผู้เรียกกัน busy) */
  exclusive(task: () => Promise<void>): Promise<void>;
  status: IonStatus;
}

/** ช่อง token และตัวเลือก asset ของกลุ่ม Cesium ion */
function IonSettings({ on, busy, exclusive, status }: IonProps) {
  const settings = useSettings((s) => s.settings);
  const assetId = useLayout((s) => s.globe.ion?.assetId ?? null);
  const setGlobeIon = useLayout((s) => s.setGlobeIon);
  const tokenId = useId();
  const radioName = useId();
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [idDraft, setIdDraft] = useState<string | null>(null);
  const [idInvalid, setIdInvalid] = useState(false);
  const idBox = useRef<HTMLInputElement>(null);

  // ค่าตั้งยังไม่อยู่ใน store (ยังไม่เคยเปิดหน้าต่างที่อ่านมัน) = อ่านครั้งเดียวตอนเปิด เพื่อบอกได้ว่ามี token หรือยัง; อ่านไม่ได้ = สถานะ "ไม่ทราบ" (ไม่รายงาน: บันทึกแล้วจะอ่านเอง)
  useEffect(() => {
    if (useSettings.getState().settings === null) useSettings.getState().loadSettings().catch(() => undefined);
  }, []);

  const apply = (): Promise<void> =>
    exclusive(async () => {
      const value = token.trim();
      if (value === "") return;
      setTokenError(null);
      try {
        await saveToken(value);
        setToken("");
      } catch (e) {
        setTokenError(msg("globe.ionTokenSaveFailed", { message: errorText(e) }));
      }
    });

  const tokenStatus = settings === null ? "globe.ionTokenUnknown" : settings.cesium_ion_token.trim() === "" ? "globe.ionTokenUnset" : "globe.ionTokenSet";

  const isPreset = ION_PRESETS.some((p) => p.id === assetId);
  const isCustom = assetId !== null && !isPreset;
  const commitId = (): void => {
    if (idDraft === null) return;
    if (idDraft.trim() === "") {
      setIdDraft(null);
      setIdInvalid(false);
      return;
    }
    const id = parseAssetId(idDraft);
    if (id === null) {
      setIdInvalid(true);
      return;
    }
    setIdDraft(null);
    setIdInvalid(false);
    if (id !== assetId) setGlobeIon(id);
  };

  const radio = (checked: boolean, label: string, onChange: () => void) => (
    <label className="globe-radio">
      <input type="radio" name={radioName} checked={checked} disabled={!on} onChange={onChange} />
      <span>{label}</span>
    </label>
  );

  return (
    <>
      <div className="globe-token">
        <label htmlFor={tokenId}>{t("field.cesiumToken")}</label>
        <input
          id={tokenId}
          type="password"
          className="field"
          value={token}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setToken(e.target.value);
            setTokenError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void apply();
          }}
        />
        <button type="button" className="btn" disabled={busy || token.trim() === ""} onClick={() => void apply()}>
          {t("dialog.apply")}
        </button>
      </div>
      <p className="globe-field-hint">{msg(tokenStatus)}</p>
      {tokenError !== null && (
        <p className="form-error" role="alert">
          {tokenError}
        </p>
      )}

      <div className="globe-assets" role="radiogroup" aria-label={t("field.ionAsset")}>
        {radio(assetId === null, t("option.ionAsset.none"), () => setGlobeIon(null))}
        {ION_PRESETS.map((p) => radio(assetId === p.id, p.title, () => setGlobeIon(p.id)))}
        <div className="globe-radio globe-custom">
          {radio(isCustom, t("field.ionAssetId"), () => idBox.current?.focus())}
          <input
            ref={idBox}
            type="text"
            inputMode="numeric"
            className="field globe-id"
            aria-label={t("field.ionAssetId")}
            value={idDraft ?? (isCustom ? String(assetId) : "")}
            disabled={!on}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setIdDraft(e.target.value);
              setIdInvalid(false);
            }}
            onBlur={commitId}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitId();
              else if (e.key === "Escape") {
                setIdDraft(null);
                setIdInvalid(false);
              }
            }}
          />
        </div>
      </div>
      {idInvalid && (
        <p className="form-error" role="alert">
          {msg("globe.ionAssetInvalid")}
        </p>
      )}
      {on && status.kind === "off" && <p className="globe-hint">{msg("globe.ionNoAsset")}</p>}
      {on && status.kind === "noToken" && <p className="globe-hint">{msg("globe.ionNoToken")}</p>}
      {on && status.kind === "failed" && <p className="globe-hint">{msg("globe.ionRejected")}</p>}
    </>
  );
}

export function GlobeManager(_props: Partial<PanelProps>) {
  const sources = useImagery((s) => s.sources);
  const layers = useImagery((s) => s.layers);
  const loaded = useImagery((s) => s.loaded);
  const ion = useIonStatus();
  const hiddenByIon = ion.kind === "shown";
  const [busy, setBusy] = useState(false);

  /** ทำทีละอย่าง: ระหว่างทำอยู่เรียกซ้ำไม่ได้ (การแก้เอกสารค่าตั้งทั้งก้อนต้องไม่ซ้อนกัน) */
  const exclusive = async (task: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  /** เปิด = ถามก่อน (ยกเลิก = ไม่ทำอะไร) ปิด = ทำทันที */
  const switchTo = (def: SourceDef, on: boolean): Promise<void> =>
    exclusive(async () => {
      if (on && !(await confirm(msg(def.consent)))) return;
      await useImagery.getState().setSource(def.id, on);
      // ปิด ion แล้ว (บันทึกสำเร็จ): ลืมว่า ion เคยปฏิเสธ asset + token นี้ เปิดใหม่จะได้ลองใหม่แม้ไม่มีหน้าต่าง 3D เปิดอยู่ (ตัวที่ลืมให้เองอยู่ใน viewer)
      if (!on && def.id === "ion" && !useImagery.getState().sources.ion) setIonFailure(null);
      // เปิด ion แล้ว (บันทึกสำเร็จ) แต่ยังไม่เคยเลือก asset: เลือก preset แรกให้ (ไม่มี asset = ion ไม่แสดง)
      if (on && def.id === "ion" && useImagery.getState().sources.ion && (useLayout.getState().globe.ion?.assetId ?? null) === null) {
        useLayout.getState().setGlobeIon(ION_PRESETS[0].id);
      }
    });

  const rows = (source: ImagerySourceId): ImageryLayerInfo[] => {
    if (!loaded) return [];
    return source === "osm" ? [OSM_LAYER] : layers.filter((l) => l.source === source);
  };

  return (
    <div className="globe">
      <div className="globe-body">
        {!loaded && (
          <p className="globe-hint" role="status">
            {msg("globe.unavailable")}
          </p>
        )}

        <LayerTable>
          <BaseRow hiddenByIon={hiddenByIon} />
        </LayerTable>

        {SOURCES.map((def) => {
          const sourceRows = rows(def.id);
          return (
            <SourceGroup key={def.id} def={def} on={sources[def.id]} locked={!loaded || busy} loaded={loaded} onToggle={(on) => void switchTo(def, on)}>
              {def.id === "ion" ? (
                <IonSettings on={sources.ion} busy={busy} exclusive={exclusive} status={ion} />
              ) : (
                sourceRows.length > 0 && (
                  <LayerTable>
                    {sourceRows.map((info) => (
                      <LayerRow key={info.id} info={info} disabled={!sources[def.id]} hiddenByIon={hiddenByIon} />
                    ))}
                  </LayerTable>
                )
              )}
            </SourceGroup>
          );
        })}
      </div>
    </div>
  );
}

/** ลงทะเบียน Globe Manager เป็นหน้าต่างชนิด globeManager (แทนตัวแทนชั่วคราว) ชื่อ ชนิด ขนาด และ persist/scenarioBound คงตาม layout/panels.ts ลงซ้ำได้ */
export function registerGlobeManagerPanel(): void {
  const base = getPanelDef("globeManager");
  if (base === undefined) throw new Error('panel kind "globeManager" is not registered');
  registerPanel("globeManager", { ...base, component: GlobeManager });
}
