"""ผลลัพธ์และการ propagate (หัวข้อ 6.5 ของ spec server): สถานะ bundle, job propagate, ไฟล์ผลลัพธ์ที่ไม่เปลี่ยน และแคช plan

bundle จริงสร้างโดย engine ใน fixture `s1_computed` (conftest.py) ด้วย GMAT ปลอม ไม่ใช้เน็ต
ส่วน "แคช plan" ตรวจข้อกำหนดเรื่องความเร็วจาก Task 4: แก้ที่ไม่กระทบ engine ต้องไม่คำนวณ plan และ /results ใช้ผลที่คำนวณแล้วซ้ำ
"""

import hashlib
import os
import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from gnss_predict.scenario import load_scenario
from gnss_predict.studio import plan_analyze, plan_propagate
from gnss_studio_server import digests as digests_module
from gnss_studio_server import plans
from gnss_studio_server.digests import FileDigests
from gnss_studio_server.plans import PlanCache

from conftest import SNAPSHOT_ID, SNAPSHOT_SRC

SC = "S1"
BASE = f"/api/scenarios/{SC}"
HASH_RE = re.compile(r"^[0-9a-f]{12}$")
JOB_ID_RE = re.compile(r"^j-\d{8}T\d{6}-[0-9a-f]{4}$")
THAI = re.compile("[฀-๿]")
ERROR_KEYS = {"code", "text", "field", "detail"}
CACHE_CONTROL = "public, max-age=31536000, immutable"
EPHEM_FILES = {"manifest.json": "application/json", "scene.czml": "application/json", "predicted.sp3": "text/plain"}
ACCESS_FILES = {"manifest.json": "application/json", "access.czml": "application/json", "intervals.json": "application/json",
                "aer.csv": "text/csv", "dop.csv": "text/csv", "legacy_gps.csv": "text/csv"}
STATUS_KEYS = {"hash", "status", "available"}


# ---------- helpers ----------

def assert_error(r, status, code, field=None):
    assert r.status_code == status, r.text
    j = r.json()
    assert set(j) == ERROR_KEYS and j["code"] == code and j["field"] == field, j
    assert THAI.search(j["text"])
    return j


def etag_of(client):
    return client.get(BASE).headers["ETag"].strip('"')


def patch(client, obj, body):
    return client.patch(f"{BASE}/objects/{obj}", json=body, headers={"If-Match": f'"{etag_of(client)}"'})


def put_doc(client, mutate):
    r = client.get(BASE)
    doc = r.json()
    mutate(doc)
    ok = client.put(BASE, json=doc, headers={"If-Match": r.headers["ETag"]})
    assert ok.status_code == 200, ok.text
    return ok


def results(client):
    r = client.get(f"{BASE}/results")
    assert r.status_code == 200, r.text
    return r.json()


def sha256_of(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ephem_url(h, name):
    return f"{BASE}/ephem/{h}/{name}"


def access_url(facility, h, name):
    return f"{BASE}/access/{facility}/{h}/{name}"


class Calls:
    """จำนวนครั้งที่ plans.py เรียก plan_propagate / plan_analyze ของ engine"""

    def __init__(self):
        self.propagate = 0
        self.analyze = 0

    @property
    def total(self):
        return self.propagate + self.analyze


@pytest.fixture
def calls(monkeypatch):
    counter = Calls()
    real_propagate, real_analyze = plans.plan_propagate, plans.plan_analyze

    def spy_propagate(*args, **kwargs):
        counter.propagate += 1
        return real_propagate(*args, **kwargs)

    def spy_analyze(*args, **kwargs):
        counter.analyze += 1
        return real_analyze(*args, **kwargs)

    monkeypatch.setattr(plans, "plan_propagate", spy_propagate)
    monkeypatch.setattr(plans, "plan_analyze", spy_analyze)
    return counter


# ---------- GET /results: สถานะ ----------

def test_status_missing_before_any_run(client, s1, data_dir):
    j = results(client)
    assert set(j) == {"ephem", "access", "error"} and j["error"] is None
    scenario_dir = data_dir / "scenarios" / SC
    assert j["ephem"] == {"hash": plan_propagate(scenario_dir, data_dir).hash, "status": "missing", "available": []}
    assert j["access"] == {"THBK": {"hash": plan_analyze(scenario_dir, "THBK", data_dir), "status": "missing", "available": []}}
    assert HASH_RE.fullmatch(j["ephem"]["hash"]) and HASH_RE.fullmatch(j["access"]["THBK"]["hash"])


def test_status_current_then_stale(client, s1_computed):
    h, a = s1_computed["ephem_hash"], s1_computed["access_hash"]
    j = results(client)
    assert j["ephem"] == {"hash": h, "status": "current", "available": [h]}
    assert j["access"] == {"THBK": {"hash": a, "status": "current", "available": [a]}}
    assert j["error"] is None

    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    assert r.status_code == 200 and r.json()["results_stale"] is True
    j = results(client)
    assert j["ephem"] == {"hash": h, "status": "current", "available": [h]}            # ephem ไม่ขึ้นกับมุมเงยต่ำสุด
    access = j["access"]["THBK"]
    assert set(access) == STATUS_KEYS and access["status"] == "stale"
    assert HASH_RE.fullmatch(access["hash"]) and access["hash"] != a and access["available"] == [a]


def test_period_change_makes_ephem_and_access_stale(client, s1_computed):
    h, a = s1_computed["ephem_hash"], s1_computed["access_hash"]
    put_doc(client, lambda doc: doc["analysis_period"].update(stop="2026-11-10T05:00:00Z"))
    j = results(client)
    assert j["ephem"]["status"] == "stale" and j["ephem"]["hash"] != h and j["ephem"]["available"] == [h]
    assert j["access"]["THBK"]["status"] == "stale" and j["access"]["THBK"]["available"] == [a]


def test_available_lists_only_hash_folders_sorted(client, s1_computed, data_dir):
    h = s1_computed["ephem_hash"]
    ephem = data_dir / "scenarios" / SC / "ephem"
    for name in ("ffffffffffff", "000000000000"):
        (ephem / name).mkdir()
    (ephem / "ABCDEF012345").mkdir()                       # ไม่ใช่ hash (ตัวพิมพ์ใหญ่)
    (ephem / f"{h}.tmp-123").mkdir()                       # โฟลเดอร์ชั่วคราวของ write_bundle
    (ephem / "111111111111").write_text("ไฟล์ ไม่ใช่โฟลเดอร์")
    j = results(client)["ephem"]
    assert j["available"] == sorted(["000000000000", h, "ffffffffffff"])
    assert j["status"] == "current" and j["hash"] == h


def test_results_when_snapshot_missing(client, s1_computed, data_dir):         # Review Focus 5
    shutil.rmtree(data_dir / "orbits" / SNAPSHOT_ID)
    r = client.get(f"{BASE}/results")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ephem"]["status"] == "missing" and j["error"]["code"] == "ORBIT_SOURCE_UNAVAILABLE"
    assert j["ephem"]["hash"] is None and j["ephem"]["available"] == [s1_computed["ephem_hash"]]
    assert j["access"] == {"THBK": {"hash": None, "status": "missing", "available": [s1_computed["access_hash"]]}}
    assert set(j["error"]) == {"code", "text"} and THAI.search(j["error"]["text"])


def test_snapshot_deleted_after_warm_results_is_missing(client, s1_computed, data_dir):
    """/results เคยตอบ current (plan อยู่ในแคช) แล้ว snapshot หาย: แคชต้องไม่ทำให้ยังตอบ current; คืน snapshot แล้วกลับเป็น current"""
    assert results(client)["ephem"]["status"] == "current"
    assert results(client)["ephem"]["status"] == "current"
    snapshot = data_dir / "orbits" / SNAPSHOT_ID
    shutil.rmtree(snapshot)
    j = results(client)
    assert j["ephem"]["status"] == "missing" and j["ephem"]["hash"] is None
    assert j["error"]["code"] == "ORBIT_SOURCE_UNAVAILABLE"
    assert j["access"]["THBK"]["status"] == "missing"
    shutil.copytree(SNAPSHOT_SRC, snapshot)
    j = results(client)
    assert j["ephem"]["status"] == "current" and j["error"] is None and j["access"]["THBK"]["status"] == "current"


def test_snapshot_replaced_in_place_changes_hash(client, s1_computed, data_dir):
    """snapshot เดิมถูกเปลี่ยนไฟล์ข้างใน (ชื่อโฟลเดอร์เดิม): plan ที่แคชไว้ใช้ต่อไม่ได้"""
    before = results(client)["ephem"]
    assert before["status"] == "current"
    gps = data_dir / "orbits" / SNAPSHOT_ID / "gps-ops.json"
    gps.write_text(gps.read_text() + "\n")                # เนื้อหา (และขนาด) เปลี่ยน -> files_sha256 เปลี่ยน
    after = results(client)["ephem"]
    assert after["hash"] != before["hash"] and after["status"] == "stale" and after["available"] == [before["hash"]]


def test_results_no_satellites(client, s_empty):
    r = client.post(f"{BASE}/objects", json={"class": "Facility", "method": "Insert Default"},
                    headers={"If-Match": f'"{etag_of(client)}"'})
    assert r.status_code == 201, r.text
    j = results(client)
    assert j["ephem"] == {"hash": None, "status": "missing", "available": []}
    assert j["access"] == {"Facility1": {"hash": None, "status": "missing", "available": []}}
    assert j["error"]["code"] == "NO_SATELLITES" and THAI.search(j["error"]["text"])


def test_results_of_scenario_the_engine_cannot_read(client, s1, data_dir):
    (data_dir / "scenarios" / SC / "scenario.json").write_text('{"format": "gnss-studio-scenario/1", "name": "S1"}')
    r = client.get(f"{BASE}/results")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ephem"] == {"hash": None, "status": "missing", "available": []} and j["access"] == {}
    assert j["error"]["code"] == "SCENARIO_INVALID"


def test_results_unknown_or_unsafe_scenario(client, s1):
    assert_error(client.get("/api/scenarios/nope/results"), 404, "NOT_FOUND")
    assert client.get("/api/scenarios/a.b/results").status_code == 422


# ---------- POST /propagate ----------

def test_propagate_job(client, s1):
    r = client.post(f"{BASE}/propagate")
    assert r.status_code == 202, r.text
    assert set(r.json()) == {"job"} and JOB_ID_RE.fullmatch(r.json()["job"])
    job = client.get(f"/api/jobs/{r.json()['job']}").json()
    assert (job["kind"], job["scenario"], job["params"], job["state"]) == ("propagate", SC, {}, "queued")
    again = client.post(f"{BASE}/propagate")
    assert again.status_code == 202 and again.json() == r.json()                   # job เดิมที่ยังรอ ได้ id เดิม


def test_propagate_unknown_or_unsafe_scenario(client, s1):
    assert_error(client.post("/api/scenarios/nope/propagate"), 404, "NOT_FOUND")
    assert client.post("/api/scenarios/a.b/propagate").status_code == 422
    assert client.get("/api/jobs").json() == []


def test_propagate_job_makes_results_current(client_inline, s1, fake_gmat, data_dir):
    before = results(client_inline)
    assert before["ephem"]["status"] == "missing"
    job_id = client_inline.post(f"{BASE}/propagate").json()["job"]
    deadline = time.monotonic() + 10
    while (job := client_inline.get(f"/api/jobs/{job_id}").json())["state"] in ("queued", "running"):
        assert time.monotonic() < deadline, job
        time.sleep(0.02)
    assert job["state"] == "succeeded", job
    after = results(client_inline)
    h = before["ephem"]["hash"]
    assert after["ephem"] == {"hash": h, "status": "current", "available": [h]}
    assert after["access"]["THBK"]["status"] == "missing"                          # propagate ไม่สร้างผล access


# ---------- GET ไฟล์ผลลัพธ์ ----------

def test_file_sha_matches_disk(client, s1_computed):
    h = s1_computed["ephem_hash"]
    r = client.get(ephem_url(h, "predicted.sp3"))
    assert r.status_code == 200
    on_disk = sha256_of(s1_computed["ephem_dir"] / "predicted.sp3")
    assert hashlib.sha256(r.content).hexdigest() == r.headers["ETag"].strip('"') == on_disk
    assert r.headers["ETag"] == f'"{on_disk}"' and len(on_disk) == 64
    assert r.content == (s1_computed["ephem_dir"] / "predicted.sp3").read_bytes()


@pytest.mark.parametrize("name", sorted(EPHEM_FILES))
def test_ephem_files_served_immutable(client, s1_computed, name):
    r = client.get(ephem_url(s1_computed["ephem_hash"], name))
    assert r.status_code == 200, r.text
    disk = s1_computed["ephem_dir"] / name
    assert r.content == disk.read_bytes() and r.headers["ETag"] == f'"{sha256_of(disk)}"'
    assert r.headers["Cache-Control"] == CACHE_CONTROL
    assert r.headers["Content-Type"].split(";")[0] == EPHEM_FILES[name]


@pytest.mark.parametrize("name", sorted(ACCESS_FILES))
def test_access_files_served_immutable(client, s1_computed, name):
    r = client.get(access_url("THBK", s1_computed["access_hash"], name))
    assert r.status_code == 200, r.text
    disk = s1_computed["access_dir"] / name
    assert r.content == disk.read_bytes() and r.headers["ETag"] == f'"{sha256_of(disk)}"'
    assert r.headers["Cache-Control"] == CACHE_CONTROL
    assert r.headers["Content-Type"].split(";")[0] == ACCESS_FILES[name]


def test_if_none_match_gets_304(client, s1_computed):
    url = ephem_url(s1_computed["ephem_hash"], "scene.czml")
    etag = client.get(url).headers["ETag"]
    for header in (etag, f"W/{etag}", f'"nope", {etag}', "*"):
        r = client.get(url, headers={"If-None-Match": header})
        assert r.status_code == 304 and r.content == b"", header
        assert r.headers["ETag"] == etag and r.headers["Cache-Control"] == CACHE_CONTROL
    assert client.get(url, headers={"If-None-Match": '"nope"'}).status_code == 200


def test_unknown_file_404(client, s1_computed):
    h, a, ephem_dir = s1_computed["ephem_hash"], s1_computed["access_hash"], s1_computed["ephem_dir"]
    (ephem_dir / "validation_2026-11-10.json").write_text("{}")                    # มีจริงบนดิสก์ แต่ไม่อยู่ใน §6.5
    shutil.copy(s1_computed["access_dir"] / "aer.csv", ephem_dir / "aer.csv")      # ชื่อของ access ใน bundle ของ ephem
    shutil.copy(ephem_dir / "scene.czml", s1_computed["access_dir"] / "scene.czml")
    for name in ("scenario.json", "validation_2026-11-10.json", "PREDICTED.SP3", "predicted.sp3.bak", "aer.csv", "..", ".",
                 "%2e%2e%2fscenario.json", "..%2f..%2fscenario.json", "%00", "ว่าง.json"):
        assert_error(client.get(ephem_url(h, name)), 404, "NOT_FOUND")
    for name in ("scenario.json", "predicted.sp3", "scene.czml", "..", "AER.CSV", "aer.csv.bak"):
        assert_error(client.get(access_url("THBK", a, name)), 404, "NOT_FOUND")


def test_missing_file_or_bundle_404(client, s1_computed):
    h, a = s1_computed["ephem_hash"], s1_computed["access_hash"]
    (s1_computed["access_dir"] / "legacy_gps.csv").unlink()
    assert_error(client.get(access_url("THBK", a, "legacy_gps.csv")), 404, "NOT_FOUND")
    assert_error(client.get(ephem_url("0" * 12, "manifest.json")), 404, "NOT_FOUND")             # ไม่มี bundle ของ hash นี้
    assert_error(client.get(access_url("NOPE", a, "manifest.json")), 404, "NOT_FOUND")           # ไม่มี Facility นี้
    assert_error(client.get(access_url("THBK", "0" * 12, "manifest.json")), 404, "NOT_FOUND")
    assert_error(client.get(f"/api/scenarios/nope/ephem/{h}/manifest.json"), 404, "NOT_FOUND")
    assert client.get(f"/api/scenarios/a.b/ephem/{h}/manifest.json").status_code in (404, 422)


@pytest.mark.parametrize("bad", ["ABCDEF012345", "0123456789a", "0123456789abc", "..", "%2e%2e", "ac0b3324dc0g", "ปปปปปปปปปปปป",
                                 "ac0b3324dc0%0a", "%20" * 12, "----------__"])
def test_unsafe_hash_is_404_even_if_folder_exists(client, s1_computed, data_dir, bad):
    scenario_dir = data_dir / "scenarios" / SC
    for parent in (scenario_dir / "ephem", scenario_dir / "access" / "THBK"):       # โฟลเดอร์ที่ชื่อเหมือน hash ผิดรูปแบบมีจริง
        if "%" not in bad and ".." not in bad:
            (parent / bad).mkdir(exist_ok=True)
            (parent / bad / "manifest.json").write_text("{}")
    assert_error(client.get(ephem_url(bad, "manifest.json")), 404, "NOT_FOUND")
    assert_error(client.get(access_url("THBK", bad, "manifest.json")), 404, "NOT_FOUND")


@pytest.mark.parametrize("bad", ["..", "%2e%2e", "a.b", "THBK%20", "ไทย", "x" * 33, "THBK%0a", "TH BK", "THBK%2f.."])
def test_unsafe_facility_is_404(client, s1_computed, data_dir, bad):
    assert_error(client.get(access_url(bad, s1_computed["access_hash"], "manifest.json")), 404, "NOT_FOUND")


def test_long_valid_facility_name_is_just_missing(client, s1_computed):
    assert_error(client.get(access_url("x" * 32, s1_computed["access_hash"], "manifest.json")), 404, "NOT_FOUND")


def test_symlink_out_of_data_is_404(client, s1_computed, tmp_path):
    secret = tmp_path / "secret.json"
    secret.write_text('{"secret": true}')
    manifest = s1_computed["ephem_dir"] / "manifest.json"
    manifest.unlink()
    manifest.symlink_to(secret)
    assert_error(client.get(ephem_url(s1_computed["ephem_hash"], "manifest.json")), 404, "NOT_FOUND")

    outside = tmp_path / "outside"
    shutil.copytree(s1_computed["access_dir"], outside)
    facility_dir = s1_computed["access_dir"].parent
    shutil.rmtree(facility_dir)
    facility_dir.symlink_to(outside, target_is_directory=True)
    assert_error(client.get(access_url("THBK", s1_computed["access_hash"], "manifest.json")), 404, "NOT_FOUND")


def test_file_routes_in_openapi(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    for path in ("/api/scenarios/{sc}/results", "/api/scenarios/{sc}/propagate", "/api/scenarios/{sc}/ephem/{hash}/{file}",
                 "/api/scenarios/{sc}/access/{facility}/{hash}/{file}"):
        assert path in paths, path


# ---------- แคช SHA-256 ของไฟล์ ----------

@pytest.fixture
def hash_reads(monkeypatch):
    reads = []
    real = digests_module.read_sha256

    def spy(path):
        reads.append(path)
        return real(path)

    monkeypatch.setattr(digests_module, "read_sha256", spy)
    return reads


def test_digest_cache_keyed_by_path_size_and_mtime(tmp_path, hash_reads):
    digests = FileDigests()
    file = tmp_path / "x.sp3"
    file.write_bytes(b"abc")
    assert digests.sha256(file) == hashlib.sha256(b"abc").hexdigest()
    assert digests.sha256(file) == hashlib.sha256(b"abc").hexdigest() and len(hash_reads) == 1
    file.write_bytes(b"abcd")                                                      # ขนาดเปลี่ยน
    assert digests.sha256(file) == hashlib.sha256(b"abcd").hexdigest() and len(hash_reads) == 2
    stat = file.stat()
    file.write_bytes(b"abce")                                                      # ขนาดเท่าเดิม เวลาแก้ไขต่าง
    os.utime(file, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert digests.sha256(file) == hashlib.sha256(b"abce").hexdigest() and len(hash_reads) == 3


def test_digest_cache_is_bounded(tmp_path, hash_reads):
    digests = FileDigests(size=2)
    files = []
    for i in range(3):
        files.append(tmp_path / f"f{i}")
        files[-1].write_bytes(bytes([i]))
        digests.sha256(files[-1])
    assert len(digests) == 2 and len(hash_reads) == 3
    digests.sha256(files[2])                                                       # ใหม่สุดยังอยู่
    assert len(hash_reads) == 3
    digests.sha256(files[0])                                                       # เก่าสุดถูกเขี่ยออกแล้ว
    assert len(hash_reads) == 4


def test_unchanged_file_is_not_rehashed_per_request(client, s1_computed, hash_reads):
    url = ephem_url(s1_computed["ephem_hash"], "predicted.sp3")
    first = client.get(url)
    for _ in range(3):
        assert client.get(url).headers["ETag"] == first.headers["ETag"]
    assert len(hash_reads) == 1


# ---------- แคช plan: แก้ที่ไม่กระทบ engine ไม่คำนวณ plan ----------

def test_graphics_only_patch_computes_no_plan(client, s1, calls):
    for obj, body in (("Satellite/G01", {"graphics2d": {"color": "#00ff00"}}),
                      ("Satellite/G01", {"graphics3d": {"show": False}}),
                      ("Facility/THBK", {"graphics2d": {"color": "#123456", "marker_style": "Star"}}),
                      ("Facility/THBK", {"constraints": {"elevation_angle_min_deg": 10}}),
                      ("Satellite/G01", {"basic": {"description": "ดาวทดสอบ"}})):
        r = patch(client, obj, body)
        assert r.status_code == 200 and r.json()["results_stale"] is False, (obj, body, r.text)
    assert calls.total == 0


def test_put_that_changes_nothing_the_engine_reads_computes_no_plan(client, s1, calls):
    r = put_doc(client, lambda doc: doc.update(x_note="บันทึกของหน้าเว็บ"))
    assert r.headers["X-Results-Stale"] == "false" and calls.total == 0


def test_min_el_patch_still_reports_stale(client, s1, calls):
    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    assert r.status_code == 200 and r.json()["results_stale"] is True
    assert calls.propagate >= 1 and calls.analyze >= 1


def test_graphics_patch_with_snapshot_missing_is_still_stale(client, s1, snapshot, calls):
    shutil.rmtree(snapshot)                                                        # คำนวณ plan ไม่ได้ -> ถือว่า stale เหมือนเดิม
    r = patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}})
    assert r.status_code == 200 and r.json()["results_stale"] is True


def test_second_edit_reuses_the_fingerprint_computed_after_the_first(client, s1, calls):
    assert patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}}).json()["results_stale"] is True
    first = calls.propagate
    assert first == 2                                                              # ก่อนเขียนหนึ่งครั้ง หลังเขียนหนึ่งครั้ง
    assert patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 20}}).json()["results_stale"] is True
    assert calls.propagate == first + 1                                            # ก่อนเขียนมาจากแคช คำนวณแค่หลังเขียน


def test_results_after_an_edit_hits_the_cache(client, s1, calls):
    patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    used = calls.total
    results(client)
    results(client)
    assert calls.total == used


def test_results_after_graphics_only_edit_hits_the_cache(client, s1_computed, calls):
    """แก้สี/Show เปลี่ยน ETag แต่ไม่กระทบ engine: plan ที่แคชไว้ย้ายไปอยู่ใต้ ETag ใหม่ /results ครั้งถัดไป (ที่หน้าเว็บเรียกทุก event scenario) ไม่คำนวณใหม่"""
    first = results(client)
    used = calls.total
    assert used == 2                                                               # propagate 1 + analyze 1 ของ /results ครั้งแรก
    for obj, body in (("Satellite/G01", {"graphics2d": {"color": "#00ff00"}}), ("Satellite/G01", {"graphics3d": {"show": False}}),
                      ("Facility/THBK", {"graphics2d": {"color": "#123456"}})):
        before = etag_of(client)
        r = patch(client, obj, body)
        assert r.status_code == 200 and r.json()["results_stale"] is False
        assert etag_of(client) != before                                           # ไฟล์เปลี่ยนจริง
        assert results(client) == first                                            # ยัง current ทุกอย่างเหมือนเดิม
        assert calls.total == used


def test_graphics_edit_does_not_seed_the_cache_when_the_snapshot_changed(client, s1_computed, data_dir, calls):
    """ย้ายแคชเฉพาะเมื่อ snapshot ยังเป็นตัวเดิม: snapshot หายไปแล้วต้องไม่ได้ plan เก่าไปใช้"""
    assert results(client)["ephem"]["status"] == "current"
    shutil.rmtree(data_dir / "orbits" / SNAPSHOT_ID)
    assert patch(client, "Satellite/G01", {"graphics2d": {"color": "#00ff00"}}).json()["results_stale"] is True
    j = results(client)
    assert j["ephem"]["status"] == "missing" and j["error"]["code"] == "ORBIT_SOURCE_UNAVAILABLE"


def test_carry_over_needs_same_etag_and_same_snapshot(client, s1_computed, data_dir):
    cache = client.app.state.plans
    cache.get(SC)
    old_key = cache.key(SC)
    tag = etag_of(client)
    assert len(cache) == 1
    cache.carry_over(old_key, "feedfacefeedface")                                  # ไม่ใช่ ETag ของไฟล์ตอนนี้
    assert len(cache) == 1
    gps = data_dir / "orbits" / SNAPSHOT_ID / "gps-ops.json"
    gps.write_text(gps.read_text() + "\n")                                         # snapshot ไม่ใช่ตัวเดิมแล้ว
    cache.carry_over(old_key, tag)
    assert len(cache) == 1
    cache.carry_over(("nope", "x", None), tag)                                     # ไม่มีของเดิมในแคช / ไม่มี scenario: ไม่ raise
    assert len(cache) == 1


def test_second_results_call_hits_cache(client, s1_computed, calls):
    first = results(client)
    assert calls.propagate == 1 and calls.analyze == 1
    assert results(client) == first
    assert (calls.propagate, calls.analyze) == (1, 1)


def test_results_recomputed_when_etag_changes(client, s1_computed, calls):
    results(client)
    patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    seen = calls.total
    results(client)                                                                # ETag ใหม่ แต่ตอนแก้คำนวณหลังเขียนไว้แล้ว
    assert calls.total == seen
    put_doc(client, lambda doc: doc["analysis_period"].update(stop="2026-11-10T05:00:00Z"))
    assert calls.total > seen                                                      # แก้ที่กระทบ engine คำนวณใหม่


def test_cache_is_per_app_and_bounded(client, s1, calls):
    store, logger = client.app.state.store, client.app.state.logger
    cache = PlanCache(store, logger, size=2)
    for name in ("S2", "S3"):
        assert client.post(f"{BASE}/copy", json={"new_name": name}).status_code == 201
    for name in (SC, "S2", "S3"):
        cache.get(name)
    assert len(cache) == 2 and calls.propagate == 3
    cache.get("S3")
    assert calls.propagate == 3                                                    # ใหม่สุดยังอยู่
    cache.get(SC)
    assert calls.propagate == 4                                                    # เก่าสุดถูกเขี่ยออกแล้ว
    assert client.app.state.plans is not cache and len(client.app.state.plans) == 0


def test_cache_is_thread_safe(client, s1_computed):
    cache = client.app.state.plans
    with ThreadPoolExecutor(8) as pool:
        got = list(pool.map(lambda _: cache.get(SC), range(24)))
    assert all(p == got[0] for p in got) and got[0].propagate == s1_computed["ephem_hash"] and len(cache) == 1


def test_cache_key_includes_snapshot_identity(client, s1_computed, data_dir, calls):
    cache = client.app.state.plans
    cache.get(SC)
    cache.get(SC)
    assert calls.propagate == 1
    brdc = data_dir / "orbits" / SNAPSHOT_ID / "brdc"
    shutil.copy(brdc / "BRDC00IGS_R_20263130000_01D_MN.rnx", brdc / "BRDC00IGS_R_20263130001_01D_MN.rnx")   # ไฟล์ broadcast ใหม่
    cache.get(SC)
    assert calls.propagate == 2


def test_unexpected_plan_failure_does_not_fail_the_edit(client, s1, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(plans, "plan_propagate", boom)
    r = patch(client, "Facility/THBK", {"constraints": {"elevation_angle_min_deg": 15}})
    assert r.status_code == 200 and r.json()["results_stale"] is True              # บันทึกแล้ว เช็ก stale ไม่ได้ = stale
    assert load_scenario(client.app.state.store.path(SC) / "scenario.json").facilities[0].min_el_deg == 15
    monkeypatch.undo()
    assert results(client)["error"] is None                                        # ความล้มเหลวที่ไม่คาดไว้ไม่ถูกแคช


def test_plan_cache_survives_concurrent_edits(client, s1):
    """แก้หลายครั้งพร้อมกันด้วย ETag ปัจจุบัน: ทุก thread ได้คำตอบที่ถูกต้อง (200 หรือ 412) ไม่มี exception จากแคช"""
    errors = []
    start = threading.Barrier(4)

    def edit(i):
        try:
            start.wait(5)
            tag = etag_of(client)
            return client.patch(f"{BASE}/objects/Facility/THBK", json={"constraints": {"elevation_angle_min_deg": 11 + i}},
                                headers={"If-Match": f'"{tag}"'}).status_code
        except Exception as exc:                                                   # pragma: no cover
            errors.append(exc)

    with ThreadPoolExecutor(4) as pool:
        codes = list(pool.map(edit, range(4)))
    assert not errors and set(codes) <= {200, 412} and 200 in codes
    assert results(client)["access"]["THBK"]["status"] == "missing"
