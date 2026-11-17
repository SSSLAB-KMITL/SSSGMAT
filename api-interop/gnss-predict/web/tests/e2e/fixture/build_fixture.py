"""Builds the data folder of the GNSS Studio end-to-end suite (W12): no GMAT, no network.

    server/.venv/bin/python -I web/tests/e2e/fixture/build_fixture.py <out_dir>

`<out_dir>` must not exist yet (or be empty). It gets

- `orbits/20261110T0000Z`   a copy of the engine's snapshot fixture (tests/fixtures/studio/snapshot) plus the hand-written
                            imaging group files `weather.json`, `science.json` and `visual.json` (tests/fixtures/studio/imaging):
                            the Satellite Catalog lists the imaging satellites X01..X08 (GNSS-only scenes keep their hash: plan Ruling a)
- `settings.json`           the daily job switched OFF, written before any server starts on this folder
- `scenarios/E2E`           thbk-gnss, 2026-11-10T00:00Z .. 06:00Z, with results (propagate + analyze for THBK) and
                            its THBK access marked `computed: true` (as the daily job does), so access lines and
                            Timeline rows are shown
- `scenarios/E2E_NORES`     the same scenario without results (its template access stays `computed: false`)
- `scenarios/E2E_EMPTY`     the "empty" template
- `scenarios/E2E_IMG`       the "empty" template plus THBK, the imaging satellite Terra (`X04`, NORAD 25994) and its primary
                            sensor `MODIS` (Rectangular 55.0 / 0.41 from the preset), with results (propagate + analyze for THBK):
                            the e2e server has no GMAT, so the fixture "propagates" X04 with the made-up orbits (ข2 plan Ruling t)
- `scenarios/E2E_ACCESS`    like `E2E` with results for THBK but no access at all (`accesses: []`): access-reports.spec
                            computes, clears and removes accesses itself and restores the document afterwards
- `scenarios/E2E_SAVE`      the same as `E2E_ACCESS`, for the spec that saves a workbook (File -> Save) so the
                            windows it leaves behind do not reach the scenarios other specs open
- `scenarios/E2E_DATELINE`  12 hours (00:00Z .. 12:00Z) with a second facility DATELINE at 29.3 N, 179.5 E and results
                            for DATELINE only, no access: C09 crosses the antimeridian over DATELINE at about 11:21Z, so a
                            Static Highlight of that access is a ground track that wraps from +180 to -180 degrees
- `scenarios/daily_20261111`, `scenarios/daily_20261112`  daily scenarios (a `daily.for_date`) without results or
                            validation: /validation/pending lists 2026-11-11 as pending (the daily job is off, so no
                            next attempt) and 2026-11-12 as given up (`daily/state.json`)
- `validation/history.jsonl` two checked days of `E2E` (2026-11-09 pass, 2026-11-10 fail with G22) and
  `validation/E2E/validation_2026-11-10.json` the per-satellite result of 2026-11-10, both written from the JSON
  below in the shape `studio.run_validate` writes (no validation runs and nothing is downloaded)

The results of `E2E` come from the engine's own `run_propagate` and `run_analyze("THBK")` with `propagate`,
`find_gmat_console` and `gmat_version` replaced by a made-up orbit model (below), so the files have exactly the
shape of real ones. The model is exact in the Earth-fixed frame, which lets position.spec compare the Cesium
position with `predicted.sp3` to the metre.

Nothing here opens a socket: connections are refused while the fixture is built, so a code path that would
reach CelesTrak, CDDIS or MGEX fails loudly instead.
"""

import json
import math
import shutil
import socket
import sys
import zlib
from datetime import datetime, timedelta
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parents[4]          # api-interop/gnss-predict (this file: web/tests/e2e/fixture/)
sys.path[:0] = [str(PKG_ROOT), str(PKG_ROOT / "server")]  # python -I does not look next to the script or in the cwd

from gnss_predict import studio                          # noqa: E402
from gnss_predict.imaging import preset_by_norad         # noqa: E402
from gnss_predict.propagate import Ephemeris             # noqa: E402
from gnss_studio_server.daily import _mark_computed      # noqa: E402
from gnss_studio_server.store import ScenarioStore       # noqa: E402
from gnss_studio_server.templates import DEFAULT_COLOR, THBK, facility, imaging_sensor, new_scenario, satellite  # noqa: E402

SNAPSHOT_SRC = PKG_ROOT / "tests" / "fixtures" / "studio" / "snapshot"
IMAGING_SRC = PKG_ROOT / "tests" / "fixtures" / "studio" / "imaging"   # weather/science/visual OMM เขียนเอง (ข2)
SNAPSHOT = "20261110T0000Z"
START, STOP = "2026-11-10T00:00:00Z", "2026-11-10T06:00:00Z"
DATELINE_STOP = "2026-11-10T12:00:00Z"
# C09 of the made-up orbits crosses 180 degrees at 29.3 N about 11:21Z of a 12-hour scenario (it rises over DATELINE before)
DATELINE = {"name": "DATELINE", "lat_deg": 29.3, "lon_deg": 179.5, "alt_m": 0.0, "elevation_angle_min_deg": 10.0}

# settings.json (server §9.1) with the daily job off: a server started on this folder never goes online by itself
SETTINGS = {
    "daily": {"enabled": False, "run_at_utc": "21:00", "facility": "THBK", "retention_days": 30,
              "validation_retry_hours": 3, "validation_give_up_days": 14},
    "cesium_ion_token": "",
    "online_imagery": {"enabled": False, "eox": False, "osm": False, "ion": False},
}

# ---------- made-up orbits ----------

MU_KM3_S2 = 398600.4418
OMEGA_E = 7.2921151467e-5                     # rad/s
# X = ดาวถ่ายภาพ LEO (ข2): ราว 705 km เหนือทรงกลม เอียง 98.2° แบบ Terra
RADIUS_KM = {"G": 26560.0, "R": 25508.0, "E": 29600.0, "C": 27906.0, "X": 7076.0}
GEO_RADIUS_KM = 42164.0
INCLINATION_DEG = {"G": 55.0, "R": 64.8, "E": 56.0, "C": 55.0, "X": 98.2}
TERRA_NORAD = 25994
BEIDOU_GEO = {1, 2, 3, 4, 5, 59, 60, 61}      # the other BeiDou PRNs fly at RADIUS_KM["C"]
GEO_LON_DEG = {1: 140.0, 2: 80.0, 3: 110.5, 4: 160.0, 5: 58.75, 59: 144.5, 60: 80.0, 61: 140.0}


def _rotate_z(x: float, y: float, z: float, angle: float) -> tuple[float, float, float]:
    c, s = math.cos(angle), math.sin(angle)
    return (c * x - s * y, s * x + c * y, z)


class CircularOrbit:
    """Circle in the inertial frame; the Earth-fixed position is that circle turned by -omega_e * t."""

    def __init__(self, radius_km: float, inclination_deg: float, raan_rad: float, phase_rad: float, rate_rad_s: float):
        self.radius, self.incl, self.raan, self.phase, self.rate = radius_km, math.radians(inclination_deg), raan_rad, phase_rad, rate_rad_s

    def ecef_km(self, t_s: float) -> tuple[float, float, float]:
        u = self.phase + self.rate * t_s
        x, y = self.radius * math.cos(u), self.radius * math.sin(u) * math.cos(self.incl)
        z = self.radius * math.sin(u) * math.sin(self.incl)
        x, y, z = _rotate_z(x, y, z, self.raan)           # node line
        return _rotate_z(x, y, z, -OMEGA_E * t_s)         # inertial -> Earth-fixed


def _geo(prn_number: int) -> CircularOrbit:
    lon = math.radians(GEO_LON_DEG.get(prn_number, 100.0 + 7.0 * prn_number))
    # rate = omega_e keeps the Earth-fixed longitude constant
    return CircularOrbit(GEO_RADIUS_KM, 0.0, 0.0, lon, OMEGA_E)


def _meo(prn: str, index: int, n_sats: int, duration_s: float) -> CircularOrbit:
    """A pass over THBK at a time spread over the window by `index`, so some satellites are always up and DOP exists."""
    system = prn[0]
    radius, incl = RADIUS_KM[system], math.radians(INCLINATION_DEG[system])
    rate = math.sqrt(MU_KM3_S2 / radius ** 3)
    salt = zlib.crc32(prn.encode("ascii"))
    t_pass = duration_s * (index + 1) / (n_sats + 1)
    lat = math.radians(THBK["lat_deg"])
    lon = math.radians(THBK["lon_deg"] + (salt % 21) - 10)          # cross within +-10 degrees of THBK's longitude
    u = math.asin(math.sin(lat) / math.sin(incl))                   # argument of latitude at that latitude
    if index % 2:
        u = math.pi - u                                              # descending pass
    node_to_sat = math.atan2(math.sin(u) * math.cos(incl), math.cos(u))
    raan = lon + OMEGA_E * t_pass - node_to_sat
    return CircularOrbit(radius, INCLINATION_DEG[system], raan, u - rate * t_pass, rate)


def orbit_of(prn: str, index: int, n_sats: int, duration_s: float) -> CircularOrbit:
    if prn[0] == "C" and int(prn[1:]) in BEIDOU_GEO:
        return _geo(int(prn[1:]))
    return _meo(prn, index, n_sats, duration_s)


def fake_propagate(sats, start: datetime, stop: datetime, step_s: int, work_dir, console, timeout_s=900, on_gmat_start=None):
    """Same contract as gnss_predict.propagate.propagate (positions in km, Earth-fixed) without GMAT."""
    n = int((stop - start).total_seconds()) // step_s
    times = [start + timedelta(seconds=k * step_s) for k in range(n + 1)]
    duration = (stop - start).total_seconds()
    ordered = sorted(sats, key=lambda s: s.prn)
    positions = {}
    for index, sat in enumerate(ordered):
        orbit = orbit_of(sat.prn, index, len(ordered), duration)
        positions[sat.prn] = [orbit.ecef_km(k * step_s) for k in range(n + 1)]
    return Ephemeris(times, positions), []


# ---------- validation (the shape of studio.run_validate's files; values made up) ----------

CREATED_0909, CREATED_1010 = "2026-11-10T03:00:00Z", "2026-11-11T03:00:00Z"


def _system(sats: int, pairs: int, el: tuple[float, float], az: tuple[float, float]) -> dict:
    return {"sats": sats, "pairs": pairs, "az_pairs": pairs - 3, "el_median": el[0], "el_p99": el[1], "az_median": az[0], "az_p99": az[1],
            "pass": el[1] <= 0.2 and az[1] <= 0.5}


def _satellite(pairs: int, el: tuple[float, float], az: tuple[float, float], d3: tuple[float, float], age: float, result: str) -> dict:
    return {"truth": "sp3", "pairs": pairs, "az_pairs": pairs - 1, "el_median": el[0], "el_p99": el[1], "az_median": az[0], "az_p99": az[1],
            "d3_median_km": d3[0], "d3_max_km": d3[1], "age_days": age, "flags": [], "result": result}


VALIDATION_1110 = {
    "day": "2026-11-10",
    "truth_file": "COD0MGXFIN_20263140000_01D_05M_ORB.SP3",
    "systems": {"G": _system(2, 1180, (0.012, 0.31), (0.020, 0.44)), "E": _system(1, 720, (0.008, 0.050), (0.011, 0.090))},
    "satellites": {
        "G01": _satellite(640, (0.006, 0.040), (0.010, 0.080), (0.21, 0.48), 1.25, "pass"),
        "G22": _satellite(540, (0.090, 0.420), (0.150, 0.610), (4.80, 9.70), 6.5, "fail"),
        "E11": _satellite(720, (0.008, 0.050), (0.011, 0.090), (0.30, 0.66), 1.25, "pass"),
    },
    "failing": ["G22"],
    "pass": False,
}
HISTORY = [
    {"day": "2026-11-09", "scenario": "E2E", "ephem_hash": "0909e2e00000", "truth_file": "COD0MGXFIN_20263130000_01D_05M_ORB.SP3",
     "pass": True, "systems": {"G": _system(2, 1200, (0.010, 0.090), (0.018, 0.200)), "E": _system(1, 700, (0.007, 0.040), (0.010, 0.080))},
     "failing": [], "created_utc": CREATED_0909},
    {**{key: VALIDATION_1110[key] for key in ("day", "truth_file", "pass", "systems", "failing")},
     "scenario": "E2E", "ephem_hash": "1010e2e00000", "created_utc": CREATED_1010},
]


def _write_json(path: Path, doc, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")) if compact else json.dumps(doc, indent=2), encoding="utf-8")


def _write_validation(out: Path, store: ScenarioStore) -> None:
    history = out / "validation" / "history.jsonl"
    history.parent.mkdir(parents=True, exist_ok=True)
    history.write_text("".join(json.dumps(line, separators=(",", ":")) + "\n" for line in HISTORY), encoding="utf-8")
    document = {**VALIDATION_1110, "scenario": "E2E", "ephem_hash": "1010e2e00000", "facility": "THBK", "created_utc": CREATED_1010, "messages": []}
    _write_json(out / "validation" / "E2E" / "validation_2026-11-10.json", document)
    # วันของ scenario รายวันที่ยังไม่มีผลตรวจ: 2026-11-11 รออยู่, 2026-11-12 ตัวตั้งเวลาเลิกแล้ว (given_up ใน daily/state.json)
    for day in ("2026-11-11", "2026-11-12"):
        name = f"daily_{day.replace('-', '')}"
        doc = new_scenario(name, f"{day}T00:00:00Z", f"{day}T06:00:00Z", "empty", SNAPSHOT, out)
        doc["daily"] = {"for_date": day, "created_utc": f"{day}T00:00:00Z"}
        store.create(name, doc)
    _write_json(out / "daily" / "state.json", {"last_validation_attempt_utc": None, "given_up": [{"scenario": "daily_20261112", "day": "2026-11-12"}]})


# ---------- build ----------

def _with_results(store: ScenarioStore, out: Path, name: str, stop: str, facilities: list[dict]) -> None:
    """scenario แบบ thbk-gnss ที่ไม่มี access เลย (Facility ที่ส่งมาแทน THBK เพิ่มต่อท้าย) มีผล propagate และ analyze ของ Facility ที่ไม่ใช่ THBK
    (ไม่ส่งมา = analyze ของ THBK)"""
    doc = new_scenario(name, START, stop, "thbk-gnss", SNAPSHOT, out)
    doc["objects"] += [facility(**f) for f in facilities]
    doc["accesses"] = []
    store.create(name, doc)
    scenario_dir = out / "scenarios" / name
    studio.run_propagate(scenario_dir, out)
    for f in facilities or [THBK]:
        studio.run_analyze(scenario_dir, f["name"], out)


def _with_imaging(store: ScenarioStore, out: Path) -> None:
    """E2E_IMG: THBK + X04 (Terra) + Sensor MODIS ตาม preset (ลูกของ X04) มีผล propagate และ analyze ของ THBK (ไม่มี access)"""
    terra = preset_by_norad(TERRA_NORAD)
    doc = new_scenario("E2E_IMG", START, STOP, "empty", SNAPSHOT, out)
    doc["objects"] += [facility(**THBK), satellite(terra.prn, terra.norad, DEFAULT_COLOR),
                       imaging_sensor(terra.camera, f"*/Satellite/{terra.prn}", terra.sensor.definition())]
    store.create("E2E_IMG", doc)
    scenario_dir = out / "scenarios" / "E2E_IMG"
    studio.run_propagate(scenario_dir, out)
    studio.run_analyze(scenario_dir, THBK["name"], out)


def _refuse_network(*_args, **_kwargs):
    raise RuntimeError("build_fixture.py must not use the network")


def build(out: Path) -> None:
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; give build_fixture.py a folder that does not exist yet")
    out.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SNAPSHOT_SRC, out / "orbits" / SNAPSHOT)
    for group in sorted(IMAGING_SRC.glob("*.json")):
        shutil.copyfile(group, out / "orbits" / SNAPSHOT / group.name)
    (out / "settings.json").write_text(json.dumps(SETTINGS, separators=(",", ":")), encoding="utf-8")

    store = ScenarioStore(out)
    for name, template in (("E2E", "thbk-gnss"), ("E2E_NORES", "thbk-gnss"), ("E2E_EMPTY", "empty")):
        store.create(name, new_scenario(name, START, STOP, template, SNAPSHOT, out))

    studio.propagate = fake_propagate
    studio.find_gmat_console = lambda *a, **k: Path("/nonexistent/GmatConsole")
    studio.gmat_version = lambda console: "GmatConsole-R2026a (E2E fake orbits)"
    scenario_dir = out / "scenarios" / "E2E"
    studio.run_propagate(scenario_dir, out)
    studio.run_analyze(scenario_dir, "THBK", out)
    # the web shows only computed accesses (STK semantics): mark them the way the daily job does after its analyze
    messages = _mark_computed(out, "E2E", "THBK")
    if messages:
        raise SystemExit(f"could not mark the E2E access computed: {messages}")
    _with_results(store, out, "E2E_ACCESS", STOP, [])
    _with_results(store, out, "E2E_SAVE", STOP, [])
    _with_results(store, out, "E2E_DATELINE", DATELINE_STOP, [DATELINE])
    _with_imaging(store, out)
    _write_validation(out, store)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    socket.socket.connect = _refuse_network
    socket.create_connection = _refuse_network
    build(Path(argv[1]).resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
