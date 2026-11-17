// EventSource ปลอม: test สั่ง open / error / ส่ง event เองได้ ไม่มี network

type Listener = (ev: { data: string }) => void;

export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset(): void {
    FakeEventSource.instances = [];
  }
  static get last(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  readonly url: string;
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  close(): void {
    this.closed = true;
  }

  // ---- ฝั่ง test ----
  open(): void {
    this.fire("open", "");
  }
  fail(): void {
    this.fire("error", "");
  }
  emit(name: string, data: unknown): void {
    this.fire(name, typeof data === "string" ? data : JSON.stringify(data));
  }
  private fire(type: string, data: string): void {
    if (this.closed) return; // EventSource จริงที่ close แล้วไม่ส่ง event อีก
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
}

export const FakeES = FakeEventSource as unknown as typeof EventSource;
