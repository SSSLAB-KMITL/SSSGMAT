// โมเดล 3 มิติของดาวบน entity ในหน้าต่าง 3D (models integration spec §3–§4)
//
// - applySatelliteModel: ตั้ง entity.model (glb จาก blob URL ของ satModels.loadModelGlb) + entity.orientation แล้วซ่อนจุด (ป้ายชื่อ เส้นทาง สีของจุดคงเดิม:
//   entityColor ของ test hook และการคลิกเลือกใช้ตำแหน่งของ entity ไม่ใช่ภาพ) ไม่มีโมเดล (ปิด Satellite Models, ยังโหลดไม่เสร็จ, โหลดล้มเหลว) = ลบโมเดล คืนจุด
// - watchModelErrors: โมเดลที่ Cesium โหลดไม่สำเร็จหลังอ่าน JSON แล้ว (buffer, mesh, shader) แจ้งผ่าน errorEvent ของ primitive ที่ ModelVisualizer สร้าง
//   (Model.id = entity, อยู่ใน scene.primitives) ผู้เรียกกลับไปวาดเป็นจุด ความล้มเหลวก่อนนั้น (Model.fromGltfAsync) ถูกกันไว้ด้วย satModels.glbProblem
// - หน้าตา: ขอบ (silhouette) สีของระบบทุกโมเดล (ดวงที่เลือกหนากว่า) สีของระบบผสม 50% แสงอาทิตย์ 2 เท่า และแสงรอบตัวคงที่ (ด้านกลางคืนยังเห็น)
//   ไม่ตั้ง maximumScale: Model Pixel Size ใช้ได้ทุกระยะ
// - applyModelDetail: Model Detail Threshold ดาวที่ห่างกล้องเกินค่านี้กลับเป็นจุด (model.show = false: ไม่วาด ไม่คำนวณท่าทาง)
// - updateModelAttitudes: ท่าทางตามกฎของ block ของดาวแต่ละดวง (attitudeLaws.ts: spec.law) และมุมแผงของดาวที่แสดงอยู่ทุกดวง ณ เวลาหนึ่ง
//   เขียนลง ConstantProperty เดิม (ไม่มี CallbackProperty: หน้าต่าง 3D ข้าม update ตอนอยู่เฉย ๆ ตาม event ของ EntityCollection: idleUpdates.ts)
//   ผู้เรียกเรียกตามรอบ throttle 250 ms เดียวกับ sensor กฎทุกตัวไม่มีสถานะ: ท่าทาง ณ t ไม่ขึ้นกับรอบก่อนหน้า (scrub = throttle = เล่นต่อเนื่อง)
//   ผลเขียนลง scratch ของโมดูลและสถานะต่อ entity แต่ lawAttitude ยังสร้างออบเจ็กต์อายุสั้นราว 10 ตัวต่อดวงต่อรอบ (เรขาคณิต, yaw, กรอบของ sensorGeometry.bodyFrame)
//   จำนวนมีขอบเขต (ราว 1,500 ตัวต่อรอบที่ 146 ดวง ≤ 4 รอบต่อวินาที) จึงไม่ทำ scratch เพิ่ม
//
// แกน (พิสูจน์กับ ModelUtility.getAxisCorrectionMatrix ของ Cesium จริงใน tests/unit/sat-model-render.test.ts):
// - glb ส่งออกแบบ glTF Y-up: glTF (x, y, z) = body (x, z, −y)
// - ModelGraphics ไม่มี upAxis/forwardAxis: ModelVisualizer สร้าง Model ด้วยค่าตั้งต้นของ glTF 2.0 (up Y, forward Z) ซึ่งแก้แกนด้วย
//   Y_UP_TO_Z_UP · Z_UP_TO_X_UP ได้ model space = body หมุนรอบ Z +90° (model (x, y, z) = body (−y, x, z)) nadir (+Z) ถูกแล้วแต่ yaw ผิด 90°
//   จึงต่อท้าย orientation ด้วย MODEL_AXIS_FIX = R_z(−90°): entity.orientation = q(body→ECEF) · MODEL_AXIS_FIX
// - node แผงโซลาร์มีแค่ translation และแขวนกับ root ที่ไม่มี transform (ทุกโมเดลใน catalog: test ตรวจกับ glb) แกน local ของ node จึงเป็นแกน glTF ดิบ
//   ModelVisualizer ตั้ง node.matrix = originalMatrix · TRS: หมุนรอบจุด pivot ของ node ในแกน glTF แกน +Y ของตัวดาวคือ −Z ของ glTF (WING_AXIS_GLTF)

import {
  Cartesian2, Cartesian3, Color, ColorBlendMode, ConstantProperty, Entity, JulianDate, Matrix3, Matrix4, Model, ModelGraphics, NodeTransformationProperty, PropertyBag, Quaternion,
  ReferenceFrame, type EntityCollection, type Property, type Scene,
} from "cesium";
import { bodyToEcefQuaternion, sunPositionEcef, wingAngle, type AttitudeFrame } from "./attitude";
import { lawAttitude, type AttitudeLaw, type LawAttitude } from "./attitudeLaws";
import { VELOCITY_STEP_S, velocityOf } from "./sensorDraw";

// ไม่ตั้ง maximumScale: Model.updateComputedScale ของ Cesium ขยายโมเดลเป็น Model Pixel Size × (เมตรต่อพิกเซล) / เส้นผ่านศูนย์กลางของโมเดล
// แล้วจำกัดด้วย maximumScale ถ้ามี ค่าจำกัดใด ๆ ทำให้ขนาดขั้นต่ำหายไปเกินระยะหนึ่ง (เดิม 20000: โมเดลยาว 17 m ได้ 48 px ถึงราว 6,000 km เท่านั้น
// ขณะที่ดาว GNSS ห่างกล้อง Home View 10,000–60,000 km) ไม่จำกัดจึงได้ Model Pixel Size ทุกระยะ (test: 50,000 และ 80,000 km)

/** สีของระบบผสมกับสีของโมเดล (ColorBlendMode.MIX) ให้ยังแยกระบบได้ */
export const MODEL_COLOR_BLEND = 0.5;
/** ขอบ (silhouette) สีของระบบรอบโมเดลดาวทุกดวง (พิกเซล): เห็นรูปร่างบนพื้นอวกาศดำและด้านกลางคืน */
export const MODEL_SILHOUETTE_PX = 1.5;
/** ขอบของโมเดลดาวที่ถูกเลือก (พิกเซล) */
export const SELECTED_SILHOUETTE_PX = 3;
/**
 * แสงอาทิตย์ของโมเดล (ModelGraphics.lightColor = ขาว × ค่านี้ แทนสีและความแรงของแสงใน scene): 2 = ค่าตั้งต้นของ SunLight ใน Cesium
 * หน้าต่าง 3D ตั้ง scene.light.intensity = Sun Level / 100 (ค่าตั้งต้น 1) ซึ่งทำให้โมเดลมืดครึ่งหนึ่งของที่ Cesium ออกแบบไว้
 */
export const MODEL_LIGHT_SCALE = 2;
/**
 * แสงรอบตัว (image-based lighting) เต็มที่ทั้ง diffuse และ specular จาก spherical harmonics ค่าคงที่ของ Cesium (DEFAULT_SPHERICAL_HARMONIC_COEFFICIENTS:
 * ฟ้าสว่างเท่ากันทุกทิศ) แทน environment map แบบ dynamic: environment map นั้นคำนวณจากบรรยากาศที่ตำแหน่งของโมเดล ในอวกาศเกือบดำ
 * (ด้านกลางคืนดำสนิท) และสร้างใหม่ทุกครั้งที่โมเดลเคลื่อนเกิน 1 km (ทุกเฟรมของ animation ทุกดวง)
 */
const MODEL_IBL_FACTOR: Readonly<Cartesian2> = Object.freeze(new Cartesian2(1, 1));
const MODEL_ENVIRONMENT_MAP = Object.freeze({ enabled: false });

/** การแก้แกนที่ต่อท้าย orientation: R_z(−90°) (ดูหัวไฟล์) */
export const MODEL_AXIS_FIX: Readonly<Quaternion> = Object.freeze(Quaternion.fromAxisAngle(Cartesian3.UNIT_Z, -Math.PI / 2));
const MODEL_AXIS_FIX_INVERSE: Readonly<Quaternion> = Object.freeze(Quaternion.conjugate(MODEL_AXIS_FIX as Quaternion, new Quaternion()));
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
  /** กฎท่าทางของดาว (attitudeLaws.attitudeLawFor จาก block ของดาว; ดาวสำรวจโลก = nadir_velocity) */
  law: AttitudeLaw;
  /** normal ด้านเซลล์ตอนมุมศูนย์ในกรอบตัวดาว (satModels.cellNormalOf: cell_normal ของ catalog) */
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
  /** ท่าทางล่าสุด (ที่เก็บผลของ lawAttitude: ไม่ใช่ข้อมูลเข้าของรอบถัดไป) */
  att: LawAttitude;
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
    entity.model = new ModelGraphics({
      uri: spec.uri, nodeTransformations: nodes, environmentMapOptions: { ...MODEL_ENVIRONMENT_MAP },
      lightColor: new Color(MODEL_LIGHT_SCALE, MODEL_LIGHT_SCALE, MODEL_LIGHT_SCALE, 1), imageBasedLightingFactor: Cartesian2.clone(MODEL_IBL_FACTOR),
    });
    const att: LawAttitude = { frame: { ex: new Cartesian3(), ey: new Cartesian3(), ez: new Cartesian3() }, yaw: 0, mode: "YS", beta: 0, mu: 0 };
    st = { spec, att, hasFrame: false, theta: 0, orientation: constant(Quaternion.clone(Quaternion.IDENTITY)), wings };
    entity.orientation = st.orientation;
    states.set(entity, st);
  } else {
    st.spec = spec;
    if (entity.orientation !== st.orientation) entity.orientation = st.orientation;
  }
  const model = entity.model!;
  model.show = constant(true);
  model.minimumPixelSize = constant(look.pixelSize);
  model.color = constant(look.color);
  model.colorBlendMode = constant(ColorBlendMode.MIX);
  model.colorBlendAmount = constant(MODEL_COLOR_BLEND);
  model.silhouetteColor = constant(look.color);
  model.silhouetteSize = constant(silhouettePx(look.selected));
  if (entity.point !== undefined) entity.point.show = constant(false);
}

const silhouettePx = (selected: boolean): number => (selected ? SELECTED_SILHOUETTE_PX : MODEL_SILHOUETTE_PX);

/** ขอบของโมเดล: entity id selectedId (null = ไม่มี) ขอบหนา SELECTED_SILHOUETTE_PX ตัวอื่น MODEL_SILHOUETTE_PX (ไม่แตะอย่างอื่น) */
export function setModelSelection(entities: EntityCollection, selectedId: string | null): void {
  entities.suspendEvents();
  try {
    for (const entity of entities.values) {
      if (!states.has(entity) || entity.model === undefined) continue;
      entity.model.silhouetteSize = constant(silhouettePx(entity.id === selectedId));
    }
  } finally {
    entities.resumeEvents();
  }
}

const scratchSun = new Cartesian3();
const scratchDetail = new Cartesian3();
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

/** ตั้ง show ของกราฟิก (โมเดลหรือจุด) เป็น show ถ้ายังไม่ใช่ (ไม่ระบุ = แสดง) คืนว่าเปลี่ยนไหม */
function setShow(g: { show: Property | undefined }, show: boolean, time: JulianDate): boolean {
  if ((g.show?.getValue(time) ?? true) === show) return false;
  if (g.show instanceof ConstantProperty) g.show.setValue(show);
  else g.show = constant(show);
  return true;
}

/**
 * Model Detail Threshold: ดาวที่มีโมเดลและแสดงอยู่ซึ่งห่าง camera (ตำแหน่ง Earth-fixed ของกล้อง) น้อยกว่า thresholdM (เมตร) แสดงเป็นโมเดล (จุดซ่อน)
 * ไกลกว่านั้นแสดงเป็นจุดเดิมของมัน และ model.show = false (Cesium ไม่วาดและ updateModelAttitudes ไม่คำนวณท่าทาง)
 * ไม่แตะ: ดาวที่ไม่แสดง (entity หรือคอลเลกชันซ่อน เช่นโหมด Camera ของ Sensor View) ดาวที่ไม่มีตำแหน่ง ณ time และ exclude (ดาวที่กล้องอยู่ในตัว
 * ซึ่งผู้เรียกซ่อนเอง) คืนจำนวนดาวที่เปลี่ยน ค่าที่ไม่เปลี่ยนไม่ส่ง event หลายดวงที่เปลี่ยนในรอบเดียว = event เดียว
 * applySatelliteModel (restyle) คืนโมเดลให้ทุกดวง ผู้เรียกจึงเรียกฟังก์ชันนี้ต่อจาก restyle ทันที
 */
export function applyModelDetail(entities: EntityCollection, camera: Cartesian3, thresholdM: number, time: JulianDate, exclude?: Entity): number {
  let n = 0;
  let suspended = false;
  try {
    for (const entity of entities.values) {
      const model = entity.model;
      if (model === undefined || entity === exclude || !states.has(entity) || !entity.isShowing) continue;
      if (entity.availability !== undefined && !entity.availability.contains(time)) continue;
      const r = entity.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, scratchDetail);
      if (r === undefined) continue;
      const near = Cartesian3.distance(r, camera) < thresholdM;
      const point = entity.point;
      const shown = (model.show?.getValue(time) ?? true) === true;
      const pointShown = point === undefined ? !near : (point.show?.getValue(time) ?? true) === true;
      if (shown === near && pointShown === !near) continue;
      if (!suspended) {
        entities.suspendEvents();
        suspended = true;
      }
      setShow(model, near, time);
      if (point !== undefined) setShow(point, !near, time);
      n++;
    }
  } finally {
    if (suspended) entities.resumeEvents();
  }
  return n;
}

/** ดวงอาทิตย์อยู่แนว ±Y ของตัวดาว (es ไม่มีส่วนในระนาบ X-Z): wingAngle ตอบ 0 ซึ่งไม่ใช่มุมจริง ให้คงมุมเดิม */
function sunAlongY(frame: AttitudeFrame, sun: Cartesian3, r: Cartesian3): boolean {
  const es = Cartesian3.subtract(sun, r, scratchV);
  return !(Math.hypot(Cartesian3.dot(es, frame.ex), Cartesian3.dot(es, frame.ez)) > 1e-9 * Cartesian3.magnitude(es));
}

/**
 * ท่าทาง (กฎของ spec.law: attitudeLaws.lawAttitude) และมุมแผงของทุกดาวที่มีโมเดลและแสดงอยู่ใน entities ณ time (ดาวที่ซ่อน ไม่มีตำแหน่ง ณ t หรือไม่มีทั้ง t − 1 s และ t + 1 s ไม่ถูกแตะ)
 * ความเร็วจาก sensorDraw.velocityOf ตัวเดียวกับ sensor: t ± 1 s, ขอบช่วงตัวอย่าง (เริ่ม/จบ animation) = ผลต่างข้างเดียว 1 s
 * คืนจำนวนดาวที่คำนวณ ค่าที่ไม่เปลี่ยนไม่ส่ง event (ConstantProperty.setValue เทียบค่า)
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
      if (r === undefined) continue;
      const v = velocityOf(r, p0 ?? null, p1 ?? null, scratchV);
      if (v === null) continue;
      const att = lawAttitude(st.spec.law, r, v, sun, time, st.att);
      if (att === null) continue;
      const frame = att.frame;
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

/**
 * แกน +X, +Y, +Z ของตัวดาวในพิกัด ECEF จาก entity.orientation ที่เขียนไว้ล่าสุด (ถอด MODEL_AXIS_FIX ออก) ให้ test hook ของ e2e (testHooks.satelliteOrientation)
 * ไม่มีโมเดล ยังไม่เคยคำนวณท่าทาง หรือซ่อนอยู่ = null ไม่ใช้ในการวาด
 */
export function modelBodyAxes(entity: Entity, time: JulianDate): AttitudeFrame | null {
  const st = states.get(entity);
  if (st === undefined || !st.hasFrame || !modelShown(entity, time)) return null;
  const q = entity.orientation?.getValue(time) as Quaternion | undefined;
  if (q === undefined) return null;
  const m = Matrix3.fromQuaternion(Quaternion.multiply(q, MODEL_AXIS_FIX_INVERSE as Quaternion, new Quaternion()), new Matrix3());
  return { ex: Matrix3.getColumn(m, 0, new Cartesian3()), ey: Matrix3.getColumn(m, 1, new Cartesian3()), ez: Matrix3.getColumn(m, 2, new Cartesian3()) };
}

/** จำนวน entity ดาว (sat/…) ที่แสดงโมเดลอยู่ใน entities */
export function modelCountOf(entities: EntityCollection, time: JulianDate = JulianDate.now()): number {
  let n = 0;
  for (const entity of entities.values) if (entity.id.startsWith("sat/") && states.has(entity) && modelShown(entity, time)) n++;
  return n;
}

/** สถานะของ primitive Model ที่ ModelVisualizer สร้างให้ entity ดาว (test hook satelliteModel) */
export interface ModelPrimitiveState {
  /** id ของโมเดลใน catalog */
  model: string;
  ready: boolean;
  /** Model.show (ModelVisualizer ตั้งตามที่ entity แสดงและ Model Detail Threshold) */
  shown: boolean;
  /** ระยะ (m) จากตำแหน่งใน modelMatrix ถึงตำแหน่ง Earth-fixed ของ entity ณ time (ไม่มีตำแหน่ง = null) primitive ที่ ModelVisualizer ยังไม่ update = รัศมีวงโคจร */
  offsetM: number | null;
  minimumPixelSize: number;
}

const scratchPrimitivePos = new Cartesian3();
const scratchEntityPos = new Cartesian3();

/** primitive Model (id = entity) ใน primitives ของ entity ดาวที่มีโมเดล (applySatelliteModel) ไม่มีโมเดลหรือยังไม่มี primitive = null ไม่ใช้ในการวาด */
export function modelPrimitiveState(primitives: { readonly length: number; get(i: number): unknown }, entity: Entity, time: JulianDate): ModelPrimitiveState | null {
  const st = states.get(entity);
  if (st === undefined) return null;
  for (let i = 0; i < primitives.length; i++) {
    const m: unknown = primitives.get(i);
    if (!(m instanceof Model) || m.id !== entity) continue;
    const r = entity.position?.getValueInReferenceFrame(time, ReferenceFrame.FIXED, scratchEntityPos);
    const at = Matrix4.getTranslation(m.modelMatrix, scratchPrimitivePos);
    return { model: st.spec.id, ready: m.ready, shown: m.show, offsetM: r === undefined ? null : Cartesian3.distance(at, r), minimumPixelSize: m.minimumPixelSize };
  }
  return null;
}

/** ฟังก์ชันที่ watchModelErrors เรียกเมื่อโมเดลของ entity ดาวโหลดไม่สำเร็จใน Cesium (uri = blob uri ของ spec ที่ entity ใช้อยู่) */
export type ModelErrorHandler = (entity: Entity, uri: string, error: unknown) => void;

/**
 * ฟังความล้มเหลวของโมเดลดาวใน Cesium: ก่อนวาดทุกเฟรม (scene.preRender ก่อน primitive update ในเฟรมนั้น ซึ่งเป็นที่ errorEvent เกิด) หา primitive Model
 * ใน scene.primitives ที่ id เป็น entity ดาวที่มีโมเดล (applySatelliteModel) แล้วฟัง errorEvent ของมันครั้งเดียวต่อ primitive
 * TextureError ไม่นับ (Cesium ยังวาดโมเดลได้ เหมือน ModelVisualizer) คืนตัวเลิกฟังทั้งหมด
 */
export function watchModelErrors(scene: Pick<Scene, "preRender" | "primitives">, onError: ModelErrorHandler): () => void {
  const hooked = new Map<Model, () => void>();
  const scan = (): void => {
    for (const [m, off] of hooked) {
      if (m.isDestroyed()) {
        off();
        hooked.delete(m);
      }
    }
    const primitives = scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const m: unknown = primitives.get(i);
      if (!(m instanceof Model) || hooked.has(m)) continue;
      const entity: unknown = m.id;
      if (!(entity instanceof Entity) || !states.has(entity)) continue;
      hooked.set(m, m.errorEvent.addEventListener((error: unknown) => {
        const st = states.get(entity);
        if ((error as { name?: unknown } | null)?.name === "TextureError" || st === undefined) return;
        onError(entity, st.spec.uri, error);
      }));
    }
  };
  const off = scene.preRender.addEventListener(scan);
  return () => {
    off();
    for (const remove of hooked.values()) remove();
    hooked.clear();
  };
}
