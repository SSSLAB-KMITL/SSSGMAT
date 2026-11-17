// จำกัดความถี่ของงานที่ทำซ้ำตามเวลา animation (หน้าต่าง 3D: เส้นทาง Inertial by Window, หน้าต่าง 2D: Swath, กลางวันกลางคืน, IPP)
// request แรกหลังเงียบไปครบช่วงทำทันที ที่ตามมาภายในช่วงรวมเป็นครั้งเดียวตอนครบช่วง (ครั้งสุดท้ายตามมาเสมอ ภาพไม่ค้างที่ค่ากลางทาง)

export class Throttle {
  private last = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly intervalMs: number,
    private readonly run: () => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  request(): void {
    if (this.disposed || this.timer !== null) return;
    const wait = this.last + this.intervalMs - this.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  /** ทำทันทีและยกเลิกครั้งที่รออยู่ */
  flush(): void {
    if (this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.last = this.now();
    this.run();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
