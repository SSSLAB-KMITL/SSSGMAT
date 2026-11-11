import { useEffect } from "react";
import { startEventWiring } from "./api/events";
import { startClock } from "./time/clock";
import { Workspace } from "./Workspace";

export function App() {
  // นาฬิกาของแอปและการต่อ SSE เข้ากับ store: เริ่มครั้งเดียวตอน mount หยุดตอน unmount
  useEffect(() => {
    const stopClock = startClock();
    const stopEvents = startEventWiring();
    return () => {
      stopEvents();
      stopClock();
    };
  }, []);

  // header = เมนูบาร์ + แถบเครื่องมือ, footer = แถบสถานะ (งานที่ 6 ใส่ที่นี่) งานที่ 7 (Welcome) วางเป็นหน้าต่างใน Workspace
  return <Workspace />;
}
