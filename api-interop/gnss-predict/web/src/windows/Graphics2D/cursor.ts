// พิกัดใต้เมาส์บนแผนที่ 2D → ช่อง Lat/Lon ของแถบสถานะ (spec §9.3, useSelection.cursorLatLon)
// เมาส์ขยับหลายครั้งต่อเฟรม: หาพิกัด (pickEllipsoid) ครั้งเดียวต่อเฟรมที่ตำแหน่งล่าสุด นอกแผนที่หรือเมาส์ออกจากภาพ = null
// ไม่ import Cesium: ผู้เรียกส่งฟังก์ชันหาพิกัดเข้ามา (test แทนได้)

export class CursorTracker {
  private frame: number | null = null;
  private at: { x: number; y: number } | null = null;
  private shown = false;
  private disposed = false;

  constructor(
    /** ตำแหน่งบน canvas (CSS px) → [lat, lon] องศา ไม่ตกบนโลก = null */
    private readonly pick: (x: number, y: number) => [number, number] | null,
    private readonly set: (latLon: [number, number] | null) => void,
    private readonly raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  move(x: number, y: number): void {
    if (this.disposed) return;
    this.at = { x, y };
    this.frame ??= this.raf(() => {
      this.frame = null;
      const at = this.at;
      if (at === null || this.disposed) return;
      const latLon = this.pick(at.x, at.y);
      this.shown = latLon !== null;
      this.set(latLon);
    });
  }

  /** เมาส์ออกจากภาพ */
  leave(): void {
    this.cancel();
    this.shown = false;
    this.set(null);
  }

  /** หน้าต่างปิด: ล้างช่องถ้าตัวนี้เป็นคนตั้งไว้ */
  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    if (this.shown) this.set(null);
    this.shown = false;
  }

  private cancel(): void {
    if (this.frame !== null) this.caf(this.frame);
    this.frame = null;
    this.at = null;
  }
}
