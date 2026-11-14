// โมเดล 3 มิติของดาวบน entity ในหน้าต่าง 3D (models integration spec §3–§4)
//
// - applySatelliteModel: ตั้ง entity.model (glb จาก blob URL ของ satModels.loadModelGlb) + entity.orientation แล้วซ่อนจุด (ป้ายชื่อ เส้นทาง สีของจุดคงเดิม:
//   entityColor ของ test hook และการคลิกเลือกใช้ตำแหน่งของ entity ไม่ใช่ภาพ) ไม่มีโมเดล (ปิด Satellite Models, ยังโหลดไม่เสร็จ, โหลดล้มเหลว) = ลบโมเดล คืนจุด
// - updateModelAttitudes: ท่าทาง (attitude.ts) และมุมแผงของดาวที่แสดงอยู่ทุกดวง ณ เวลาหนึ่ง เขียนลง ConstantProperty เดิม (ไม่มี CallbackProperty:
//   หน้าต่าง 3D ข้าม update ตอนอยู่เฉย ๆ ตาม event ของ EntityCollection: idleUpdates.ts) ผู้เรียกเรียกตามรอบ throttle 250 ms เดียวกับ sensor
//   ไม่สร้างออบเจ็กต์ใหม่ต่อดวงต่อรอบ (scratch ของโมดูลและสถานะต่อ entity)
//
// แกน (พิสูจน์กับ ModelUtility.getAxisCorrectionMatrix ของ Cesium จริงใน tests/unit/sat-model-render.test.ts):
// - glb ส่งออกแบบ glTF Y-up: glTF (x, y, z) = body (x, z, −y)
// - ModelGraphics ไม่มี upAxis/forwardAxis: ModelVisualizer สร้าง Model ด้วยค่าตั้งต้นของ glTF 2.0 (up Y, forward Z) ซึ่งแก้แกนด้วย
//   Y_UP_TO_Z_UP · Z_UP_TO_X_UP ได้ model space = body หมุนรอบ Z +90° (model (x, y, z) = body (−y, x, z)) nadir (+Z) ถูกแล้วแต่ yaw ผิด 90°
//   จึงต่อท้าย orientation ด้วย MODEL_AXIS_FIX = R_z(−90°): entity.orientation = q(body→ECEF) · MODEL_AXIS_FIX
// - node แผงโซลาร์มีแค่ translation และแขวนกับ root ที่ไม่มี transform (ทุกโมเดลใน catalog: test ตรวจกับ glb) แกน local ของ node จึงเป็นแกน glTF ดิบ
//   ModelVisualizer ตั้ง node.matrix = originalMatrix · TRS: หมุนรอบจุด pivot ของ node ในแกน glTF แกน +Y ของตัวดาวคือ −Z ของ glTF (WING_AXIS_GLTF)

import {
  Cartesian3, Color, ColorBlendMode, ConstantProperty, JulianDate, ModelGraphics, NodeTransformationProperty, PropertyBag, Quaternion, ReferenceFrame,
  type Entity, type EntityCollection,
} from "cesium";
import { bodyToEcefQuaternion, nadirVelocityFrame, sunPositionEcef, wingAngle, yawSteeringFrame, type AttitudeFrame } from "./attitude";
import { VELOCITY_STEP_S } from "./sensorDraw";

/** ขยายโมเดลได้ไม่เกินนี้เพื่อให้ได้ขนาดขั้นต่ำบนจอ (โมเดลยาวราว 15 m → ไม่เกินราว 300 km) */
export const MODEL_MAXIMUM_SCALE = 20000;
/** สีของระบบผสมกับสีของโมเดล (ColorBlendMode.MIX) ให้ยังแยกระบบได้ */
export const MODEL_COLOR_BLEND = 0.3;
/** ความหนาเส้นขอบ (silhouette) ของโมเดลดาวที่ถูกเลือก (พิกเซล) */
export const SELECTED_SILHOUETTE_PX = 2;

/** การแก้แกนที่ต่อท้าย orientation: R_z(−90°) (ดูหัวไฟล์) */
export const MODEL_AXIS_FIX: Readonly<Quaternion> = Object.freeze(Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, -Math.PI / 2));
/** แกนหมุนของ node แผงในพิกัด glTF ดิบ = +Y ของตัวดาว */
export const WING_AXIS_GLTF: Readonly<Cartesian3> = Object.freeze(new Cartesian3(0, 0, -1));

/** โมเดลของดาวหนึ่งดวงที่พร้อมวาด */
export interface SatModelSpec {
  /** id ของโมเดลใน catalog */
  id: string;
  /** uri ที่ Cesium โหลด (blob: URL ของ glb) */
  uri: string;
  /** node ของแผงโซลาร์ตาม wing_nodes ของ catalog */
  wingNodes: readonly string[];
  /** ดาวสำรวจโลก: เฟรม sensor §3.1 แทน yaw steering */
  eo: boolean;
  /** normal ด้านเซลล์ตอนมุมศูนย์ในกรอบตัวดาว (satModels.wingZeroNormal) */
  zeroNormal: Cartesian3;
}

export interface SatModelLook {
  spec: SatModelSpec;
  /** Model Pixel Size ของหน้าต่าง */
  pixelSize: number;
  /** สีของดาว */
  color: Color;
  selected: boolean;
}

interface ModelState {
  spec: SatModelSpec;
  /** เฟรมล่าสุด (ey ของมันคือ prevEy ของรอบถัดไป) */
  frame: AttitudeFrame;
  hasFrame: boolean;
  /** มุมแผงล่าสุด (คงไว้เมื่อดวงอาทิตย์อยู่แนว ±Y ของตัวดาว) */
  theta: number;
  orientation: ConstantProperty;
  wings: ConstantProperty[];
}

const states = new WeakMap<Entity, ModelState>();

/** entity.orientation จากเฟรมของตัวดาว: q(body→ECEF) · MODEL_AXIS_FIX */
export function modelOrientation(frame: AttitudeFrame, result?: Quaternion): Quaternion {
  const q = bodyToEcefQuaternion(frame, result ?? new Quaternion());
  return Quaternion.multiply(q, MODEL_AXIS_FIX as Quaternion, q);
}

const constant = (v: unknown): ConstantProperty => new ConstantProperty(v);

/**
 * ตั้งโมเดลของ entity ดาว (look) หรือเอาออก (null: คืนจุด) entity ที่ใช้ glb เดิมอยู่แล้วคง ModelGraphics และท่าทางเดิม (ไม่โหลดใหม่) ปรับแค่ขนาด สี ขอบ
 * ผู้เรียกตั้ง entity.point ก่อน (applyGraphics สร้างจุดใหม่ทุกครั้ง): มีโมเดล = ซ่อนจุดนั้น
 */
export function applySatelliteModel(entity: Entity, look: SatModelLook | null): void {
  if (look === null) {
    if (entity.model !== undefined) entity.model = undefined;
    if (states.has(entity)) {
      entity.orientation = undefined;
      states.delete(entity);
    }
    return;
  }
  const { spec } = look;
  let st = states.get(entity);
  if (st === undefined || st.spec.uri !== spec.uri || entity.model === undefined) {
    const wings = spec.wingNodes.map(() => constant(Quaternion.clone(Quaternion.IDENTITY)));
    const nodes = new PropertyBag(Object.fromEntries(spec.wingNodes.map((name, i) => [name, new NodeTransformationProperty({ rotation: wings[i] })])));
    entity.model = new ModelGraphics({ uri: spec.uri, nodeTransformations: nodes });
    st = { spec, frame: { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() }, hasFrame: false, theta: 0, orientation: constant(Quaternion.clone(Quaternion.IDENTITY)), wings };
    entity.orientation = st.orientation;
    states.set(entity, st);
  } else {
    st.spec = spec;
    if (entity.orientation !== st.orientation) entity.orientation = st.orientation;
  }
  const model = entity.model!;
  model.show = constant(true);
  model.minimumPixelSize = constant(look.pixelSize);
  model.maximumScale = constant(MODEL_MAXIMUM_SCALE);
  model.color = constant(look.color);
  model.colorBlendMode = constant(ColorBlendMode.MIX);
  model.colorBlendAmount = constant(MODEL_COLOR_BLEND);
  model.silhouetteColor = constant(look.color);
  model.silhouetteSize = constant(look.selected ? SELECTED_SILHOUETTE_PX : 0);
  if (entity.point !== undefined) entity.point.show = constant(false);
}

/** ขอบของโมเดลที่ถูกเลือก: entity id selectedId (null = ไม่มี) มีขอบ ตัวอื่นไม่มี (ไม่แตะอย่างอื่น) */
export function setModelSelection(entities: EntityCollection, selectedId: string | null): void {
  entities.suspendEvents();
  try {
    for (const entity of entities.values) {
      if (!states.has(entity) || entity.model === undefined) continue;
      entity.model.silhouetteSize = constant(entity.id === selectedId ? SELECTED_SILHOUETTE_PX : 0);
    }
  } finally {
    entities.resumeEvents();
  }
}

const scratchSun = new Cartesian3();
const scratchR = new Cartesian3();
const scratchBefore = new Cartesian3();
const scratchAfter = new Cartesian3();
const scratchV = new Cartesian3();
const scratchQ = new Quaternion();
const scratchWing = new Quaternion();
const scratchTimeBefore = new JulianDate();
const scratchTimeAfter = new JulianDate();

/** โมเดลที่แสดงอยู่จริง (entity แสดงรวมคอลเลกชัน/data source และโมเดลไม่ได้ถูกซ่อน เช่นดาวแม่ของ Sensor View) */
function modelShown(entity: Entity, time: JulianDate): boolean {
  return entity.isShowing && entity.model !== undefined && entity.model.show?.getValue(time) !== false;
}

/** ดวงอาทิตย์อยู่แนว ±Y ของตัวดาว (es ไม่มีส่วนในระนาบ X-Z): wingAngle ตอบ 0 ซึ่งไม่ใช่มุมจริง ให้คงมุมเดิม */
function sunAlongY(frame: AttitudeFrame, sun: Cartesian3, r: Cartesian3): boolean {
  const es = Cartesian3.subtract(sun, r, scratchV);
  return !(Math.hypot(Cartesian3.dot(es, frame.ex), Cartesian3.dot(es, frame.ez)) > 1e-9 * Cartesian3.magnitude(es));
}

/**
 * ท่าทางและมุมแผงของทุกดาวที่มีโมเดลและแสดงอยู่ใน entities ณ time (ดาวที่ซ่อน ไม่มีตำแหน่ง ณ t หรือ t ± 1 s ไม่ถูกแตะ)
 * ความเร็วจากผลต่างตำแหน่ง t ± 1 s แบบเดียวกับ sensor คืนจำนวนดาวที่คำนวณ ค่าที่ไม่เปลี่ยนไม่ส่ง event (ConstantProperty.setValue เทียบค่า)
 */
export function updateModelAttitudes(entities: EntityCollection, time: JulianDate): number {
  const sun = sunPositionEcef(time, scratchSun);
  const before = JulianDate.addSeconds(time, -VELOCITY_STEP_S, scratchTimeBefore);
  const after = JulianDate.addSeconds(time, VELOCITY_STEP_S, scratchTimeAfter);
  let n = 0;
  let suspended = false;
  try {
    for (const entity of entities.values) {
      const st = states.get(entity);
      if (st === undefined || !modelShown(entity, time)) continue;
      if (entity.availability !== undefined && !entity.availability.contains(time)) continue;
      const position = entity.position;
      if (position === undefined) continue;
      const r = position.getValueInReferenceFrame(time, ReferenceFrame.FIXED, scratchR);
      const p0 = position.getValueInReferenceFrame(before, ReferenceFrame.FIXED, scratchBefore);
      const p1 = position.getValueInReferenceFrame(after, ReferenceFrame.FIXED, scratchAfter);
      if (r === undefined || p0 === undefined || p1 === undefined) continue;
      const v = Cartesian3.multiplyByScalar(Cartesian3.subtract(p1, p0, scratchV), 1 / (2 * VELOCITY_STEP_S), scratchV);
      const frame = st.spec.eo ? nadirVelocityFrame(r, v, st.frame) : yawSteeringFrame(r, v, sun, st.hasFrame ? st.frame.ey : undefined, st.frame);
      if (frame === null) continue;
      st.hasFrame = true;
      if (!sunAlongY(frame, sun, r)) st.theta = wingAngle(frame, sun, r, st.spec.zeroNormal);
      if (!suspended) {
        entities.suspendEvents();
        suspended = true;
      }
      st.orientation.setValue(modelOrientation(frame, scratchQ));
      const wing = Quaternion.fromAxisAngle(WING_AXIS_GLTF, st.theta, scratchWing);
      for (const p of st.wings) p.setValue(wing);
      n++;
    }
  } finally {
    if (suspended) entities.resumeEvents();
  }
  return n;
}

/** จำนวน entity ดาว (sat/…) ที่แสดงโมเดลอยู่ใน entities */
export function modelCountOf(entities: EntityCollection, time: JulianDate = JulianDate.now()): number {
  let n = 0;
  for (const entity of entities.values) if (entity.id.startsWith("sat/") && states.has(entity) && modelShown(entity, time)) n++;
  return n;
}
