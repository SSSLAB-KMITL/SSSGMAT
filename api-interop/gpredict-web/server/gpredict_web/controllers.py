"""ControllerHub: Radio Control และ Antenna Control ของทุก module ที่เปิดอยู่ เป้าหมายของ module และการส่งค่าจาก tick ให้ controller
(spec §3 และ §8 ของงานย่อย 3, decision 1, 2, 3 และ 14 ของแผน)

- module หนึ่งมี controller ได้ชนิดละหนึ่งตัว ("radio" = RigController, "rotator" = RotController) เปิดซ้ำไม่สร้างตัวใหม่
  เปิดแล้วปลุก producer ของ tick (wake) ให้คำนวณต่อแม้ไม่มี browser (spec §3.2)
- ทุกเมธอดถูกเรียกใน event loop เดียวกับ controller งานที่ต้องรอ lock ของ runtime (รายชื่อดาว, ตรวจ NORAD) ทำใน thread
  ไม่ถือ lock รวมของ hub ระหว่างรอ act/close ของ controller (engage off อาจรอ rigctld ที่ตายหลายวินาที)
  open/close/close_module/shutdown ของ module เดียวกันทำทีละงานด้วย lock ประจำ module (สร้างเมื่อมีคนใช้ ลบเมื่อไม่มีใครใช้)
  hold(module) ถือ lock นั้นให้ผู้เรียกที่ต้องไม่ให้ controller ของ module เปิดหรือปิดแทรก (PUT module ตรวจ active() แล้วเขียน)
- open, close, close_module, act และ shutdown ทำใน task ของตัวเองแล้ว shield: คำขอที่ถูกยกเลิก (browser ตัดการเชื่อมต่อ) ไม่ตัด
  การปลด Engage กลางทาง (ยกเลิกระหว่างรอ timer task จะยกเลิก task นั้นด้วยแล้ว S/q ไม่ถูกส่ง)
- act ใช้ controller ที่ลงทะเบียนอยู่ตอนเริ่มเท่านั้น close เอา controller ออกก่อนรอให้ปิด act ที่มาทีหลังจึงได้ 404 ไม่ถูกเรียกหลัง close
- on_tick ส่งแถวของดาวที่ controller เลือกอยู่ ณ ตอนเรียก จาก tick เดียวกัน (แถวใน tick ไม่มีเลขดาวให้ controller ตรวจเอง)
"""

import asyncio
import itertools
import logging
from collections.abc import AsyncIterator, Callable, Coroutine
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from .errors import ApiError
from .hwconf import HwConf
from .pass_service import PassService
from .rig import RigController
from .rot import RotController
from .runtime import Hub, ModuleClosedError
from .trsp import load_transponders

RADIO, ROTATOR = "radio", "rotator"
KINDS = (RADIO, ROTATOR)
TITLES = {RADIO: "Radio Control", ROTATOR: "Antenna Control"}

_log = logging.getLogger(__name__)

Controller = RigController | RotController


def rot_owner(module: str) -> str:
    """owner ของ block รายวันที่ PassService.current_pass ขอให้ Antenna Control ของ module (ปล่อยเมื่อปิด)"""
    return f"rot:{module}"


def _not_open(module: str) -> ApiError:
    return ApiError("NOT_FOUND", 404, f"module {module} ไม่ได้เปิดอยู่ (เปิดด้วย File → Open module)", module)


def _no_config(kind: str) -> ApiError:
    if kind == RADIO:
        return ApiError("NO_RADIO_CONFIG", 409,
                        "ยังไม่มีวิทยุ ให้เพิ่มวิทยุที่ Edit → Preferences → Interfaces → Radios ก่อนเปิด Radio Control")
    return ApiError("NO_ROTATOR_CONFIG", 409,
                    "ยังไม่มี rotator ให้เพิ่ม rotator ที่ Edit → Preferences → Interfaces → Rotators ก่อนเปิด Antenna Control")


def _retrieve(task: asyncio.Task) -> None:
    """งานที่ผู้เรียกเลิกรอแล้ว (คำขอถูกยกเลิก): ApiError เป็นคำตอบที่ไม่มีใครอ่าน error อื่นต้องอยู่ใน log"""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None and not isinstance(exc, ApiError):
        _log.error("งานของ controller ที่คำขอถูกยกเลิกไปแล้วล้มเหลว", exc_info=exc)


class ControllerHub:
    def __init__(self, hub: Hub, hw: HwConf, data_dir: Path, passes: PassService, wake: Callable[[str], None]):
        self._hub = hub
        self._hw = hw
        self._data_dir = Path(data_dir)
        self._passes = passes
        self._wake = wake
        self._controllers: dict[tuple[str, str], Controller] = {}   # (module, kind) ตามลำดับที่เปิด
        self._targets: dict[str, int] = {}
        self._target_seq: dict[str, int] = {}                        # module -> ลำดับของการเลือกดาวล่าสุด
        self._seq = itertools.count(1)
        self._locks: dict[str, list] = {}                            # module -> [asyncio.Lock, จำนวนผู้ถือหรือรอ]
        self._tasks: set[asyncio.Task] = set()
        self._stopped = False

    # ---------------------------------------------------------------- อ่านสถานะ

    def active(self, module: str) -> bool:
        """module มี controller เปิดอยู่ (tick ของ module ต้องคำนวณต่อแม้ไม่มี socket)"""
        return any(m == module for m, _ in self._controllers)

    def open_list(self) -> list[dict]:
        return [{"module": m, "kind": k} for m, k in self._controllers]

    def target(self, module: str) -> int | None:
        """ดาวเป้าหมายของ module (Select satellite, คลิกใน view, Autotrack) None ถ้ายังไม่เคยตั้ง"""
        return self._targets.get(module)

    # ---------------------------------------------------------------- เป้าหมาย

    async def set_target(self, module: str, norad: int) -> None:
        """เป้าหมายของ module เปลี่ยน (spec §3.3): จำไว้ให้ controller ที่จะเปิด และ controller ที่เปิดอยู่เลือกดาวนั้น
        module ไม่ได้เปิดหรือดาวไม่อยู่ใน module: 404 NOT_FOUND โดยไม่เปลี่ยนอะไร
        (ของเรา) การเลือกที่มาก่อนแต่รอรายชื่อดาวนานกว่า (thread ไหนเสร็จก่อนก็ได้) ไม่ทับการเลือกที่มาทีหลัง: ทุกคำขอได้ลำดับก่อนรอ
        และเฉพาะคำขอล่าสุดของ module ถูกใช้ คำขอที่ถูกแซงตอบสำเร็จโดยไม่เปลี่ยนอะไร (module ที่ปิดระหว่างรอก็ไม่ได้เป้าหมายค้าง)"""
        rt = self._hub.get(module)
        if rt is None:
            raise _not_open(module)
        seq = self._target_seq[module] = next(self._seq)
        try:
            names = await asyncio.to_thread(rt.sat_names)        # lock ของ runtime อาจถูก tick ถือหลายวินาที
        except ModuleClosedError:
            raise _not_open(module) from None
        if not any(n == norad for n, _ in names):
            raise ApiError("NOT_FOUND", 404, f"ไม่พบดาว NORAD {norad} ใน module {module}", str(norad))
        if self._target_seq.get(module) != seq:
            return
        self._targets[module] = norad
        for kind in KINDS:
            ctl = self._controllers.get((module, kind))
            if ctl is not None:
                ctl.set_target(norad)

    # ---------------------------------------------------------------- เปิด ปิด สั่งงาน

    async def open(self, module: str, kind: str) -> None:
        """เปิด controller (ตัวที่เปิดอยู่แล้วคงเดิม) ไม่มีอุปกรณ์: 409 NO_RADIO_CONFIG / NO_ROTATOR_CONFIG
        module ไม่ได้เปิด (หรือ server กำลังปิด): 404 NOT_FOUND"""
        if kind not in KINDS:
            raise ValueError(f"unknown controller kind {kind!r}")
        await self._shielded(self._open(module, kind))

    async def close(self, module: str, kind: str) -> None:
        """ปิดหน้าต่าง: disengage แล้วเก็บ Cycle (และ Threshold) ลงไฟล์ของอุปกรณ์ ไม่ได้เปิดอยู่ก็ไม่ทำอะไร"""
        await self._shielded(self._close(module, (kind,)))

    async def close_module(self, module: str) -> None:
        """module ปิดหรือถูกลบ: ปิด controller ทุกตัวของ module และลืมเป้าหมาย"""
        await self._shielded(self._close(module, KINDS, forget_target=True))

    async def act(self, module: str, kind: str, body: dict) -> dict:
        """action ของหน้าต่าง (spec §8) คืน snapshot ใหม่ controller ไม่ได้เปิด: 404 NOT_FOUND body ผิด: 422 CONTROLLER_INVALID"""
        return await self._shielded(self._act(module, kind, body))

    async def shutdown(self) -> None:
        """server ปิด: ไม่รับการเปิดใหม่ แล้วปิด controller ทุกตัว (รวมตัวที่กำลังเปิดอยู่)"""
        self._stopped = True
        await self._shielded(self._shutdown())

    @asynccontextmanager
    async def hold(self, module: str) -> AsyncIterator[None]:
        """ถือ lock ประจำ module: open/close ของ module นี้รอจนออกจาก with ใช้กับ PUT module ที่ตรวจ active() แล้วเขียน
        (ไม่มี controller เปิดแทรกหลังตรวจ) อย่า await open/close/close_module ของ module เดียวกันข้างใน (lock ไม่ reentrant)"""
        async with self._serial(module):
            yield

    # ---------------------------------------------------------------- tick

    def on_tick(self, module: str, tick: dict) -> dict:
        """ส่งค่าจาก tick ของ module ให้ controller ที่เปิดอยู่ (เรียกใน event loop ทุกรอบของ producer) คืน
        {"radio": snapshot, "rotator": snapshot} เฉพาะตัวที่เปิด แถวที่ส่งคือแถวของดาวที่ controller เลือกอยู่ตอนนี้ใน tick นี้
        (None ถ้า tick ไม่มีค่าของดาวนั้น เช่นระหว่าง computing) เวลาคือ t ของ tick และ QTH คือ (lat, lon) ของ tick"""
        radio, rot = self._controllers.get((module, RADIO)), self._controllers.get((module, ROTATOR))
        if radio is None and rot is None:
            return {}
        t = datetime.fromisoformat(tick["t"])
        rows = {s["norad"]: s for s in tick.get("sats") or ()}
        out = {}
        if radio is not None:
            radio.on_tick(t, rows.get(radio.norad))
            out[RADIO] = radio.snapshot()
        if rot is not None:
            q = tick["qth"]
            rot.on_tick(t, rows.get(rot.norad), (q["lat_deg"], q["lon_deg"]))
            out[ROTATOR] = rot.snapshot()
        return out

    # ---------------------------------------------------------------- งานจริง (ใน task ของตัวเอง)

    async def _open(self, module: str, kind: str) -> None:
        key = (module, kind)
        async with self._serial(module):
            if key in self._controllers:
                return
            rt = self._hub.get(module)
            if self._stopped or rt is None:
                raise _not_open(module)
            if not (self._hw.radios() if kind == RADIO else self._hw.rotators()):
                raise _no_config(kind)
            try:
                sats = await asyncio.to_thread(rt.sat_names)
            except ModuleClosedError:
                raise _not_open(module) from None
            if self._stopped or self._hub.get(module) is not rt:  # module ปิดหรือ server เริ่มปิดระหว่างรอ
                raise _not_open(module)
            target = self._targets.get(module)
            if kind == RADIO:
                ctl = RigController(module, self._hw, sats, target, self._transponders)
            else:
                owner = rot_owner(module)
                ctl = RotController(module, self._hw, sats, target, rt.azel_at,
                                    lambda norad, t: self._passes.current_pass(owner, module, norad, t))
            self._controllers[key] = ctl
        self._wake(module)

    async def _close(self, module: str, kinds: tuple[str, ...], forget_target: bool = False) -> None:
        async with self._serial(module):
            closing = [(k, ctl) for k in kinds if (ctl := self._controllers.pop((module, k), None)) is not None]
            if forget_target:
                self._targets.pop(module, None)
                self._target_seq.pop(module, None)
            await asyncio.gather(*(self._close_one(module, k, ctl) for k, ctl in closing))

    async def _close_one(self, module: str, kind: str, ctl: Controller) -> None:
        try:
            await ctl.close()
        except Exception:                                        # controller ปิดได้แม้มี error: ตัวอื่นต้องปิดต่อ
            _log.exception("ปิด %s ของ module %s ไม่สำเร็จ", TITLES[kind], module)
        finally:
            if kind == ROTATOR:                                  # timer หยุดแล้ว: ไม่มีใครขอ pass ให้ owner นี้อีก
                self._passes.release_current(rot_owner(module))

    async def _act(self, module: str, kind: str, body: dict) -> dict:
        ctl = self._controllers.get((module, kind))
        if ctl is None:
            raise ApiError("NOT_FOUND", 404, f"หน้าต่าง {TITLES.get(kind, kind)} ของ module {module} ไม่ได้เปิดอยู่", module)
        await ctl.act(body)
        return ctl.snapshot()

    async def _shutdown(self) -> None:
        """open ที่ค้างอยู่ถือ lock ของ module (ปิดหลังมันจบ และมันไม่สร้างตัวใหม่เพราะ _stopped) close ของ controller รอ act
        ที่มาก่อนให้จบ (lock ของ act ใน controller) จบแล้วจึงไม่มีงานของ controller ค้าง"""
        modules = {m for m, _ in self._controllers} | set(self._locks)   # รวม module ที่กำลังเปิด controller อยู่
        await asyncio.gather(*(self._close(m, KINDS, forget_target=True) for m in modules))

    # ---------------------------------------------------------------- ตัวช่วย

    def _transponders(self, norad: int) -> list[dict]:
        return load_transponders(self._data_dir, norad)

    async def _shielded[T](self, coro: Coroutine[object, object, T]) -> T:
        """ทำ coro ใน task ของตัวเอง ผู้เรียกที่ถูกยกเลิกเลิกรอ แต่งานทำต่อจนจบ (เก็บ task ไว้จนจบ ไม่ให้ถูกเก็บขยะ)"""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            task.add_done_callback(_retrieve)
            raise

    @asynccontextmanager
    async def _serial(self, module: str) -> AsyncIterator[None]:
        """lock ประจำ module: สร้างเมื่อมีคนแรกขอ และลบเมื่อคนสุดท้ายเลิกใช้ (แบบ Hub._serial แต่เป็น asyncio)"""
        entry = self._locks.setdefault(module, [asyncio.Lock(), 0])
        entry[1] += 1
        try:
            async with entry[0]:
                yield
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                del self._locks[module]
