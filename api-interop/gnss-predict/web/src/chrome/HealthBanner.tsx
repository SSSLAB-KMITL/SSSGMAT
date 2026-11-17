// แถบเตือนด้านบนเมื่อดิสก์ของ server เต็มหรือเขียนไม่ได้ (spec §15, W10): /health บอก writable == false หรือ free_bytes < 500 MB
// โหลด /health ตอนเริ่มและทุก 60 วินาที (ตอนต่อ SSE ใหม่ events.ts โหลดอีกครั้งเอง)

import { useEffect } from "react";
import { msg } from "../labels/messages.th";
import { useSettings } from "../stores/settings";

/** พื้นที่ว่างที่น้อยกว่านี้ (ไบต์) ถือว่าเหลือน้อย */
export const LOW_DISK_BYTES = 500_000_000;
export const HEALTH_REFRESH_MS = 60_000;

export function HealthBanner() {
  const health = useSettings((s) => s.health);

  useEffect(() => {
    void useSettings.getState().loadHealth();
    const timer = setInterval(() => void useSettings.getState().loadHealth(), HEALTH_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (health === null) return null;
  const lines: string[] = [];
  if (!health.writable) lines.push(msg("disk.notWritable"));
  if (health.free_bytes !== null && health.free_bytes < LOW_DISK_BYTES) lines.push(msg("disk.low", { free_mb: Math.floor(health.free_bytes / 1_000_000) }));
  if (lines.length === 0) return null;
  return (
    <div className="health-banner" role="alert">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
