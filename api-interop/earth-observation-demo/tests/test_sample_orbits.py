import math
import pytest
from fastapi.testclient import TestClient
from pyproj import Transformer

from eo_engine.samples import sample
from eo_engine.sample_orbits import solve, clean_line, archive
from server import app


@pytest.mark.parametrize("sample_id,norad,expected", [
    ("vegas-wv3", 40115, (34.7779556, -114.1929837, 617042.756)),
    ("bangkok-wv03", 40115, (12.5996923, 97.9200974, 611296.187)),
    ("mandalay-ge01", 33331, (21.2964084, 93.4545204, 682643.867)),
])
def test_historical_tle_positions_match_platform_time_and_wgs84(sample_id, norad, expected):
    row = sample(sample_id)
    result = solve(row)
    p = result["position"]
    assert result["estimated"] is True
    assert result["norad_id"] == norad
    assert result["time_basis"] == "image_metadata"
    assert p["time"] == row["acquired_utc"]
    assert (p["lat"], p["lon"], p["altitude_m"]) == pytest.approx(expected, abs=0.002)
    assert abs(result["tle_age_hours"]) < 6
    assert result["ground_look"]["elevation_deg"] > 0
    xyz = Transformer.from_crs(4979, 4978, always_xy=True).transform(p["lon"], p["lat"], p["altitude_m"])
    # Skyfield's iterative geodetic inverse differs from PROJ by about 2 mm.
    # This checks frame consistency; it is not a claim about TLE accuracy.
    assert xyz == pytest.approx(p["ecef_m"], abs=0.005)
    assert len(result["geometry"]["samples"]) == 1  # no invented collection interval


def test_rotterdam_requires_user_time_and_does_not_invent_capture_time():
    row = sample("rotterdam-wv2")
    result = solve(row)
    assert result["status"] == "needs_time"
    assert result["position"] is None
    result = solve(row, "2019-08-31T12:00:00Z")
    assert result["time_basis"] == "selected_time"
    assert result["position"]["time"] == "2019-08-31T12:00:00Z"
    assert result["image_datetime"] == "2019-08-31"
    assert result["norad_id"] == 35946
    assert all(math.isfinite(v) for v in result["position"]["ecef_m"])


def test_tle_checksum_and_satellite_id_are_validated():
    _, record, _, lines = archive("vegas-wv3")
    assert record["tle_line1"].endswith("\\")  # retain raw archived evidence
    assert all(len(line) == 69 for line in lines)
    with pytest.raises(ValueError, match="checksum"):
        clean_line(lines[0][:68] + "0", 1, 40115)
    with pytest.raises(ValueError, match="identity"):
        clean_line(lines[0], 1, 35946)


def test_orbit_api_validates_time_and_sample_without_network():
    client = TestClient(app)
    assert client.get("/api/eo/samples/bangkok-wv03/orbit").json()["norad_id"] == 40115
    assert client.get("/api/eo/samples/rotterdam-wv2/orbit").json()["position"] is None
    assert client.get("/api/eo/samples/unknown/orbit").status_code == 404
    for bad in ("2025-02-14", "2025-02-14T04:02:16", "2025-02-15T04:02:16Z", "2025-02-14T04:02:16+07:00", "garbage"):
        assert client.get("/api/eo/samples/bangkok-wv03/orbit", params={"at_utc": bad}).status_code == 422
    row = {**sample("bangkok-wv03"), "acquired_utc": "2025-02-18T04:02:16Z"}
    with pytest.raises(ValueError, match="48 hours"):
        solve(row)
