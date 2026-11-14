// Globe Manager (imagery spec §5.1): สวิตช์ภาพพื้นโลกออนไลน์ NASA GIBS และรายการชั้นภาพ (Show, % Translucency)
// - สวิตช์ "Online imagery (NASA GIBS)" เป็นของ server (settings.json) เปลี่ยนผ่าน useImagery.setSource("gibs", on) (GET แล้ว PUT /settings ทั้งเอกสาร)
//   เปิด = ถามยืนยันภาษาไทยก่อนทุกครั้ง (กล่องเดียวกับ confirm ของแอป) บอก host gibs.earthdata.nasa.gov สิ่งที่ส่งออก ที่เก็บ data/imagery และเพดาน 2 GB
//   ยกเลิก (หรือ Esc) = ไม่ส่งอะไรเลย ปิด = PUT ทันทีไม่ถาม ล้มเหลว = store รายงานคำเตือนไทยเองและสวิตช์คงค่าเดิม (ที่นี่ไม่แสดงซ้ำ)
// - รายการชั้น: แถวแรก Natural Earth II (ออฟไลน์ เป็นฐานเสมอ ปิดไม่ได้) แล้วชั้นของ catalog ตามลำดับที่ server ส่ง (ชั้นหลังทับชั้นก่อน)
//   Show และ % Translucency ของแต่ละชั้นอยู่ใน workbook (useLayout.globe: ใช้ร่วมกันทุกหน้าต่าง 3D และ Sensor View) ที่นี่ไม่เก็บค่าเอง
//   ค่าตั้งต้น (Blue Marble + VIIRS NOAA-20 แสดง) มาจาก DEFAULT_GLOBE ที่ layout ถืออยู่แล้ว: เปิดสวิตช์จึงไม่เขียนทับค่าที่ผู้ใช้เลือกไว้
// - % Translucency ส่งเข้า setGlobeLayer เฉพาะจำนวนเต็ม 0-100 (store ไม่ตรวจเอง): พิมพ์แล้วบันทึกเมื่อออกจากช่องหรือกด Enter, ค่าไม่ถูกต้องคืนค่าเดิม, Escape ยกเลิก
// - แต่ละแถวใช้ได้เมื่อสวิตช์ของแหล่งของแถวนั้นเปิด (ชั้น EOX ตามสวิตช์ eox ไม่ใช่สวิตช์ GIBS: กลุ่มและสวิตช์ของแหล่งอื่นเป็นงานถัดไป)
//   สวิตช์ GIBS ปิด = แถวของ GIBS ทุกแถวปิดใช้พร้อมคำอธิบาย; อ่านรายการจาก server ไม่ได้ (loaded = false) = ส่วนออนไลน์ใช้ไม่ได้พร้อมข้อความไทย เหลือแต่ Natural Earth II

import { useState } from "react";
import { confirm } from "../../chrome/Dialogs";
import { t } from "../../labels/labels";
import { msg } from "../../labels/messages.th";
import { getPanelDef, registerPanel, type PanelProps } from "../../layout/panels";
import type { GlobeLayerSetting } from "../../layout/workbook";
import { useImagery, type ImageryLayerInfo } from "../../stores/imagery";
import { useLayout } from "../../stores/layout";

/** จำนวนเต็ม 0-100 (ตัวเลข ASCII เท่านั้น เว้นวรรคหัวท้ายได้) ไม่ใช่ = null */
function parseTranslucency(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
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

function LayerRow({ info, disabled }: { info: ImageryLayerInfo; disabled: boolean }) {
  const setting = useLayout((s) => s.globe.layers[info.id]) ?? NO_SETTING;
  const setGlobeLayer = useLayout((s) => s.setGlobeLayer);
  return (
    <tr>
      <th scope="row" title={info.credit}>
        {info.title}
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

export function GlobeManager(_props: Partial<PanelProps>) {
  const sources = useImagery((s) => s.sources);
  const enabled = sources.gibs;
  const layers = useImagery((s) => s.layers);
  const loaded = useImagery((s) => s.loaded);
  const [busy, setBusy] = useState(false);

  /** เปิด = ถามก่อน (ยกเลิก = ไม่ทำอะไร) ปิด = ทำทันที; ระหว่างถามและระหว่างบันทึกกดซ้ำไม่ได้ */
  const switchTo = async (on: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (on && !(await confirm(msg("globe.consent")))) return;
      await useImagery.getState().setSource("gibs", on);
    } finally {
      setBusy(false);
    }
  };

  const naturalEarth = t("option.globe.naturalEarthII");
  return (
    <div className="globe">
      <div className="globe-body">
        <section className="globe-online">
          <label className="globe-switch">
            <input
              type="checkbox"
              className="form-check"
              checked={enabled}
              disabled={!loaded || busy}
              onChange={(e) => void switchTo(e.target.checked)}
            />
            <span>{t("field.onlineImagery")}</span>
          </label>
          {!loaded && (
            <p className="globe-hint" role="status">
              {msg("globe.unavailable")}
            </p>
          )}
          {loaded && !enabled && <p className="globe-hint">{msg("globe.offHint")}</p>}
        </section>

        <table className="globe-table">
          <thead>
            <tr>
              <th scope="col">{t("field.globeLayer")}</th>
              <th scope="col">{t("ob.show")}</th>
              <th scope="col">{t("field.translucency")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{naturalEarth}</th>
              <td>
                <input type="checkbox" className="form-check" aria-label={`${naturalEarth} ${t("ob.show")}`} checked disabled />
              </td>
              <td>
                <input
                  type="text"
                  className="field globe-num"
                  aria-label={`${naturalEarth} ${t("field.translucency")}`}
                  value="0"
                  disabled
                />
              </td>
            </tr>
            {layers.map((info) => (
              <LayerRow key={info.id} info={info} disabled={!loaded || !sources[info.source]} />
            ))}
          </tbody>
        </table>
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
