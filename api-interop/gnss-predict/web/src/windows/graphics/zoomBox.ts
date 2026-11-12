// กรอบของปุ่ม Zoom In ที่ลากบนภาพ (หน้าต่าง 3D และ 2D): กล่องเส้นประบนภาพระหว่างลาก แล้วหาพื้นที่บนโลกใต้มุมของกรอบ
// อยู่ใน chunk ของ Cesium (scene3d.ts / scene2d.ts import) ผู้เรียกเป็นคนบินกล้องไปที่พื้นที่และคืนโหมดเมาส์

import { Cartesian2, Rectangle, type Camera, type Cartographic, type Ellipsoid } from "cesium";

/** กรอบที่เล็กกว่านี้ (พิกเซล) ในด้านใดด้านหนึ่งนับเป็นการคลิก */
export const CLICK_PX = 4;

export class ZoomBox {
  private drag: Cartesian2 | null = null;
  private readonly box: HTMLDivElement;

  constructor(el: HTMLElement) {
    this.box = document.createElement("div");
    this.box.className = "gfx-zoombox";
    this.box.hidden = true;
    el.appendChild(this.box);
  }

  start(at: Cartesian2): void {
    this.drag = Cartesian2.clone(at);
    this.draw(at, at);
  }

  move(at: Cartesian2): void {
    if (this.drag !== null) this.draw(this.drag, at);
  }

  /** ปล่อยเมาส์: มุมทั้งสองของกรอบถ้ากำลังลากอยู่ ไม่งั้น null */
  end(at: Cartesian2): { a: Cartesian2; b: Cartesian2 } | null {
    const start = this.drag;
    if (start === null) return null;
    this.cancel();
    return { a: start, b: Cartesian2.clone(at) };
  }

  cancel(): void {
    this.drag = null;
    this.box.hidden = true;
  }

  destroy(): void {
    this.box.remove();
  }

  private draw(a: Cartesian2, b: Cartesian2): void {
    const s = this.box.style;
    s.left = `${Math.min(a.x, b.x)}px`;
    s.top = `${Math.min(a.y, b.y)}px`;
    s.width = `${Math.abs(a.x - b.x)}px`;
    s.height = `${Math.abs(a.y - b.y)}px`;
    this.box.hidden = false;
  }
}

/** พื้นที่บนโลกใต้กรอบ ab: กรอบเล็กกว่า CLICK_PX (คลิก) หรือมุมที่ตกบนโลกไม่ถึงสองมุม = null */
export function boxRectangle(camera: Camera, ellipsoid: Ellipsoid, a: Cartesian2, b: Cartesian2): Rectangle | null {
  if (Math.abs(a.x - b.x) < CLICK_PX || Math.abs(a.y - b.y) < CLICK_PX) return null;
  const corners = [a, b, new Cartesian2(a.x, b.y), new Cartesian2(b.x, a.y)].flatMap((p): Cartographic[] => {
    const hit = camera.pickEllipsoid(p, ellipsoid);
    return hit === undefined ? [] : [ellipsoid.cartesianToCartographic(hit)];
  });
  return corners.length >= 2 ? Rectangle.fromCartographicArray(corners) : null;
}
