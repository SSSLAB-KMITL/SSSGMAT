// สิ่งที่ ECharts วาดอยู่จริงในกราฟ (test hook graphState().drawn ของ e2e): อ่านจาก model ของ instance หลัง processor ทำงานแล้ว
// ไม่ใช่จาก option ที่ options.ts สร้าง เพื่อให้ e2e ตรวจพฤติกรรมของ ECharts เองได้ (งาน 10 ฝากไว้):
// - series: จุดใน option (input) กับจุดที่ใช้วาดหลัง LTTB (drawn) และจุดที่ไม่มีค่า (เส้นขาด) ทั้งสองฝั่ง
// - timeLineMarks: จำนวนเส้นที่ markLine ของ series ช่วย "timeLine" วาดอยู่ (merge ที่ตั้ง data เป็น [] ต้องได้ 0) นับจาก graphic element
//   ของ view ของ markLine (markerGroupMap ต่อ series) ไม่ใช่จาก option: model ของ marker ต่อ series ไม่อยู่ใน eachComponent
// ไฟล์นี้ไม่ import echarts (แม้แต่ type ของ model ภายใน): ใช้โครงขั้นต่ำที่อ่าน และอ่านไม่ได้ (instance ถูก dispose) = สถานะว่าง

export interface DrawnSeries {
  /** id ของ series ใน option (ไม่มี = null) */
  id: string | null;
  name: string;
  /** จำนวนจุดใน option ก่อนลดจุด */
  input: number;
  /** จุดที่ไม่มีค่าใน option */
  inputBreaks: number;
  /** จำนวนจุดที่ ECharts ใช้วาด (หลัง sampling) */
  drawn: number;
  /** จุดที่ไม่มีค่าในข้อมูลที่วาด (connectNulls: false = เส้นขาดตรงนั้น) */
  breaks: number;
}

export interface DrawnState {
  series: DrawnSeries[];
  timeLineMarks: number;
}

interface DataLike {
  count(): number;
  mapDimension(dim: string): string | undefined;
  get(dim: string, index: number): unknown;
}
interface SeriesLike {
  id?: unknown;
  name?: unknown;
  getData(): DataLike | undefined;
  getRawData(): DataLike | undefined;
}
interface GroupLike {
  parent?: unknown;
  childCount(): number;
}
interface MarkerViewLike {
  group?: unknown;
  markerGroupMap?: { get(seriesId: string): { group?: GroupLike } | undefined };
}
interface ModelLike {
  getSeries(): SeriesLike[];
  eachComponent(type: string, cb: (m: unknown) => void): void;
}
interface ChartLike {
  getModel?(): unknown;
  getViewOfComponentModel?(m: unknown): unknown;
}

const EMPTY: DrawnState = { series: [], timeLineMarks: 0 };

/** จำนวนแถวที่ค่าในมิติค่า (y ของเส้น หรือ radius ของ polar) ไม่ใช่ตัวเลข */
function nulls(data: DataLike): number {
  const dim = data.mapDimension("y") ?? data.mapDimension("radius");
  if (dim === undefined) return 0;
  let n = 0;
  for (let i = 0; i < data.count(); i++) {
    const v = data.get(dim, i);
    if (typeof v !== "number" || Number.isNaN(v)) n++;
  }
  return n;
}

/** chart = instance ของ ECharts (getModel / getViewOfComponentModel เป็น private ใน type ของ ECharts จึงรับเป็น object แล้วอ่านแบบโครง) */
export function drawnState(instance: object): DrawnState {
  const chart = instance as ChartLike;
  let model: ModelLike | null;
  try {
    model = (chart.getModel?.() ?? null) as ModelLike | null;
  } catch {
    return EMPTY;
  }
  if (model === null || typeof model.getSeries !== "function") return EMPTY;
  const series: DrawnSeries[] = [];
  let timeLine: SeriesLike | null = null;
  for (const s of model.getSeries()) {
    const raw = s.getRawData();
    const data = s.getData();
    if (s.id === "timeLine") timeLine = s;
    series.push({
      id: typeof s.id === "string" ? s.id : null,
      name: typeof s.name === "string" ? s.name : "",
      input: raw?.count() ?? 0,
      inputBreaks: raw === undefined ? 0 : nulls(raw),
      drawn: data?.count() ?? 0,
      breaks: data === undefined ? 0 : nulls(data),
    });
  }
  let timeLineMarks = 0;
  if (timeLine !== null && typeof timeLine.id === "string") {
    const id = timeLine.id;
    model.eachComponent("markLine", (m) => {
      const view = chart.getViewOfComponentModel?.(m) as MarkerViewLike | undefined;
      const group = view?.markerGroupMap?.get(id)?.group;
      // กลุ่มที่ไม่ได้อยู่ใต้ view แล้ว (series ไม่มี markLine) ไม่ถูกวาด
      if (group !== undefined && group.parent === view?.group) timeLineMarks += group.childCount();
    });
  }
  return { series, timeLineMarks };
}
