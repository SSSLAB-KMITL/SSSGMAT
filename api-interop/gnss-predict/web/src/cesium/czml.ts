// โหลดผลของ engine เข้า viewer (spec §9.1): scene.czml ด้วย CzmlDataSource.load แล้ว process(access.czml) ทุกไฟล์เข้าแหล่งเดียวกัน
// เพื่อให้ reference ของเส้น access (`fac/THBK#position`, `sat/G01#position`) หาเจอ (ข้อตกลงจาก engine)
//
// scenario ที่ยังไม่มีผลหรือผลไม่ตรง (Review Focus 1) ไม่มี access.czml: ensureFacilities สร้าง entity `fac/<ชื่อ>` จากตำแหน่งใน doc เอง
// ตัวที่มาจาก CZML ไม่ถูกแตะ (CZML เป็นตำแหน่งที่ engine ใช้คำนวณจริง) ตัวที่สร้างเองตามการแก้ใน doc และหายเมื่อ Facility หาย

import { Cartesian3, ConstantPositionProperty, CzmlDataSource, type Entity, type EntityCollection, type Viewer } from "cesium";
import type { components } from "../api/types.gen";

type ScenarioDoc = components["schemas"]["ScenarioDoc"];
type FacilityObj = components["schemas"]["FacilityObj"];

/** URL ของไฟล์ CZML หรือเอกสาร CZML ที่อ่านแล้ว (test ส่งเอกสารตรง ๆ) */
export type CzmlSource = string | object[];

function cancelled(): Error {
  return new DOMException("the scene load was cancelled", "AbortError");
}

/**
 * โหลด scene.czml แล้ว process access.czml ทุกไฟล์เข้า data source เดียวกัน จากนั้นใส่ใน viewer แล้วคืนตัวนั้น
 * viewer ถูกทำลายหรือ signal ถูกยกเลิกระหว่างโหลด = ไม่ใส่อะไรและ reject (ผู้เรียกทิ้งเงียบ ๆ)
 * ผู้เรียกเป็นคนเอา data source ตัวเก่าออก (หน้าต่างหนึ่งมี CzmlDataSource ตัวเดียว)
 */
export async function loadScene(
  viewer: Viewer,
  sceneUrl: CzmlSource,
  accessUrls: readonly CzmlSource[],
  opts: { signal?: AbortSignal } = {},
): Promise<CzmlDataSource> {
  const stop = (): boolean => viewer.isDestroyed() || opts.signal?.aborted === true;
  const ds = await CzmlDataSource.load(sceneUrl);
  for (const access of accessUrls) {
    if (stop()) throw cancelled();
    await ds.process(access);
  }
  if (stop()) throw cancelled();
  await viewer.dataSources.add(ds);
  return ds;
}

/** entity ของ Facility ที่หน้าเว็บสร้างเอง (ไม่ได้มาจาก CZML) */
const clientMade = new WeakSet<Entity>();

const positionOf = (f: FacilityObj): ConstantPositionProperty =>
  new ConstantPositionProperty(Cartesian3.fromDegrees(f.position.lon_deg, f.position.lat_deg, f.position.alt_m));

/** มี entity `fac/<ชื่อ>` ครบทุก Facility ใน doc (ไม่มี doc = เอาเฉพาะตัวที่สร้างเองออก) */
export function ensureFacilities(entities: EntityCollection, doc: ScenarioDoc | null): void {
  const wanted = new Map<string, FacilityObj>();
  for (const o of doc?.objects ?? []) if (o.class === "Facility") wanted.set(`fac/${o.name}`, o as FacilityObj);
  entities.suspendEvents();
  try {
    for (const e of [...entities.values]) if (clientMade.has(e) && !wanted.has(e.id)) entities.remove(e);
    for (const [id, f] of wanted) {
      const existing = entities.getById(id);
      if (existing === undefined) clientMade.add(entities.add({ id, name: f.name, position: positionOf(f) }));
      else if (clientMade.has(existing)) existing.position = positionOf(f);
    }
  } finally {
    entities.resumeEvents();
  }
}
