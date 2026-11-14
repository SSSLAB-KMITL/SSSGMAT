"""Builds the data folder of the GNSS Studio end-to-end suite (W12): no GMAT, no network.

    server/.venv/bin/python -I web/tests/e2e/fixture/build_fixture.py <out_dir>

`<out_dir>` must not exist yet (or be empty). It gets

- `orbits/20261110T0000Z`   a copy of the engine's snapshot fixture (tests/fixtures/studio/snapshot)
- `settings.json`           the daily job switched OFF, written before any server starts on this folder
- `scenarios/E2E`           thbk-gnss, 2026-11-10T00:00Z .. 06:00Z, with results (propagate + analyze for THBK)
- `scenarios/E2E_NORES`     the same scenario without results
- `scenarios/E2E_EMPTY`     the "empty" template

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
from gnss_predict.propagate import Ephemeris             # noqa: E402
from gnss_studio_server.store import ScenarioStore       # noqa: E402
from gnss_studio_server.templates import THBK, new_scenario  # noqa: E402

SNAPSHOT_SRC = PKG_ROOT / "tests" / "fixtures" / "studio" / "snapshot"
SNAPSHOT = "20261110T0000Z"
START, STOP = "2026-11-10T00:00:00Z", "2026-11-10T06:00:00Z"

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
RADIUS_KM = {"G": 26560.0, "R": 25508.0, "E": 29600.0, "C": 27906.0}
GEO_RADIUS_KM = 42164.0
INCLINATION_DEG = {"G": 55.0, "R": 64.8, "E": 56.0, "C": 55.0}
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


# ---------- build ----------

def _refuse_network(*_args, **_kwargs):
    raise RuntimeError("build_fixture.py must not use the network")


def build(out: Path) -> None:
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; give build_fixture.py a folder that does not exist yet")
    out.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SNAPSHOT_SRC, out / "orbits" / SNAPSHOT)
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
