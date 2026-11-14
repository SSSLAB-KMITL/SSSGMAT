"""ภาพแผนที่ (ref-D §11): 15 ภาพของ Gpredict ที่มากับ server กับภาพที่ผู้ใช้อัปโหลด (decision 2 ของแผน: body ดิบ)
test ใช้ data dir ชั่วคราวและภาพสังเคราะห์ขนาดเล็กที่มีแค่หัวไฟล์ (PNG IHDR, JPEG SOFn) ไม่ใช้เน็ต"""

import asyncio
import struct
import unittest
import zlib
from pathlib import Path

from gpredict_web import app as app_module
from gpredict_web import maps
from gpredict_web.errors import ApiError
from gpredict_web.maps import MAP_UPLOAD_MAX, STOCK_MAPS, image_size, list_maps, resolve, save_upload
from gpredict_web.module import DEFAULT_MAP, is_map_file
from tests.helpers import FakeRequest, temp_config
from tests.test_api import ApiTestBase

# ref-D §11 "Stock maps shipped" ตามลำดับในเอกสาร
REF_D_STOCK = ("earth_800.png", "nasa-bmng-01_1024.jpg", "nasa-bmng-01_2048.jpg", "nasa-bmng-03_1024.jpg",
               "nasa-bmng-03_2048.jpg", "nasa-bmng-05_1024.jpg", "nasa-bmng-05_2048.jpg", "nasa-bmng-07_1024.jpg",
               "nasa-bmng-07_2048.jpg", "nasa-bmng-08_1024.jpg", "nasa-bmng-08_2048.jpg", "nasa-topo_800.png",
               "nasa-topo_1024.jpg", "nasa-topo_1600.jpg", "nasa-topo_2048.jpg")
# ขนาดของภาพจริง (ตรวจด้วย `file`)
STOCK_SIZES = {"earth_800.png": (800, 400), "nasa-topo_800.png": (800, 400), "nasa-topo_1024.jpg": (1024, 512),
               "nasa-topo_1600.jpg": (1600, 800), "nasa-topo_2048.jpg": (2048, 1024)}
ENTRY_KEYS = ["file", "stock", "width", "height", "bytes"]
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png_bytes(w: int = 4, h: int = 2) -> bytes:
    """PNG ที่ถอดรหัสได้จริง (RGB สีเดียว)"""
    raw = b"".join(b"\x00" + b"\x20\x40\x80" * w for _ in range(h))
    return (PNG_MAGIC + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b""))


def jpeg_bytes(w: int = 6, h: int = 3, sof: int = 0xC0, before: bytes = b"") -> bytes:
    """JPEG ที่มีแค่ส่วนหัว: SOI, APP0 (JFIF), ส่วนที่ขอ, SOFn, SOS, EOI (ไม่ใช่ภาพที่ถอดรหัสได้ แต่หัวไฟล์ถูกต้อง)"""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof_seg = bytes([0xFF, sof]) + struct.pack(">HBHHB", 11, 8, h, w, 1) + b"\x01\x11\x00"
    sos = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00" + b"\x00"
    return b"\xff\xd8" + app0 + before + sof_seg + sos + b"\xff\xd9"


def padded(body: bytes, size: int) -> bytes:
    """ต่อท้ายด้วยศูนย์จนยาว size ไบต์ (ส่วนท้ายหลัง IEND ไม่มีผลกับการอ่านหัวไฟล์)"""
    return body + b"\x00" * (size - len(body))


class ImageSizeTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(temp_config(self).data_dir)
        self.dir.mkdir(parents=True)

    def size_of(self, data: bytes, name: str = "x.bin") -> tuple[int, int]:
        path = self.dir / name
        path.write_bytes(data)
        return image_size(path)

    def test_png(self):
        self.assertEqual(self.size_of(png_bytes(4, 2)), (4, 2))
        self.assertEqual(self.size_of(png_bytes(1600, 800)), (1600, 800))

    def test_jpeg_baseline_progressive_and_extended(self):
        for sof in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC9, 0xCF):
            with self.subTest(sof=hex(sof)):
                self.assertEqual(self.size_of(jpeg_bytes(300, 200, sof)), (300, 200))
        self.assertEqual(self.size_of(jpeg_bytes(65535, 65535)), (65535, 65535))        # ไม่ใช่ตัวเลขมีเครื่องหมาย

    def test_jpeg_skips_other_segments_and_fill_bytes(self):
        comment = b"\xff\xfe" + struct.pack(">H", 7) + b"hello"
        dht = b"\xff\xc4" + struct.pack(">H", 5) + b"\x00\x01\x02"          # DHT (C4) ไม่ใช่ SOF
        dac = b"\xff\xcc" + struct.pack(">H", 4) + b"\x00\x01"               # DAC (CC) ไม่ใช่ SOF
        self.assertEqual(self.size_of(jpeg_bytes(30, 20, before=comment + dht + dac)), (30, 20))
        self.assertEqual(self.size_of(jpeg_bytes(30, 20, before=b"\xff\xff\xff" + comment)), (30, 20))   # ไบต์ FF เติม

    def test_not_an_image(self):
        bad = {"empty": b"", "text": b"hello world, this is not an image", "gif": b"GIF89a" + b"\x00" * 20,
               "png signature only": PNG_MAGIC, "png without ihdr": PNG_MAGIC + _chunk(b"IDAT", b"abcdefgh"),
               "png zero width": png_bytes(0, 5), "png zero height": png_bytes(5, 0),
               "jpeg soi only": b"\xff\xd8", "jpeg truncated in sof": jpeg_bytes()[:24],
               "jpeg no sof before sos": b"\xff\xd8" + b"\xff\xda" + struct.pack(">H", 8) + b"\x00" * 6,
               "jpeg zero size": jpeg_bytes(0, 0), "jpeg bad segment length": b"\xff\xd8\xff\xe0\x00\x01",
               "jpeg without marker": b"\xff\xd8\x12\x34\x56\x78"}
        for label, data in bad.items():
            with self.subTest(label):
                with self.assertRaises(ValueError):
                    self.size_of(data)

    def test_missing_file_is_os_error(self):
        with self.assertRaises(OSError):
            image_size(self.dir / "absent.png")


class StockMapsTest(unittest.TestCase):
    def setUp(self):
        self.data = temp_config(self).data_dir

    def test_stock_names_are_the_gpredict_list(self):
        self.assertEqual(STOCK_MAPS, REF_D_STOCK)
        self.assertIn(DEFAULT_MAP, STOCK_MAPS)
        self.assertTrue(all(is_map_file(n) for n in STOCK_MAPS))                  # ใช้เป็นชื่อของ module และ MODULES/MAP_FILE ได้
        shipped = sorted(p.name for p in maps.STOCK_DIR.iterdir())
        self.assertEqual(shipped, sorted((*STOCK_MAPS, "SOURCE.md")))
        self.assertIn("NASA Visible Earth", (maps.STOCK_DIR / "SOURCE.md").read_text(encoding="utf-8"))

    def test_stock_maps_listed_with_sizes(self):
        listed = list_maps(self.data)
        self.assertEqual([m["file"] for m in listed], list(REF_D_STOCK))          # ภาพของ Gpredict ตามลำดับในเอกสาร
        for entry in listed:
            with self.subTest(entry["file"]):
                self.assertEqual(list(entry), ENTRY_KEYS)
                self.assertTrue(entry["stock"])
                self.assertEqual(entry["bytes"], (maps.STOCK_DIR / entry["file"]).stat().st_size)
                want = STOCK_SIZES.get(entry["file"]) or ((1024, 512) if entry["file"].endswith("_1024.jpg") else (2048, 1024))
                self.assertEqual((entry["width"], entry["height"]), want)
        default = next(m for m in listed if m["file"] == "nasa-bmng-07_1024.jpg")
        self.assertEqual((default["width"], default["height"]), (1024, 512))
        self.assertEqual(default["bytes"], 94680)

    def test_resolve_stock(self):
        path = resolve(self.data, DEFAULT_MAP)
        self.assertEqual(path, maps.STOCK_DIR / DEFAULT_MAP)
        self.assertTrue(path.is_file())
        self.assertEqual(image_size(path), (1024, 512))
        self.assertTrue(all(resolve(self.data, n).is_file() for n in STOCK_MAPS))

    def test_resolve_rejects_names_that_are_not_maps(self):
        for name in ("", ".", "..", "../x.png", "a/b.png", "..\\x.png", "SOURCE.md", "nasa-bmng-07_1024.gif", "x.png\x00",
                     "absent.png", "A" * 101 + ".png", "nasa-bmng-07 1024.jpg"):
            with self.subTest(name=name):
                self.assertIsNone(resolve(self.data, name))


class UploadTest(unittest.TestCase):
    def setUp(self):
        self.data = temp_config(self).data_dir
        self.dir = self.data / "maps"

    def assert_invalid(self, name, content_type, body, obj=None):
        with self.assertRaises(ApiError) as cm:
            save_upload(self.data, name, content_type, body)
        self.assertEqual((cm.exception.code, cm.exception.status), ("MAP_INVALID", 422))
        if obj is not None:
            self.assertEqual(cm.exception.object, obj)
        self.assertRegex(cm.exception.text, r"[ก-๙]")
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()) if self.dir.exists() else [], [])    # ไม่มีไฟล์ค้าง

    def test_upload_and_serve(self):
        body = png_bytes(8, 4)
        self.assertEqual(save_upload(self.data, "my-map.png", "image/png", body), "my-map.png")
        entry = list_maps(self.data)[-1]
        self.assertEqual(entry, {"file": "my-map.png", "stock": False, "width": 8, "height": 4, "bytes": len(body)})
        self.assertEqual(len(list_maps(self.data)), 16)
        path = resolve(self.data, "my-map.png")
        self.assertEqual(path, self.dir / "my-map.png")
        self.assertEqual(path.read_bytes(), body)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["my-map.png"])           # ไม่มีไฟล์ชั่วคราวค้าง

    def test_jpeg_extensions_and_content_type_forms(self):
        jpg = jpeg_bytes(30, 10)
        self.assertEqual(save_upload(self.data, "a.jpg", "image/jpeg", jpg), "a.jpg")
        self.assertEqual(save_upload(self.data, "b.jpeg", "image/jpeg", jpg), "b.jpeg")
        self.assertEqual(save_upload(self.data, "Photo.JPG", "IMAGE/JPEG", jpg), "Photo.JPG")      # นามสกุลและชนิดไม่สนตัวพิมพ์
        self.assertEqual(save_upload(self.data, "c.png", "image/png; charset=binary", png_bytes()), "c.png")
        self.assertEqual([m["file"] for m in list_maps(self.data)[15:]], ["a.jpg", "b.jpeg", "c.png", "Photo.JPG"])   # ไม่สนตัวพิมพ์
        self.assertEqual(list_maps(self.data)[15]["width"], 30)

    def test_uploads_listed_after_stock_sorted_by_name(self):
        for name in ("zebra.png", "Alpha.png", "mid.png"):
            save_upload(self.data, name, "image/png", png_bytes())
        listed = list_maps(self.data)
        self.assertEqual([m["file"] for m in listed[:15]], list(STOCK_MAPS))
        self.assertEqual([(m["file"], m["stock"]) for m in listed[15:]],
                         [("Alpha.png", False), ("mid.png", False), ("zebra.png", False)])

    def test_upload_same_name_replaces(self):
        save_upload(self.data, "m.png", "image/png", png_bytes(2, 2))
        save_upload(self.data, "m.png", "image/png", png_bytes(6, 3))
        self.assertEqual([(m["width"], m["height"]) for m in list_maps(self.data)[15:]], [(6, 3)])
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["m.png"])

    def test_upload_limit_is_ten_megabytes_inclusive(self):
        self.assertEqual(MAP_UPLOAD_MAX, 10 * 1024 * 1024)
        body = padded(png_bytes(), MAP_UPLOAD_MAX)
        self.assertEqual(save_upload(self.data, "big.png", "image/png", body), "big.png")
        self.assertEqual((self.dir / "big.png").stat().st_size, MAP_UPLOAD_MAX)

    def test_upload_rejects(self):
        png, jpg = png_bytes(), jpeg_bytes()
        too_big = padded(png, MAP_UPLOAD_MAX + 1)
        self.assert_invalid("big.png", "image/png", too_big, "body")                    # 10 MB + 1
        self.assert_invalid("../x.png", "image/png", png, "name")
        self.assert_invalid("a/b.png", "image/png", png, "name")
        self.assert_invalid("..", "image/png", png, "name")
        self.assert_invalid("x y.png", "image/png", png, "name")
        self.assert_invalid("", "image/png", png, "name")
        self.assert_invalid("a" * 97 + ".png", "image/png", png, "name")                 # ยาว 101
        self.assert_invalid("x.gif", "image/gif", b"GIF89a" + b"\x00" * 20, "name")
        self.assert_invalid("x.gif", "image/png", png, "name")
        self.assert_invalid("x", "image/png", png, "name")
        self.assert_invalid(".png", "image/png", png, "name")                           # ไม่มีชื่อหน้านามสกุล
        self.assert_invalid("earth_800.png", "image/png", png, "name")                  # ซ้ำภาพของ Gpredict
        self.assert_invalid(DEFAULT_MAP, "image/jpeg", jpg, "name")
        self.assert_invalid("x.png", "image/jpeg", png, "Content-Type")                 # ชนิดไม่ตรงนามสกุล
        self.assert_invalid("x.jpg", "image/png", jpg, "Content-Type")
        self.assert_invalid("x.png", None, png, "Content-Type")
        self.assert_invalid("x.png", "application/octet-stream", png, "Content-Type")
        self.assert_invalid("x.png", "image/png", jpg, "body")                          # magic bytes ไม่ตรง
        self.assert_invalid("x.jpg", "image/jpeg", png, "body")
        self.assert_invalid("x.png", "image/png", b"", "body")
        self.assert_invalid("x.png", "image/png", PNG_MAGIC, "body")                    # มีแต่ signature
        self.assert_invalid("x.jpg", "image/jpeg", b"\xff\xd8\xff", "body")
        self.assert_invalid("x.png", "image/png", png_bytes(0, 0), "body")

    def test_resolve_and_list_ignore_other_files_in_the_upload_dir(self):
        save_upload(self.data, "ok.png", "image/png", png_bytes())
        (self.dir / "notes.txt").write_text("x", encoding="utf-8")
        (self.dir / "broken.png").write_bytes(b"not a png")
        (self.dir / "folder.png").mkdir()
        (self.dir / "bad name.png").write_bytes(png_bytes())
        (self.dir / ".ok.png.1234.tmp").write_bytes(png_bytes())
        self.assertEqual([m["file"] for m in list_maps(self.data)[15:]], ["ok.png"])
        for name in ("notes.txt", "folder.png", "bad name.png", ".ok.png.1234.tmp"):           # นามสกุล, โฟลเดอร์, ชื่อ, ไฟล์ชั่วคราว
            with self.subTest(name=name):
                self.assertIsNone(resolve(self.data, name))
        self.assertEqual(resolve(self.data, "ok.png"), self.dir / "ok.png")

    def test_stock_name_resolves_to_stock_even_if_the_upload_dir_has_it(self):
        self.dir.mkdir(parents=True)
        (self.dir / "earth_800.png").write_bytes(png_bytes(3, 3))                        # วางมือใน data/maps
        self.assertEqual(resolve(self.data, "earth_800.png"), maps.STOCK_DIR / "earth_800.png")
        self.assertEqual(len(list_maps(self.data)), 15)                                  # ไม่ซ้ำในรายการ


class ReadMapBodyTest(unittest.TestCase):
    """_read_map_body: เกินขีดจำกัดต้องหยุดอ่านทันที ไม่เก็บทั้งก้อนไว้ในหน่วยความจำ"""

    MB = 1024 * 1024

    def read(self, request) -> bytes:
        return asyncio.run(app_module._read_map_body(request))

    def test_chunked_body_stops_at_the_limit(self):
        request = FakeRequest(chunks=50, size=self.MB)                     # ไม่มี Content-Length
        with self.assertRaises(ApiError) as cm:
            self.read(request)
        self.assertEqual((cm.exception.code, cm.exception.status, cm.exception.object), ("MAP_INVALID", 422, "body"))
        self.assertEqual(request.sent, 11)                                 # 10 ก้อนพอดีขีดจำกัด ก้อนที่ 11 เกินแล้วหยุด

    def test_chunked_body_at_the_limit_is_read_whole(self):
        self.assertEqual(len(self.read(FakeRequest(chunks=10, size=self.MB))), MAP_UPLOAD_MAX)

    def test_declared_length_over_the_limit_is_refused_unread(self):
        request = FakeRequest(chunks=3, size=10, headers={"content-length": str(MAP_UPLOAD_MAX + 1)})
        with self.assertRaises(ApiError):
            self.read(request)
        self.assertEqual(request.sent, 0)

    def test_declared_length_that_is_not_a_number_is_ignored(self):
        self.assertEqual(len(self.read(FakeRequest(chunks=2, size=5, headers={"content-length": "²"}))), 10)


class MapsApiTest(ApiTestBase):
    def post(self, name, body, content_type="image/png"):
        headers = {} if content_type is None else {"content-type": content_type}
        return self.client.post("/api/maps", params=None if name is None else {"name": name}, content=body, headers=headers)

    def test_get_maps(self):
        body = self.client.get("/api/maps").json()
        self.assertEqual(list(body), ["maps", "default"])
        self.assertEqual(body["default"], "nasa-bmng-07_1024.jpg")
        self.assertEqual([m["file"] for m in body["maps"]], list(REF_D_STOCK))
        self.assertTrue(all(list(m) == ENTRY_KEYS and m["stock"] for m in body["maps"]))
        self.assertEqual(body["maps"][7], {"file": "nasa-bmng-07_1024.jpg", "stock": True, "width": 1024, "height": 512,
                                           "bytes": 94680})

    def test_upload_and_serve(self):
        data = png_bytes(8, 4)
        r = self.post("mine.png", data)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"file": "mine.png", "stock": False, "width": 8, "height": 4, "bytes": len(data)})
        self.assertEqual(self.client.get("/api/maps").json()["maps"][-1], r.json())
        got = self.client.get("/api/maps/mine.png")
        self.assertEqual((got.status_code, got.content, got.headers["content-type"]), (200, data, "image/png"))
        self.assertEqual(got.headers["x-content-type-options"], "nosniff")
        self.assertEqual((self.cfg.data_dir / "maps" / "mine.png").read_bytes(), data)         # เก็บที่ data/maps/
        stock = self.client.get("/api/maps/nasa-bmng-07_1024.jpg")
        self.assertEqual((stock.status_code, stock.headers["content-type"]), (200, "image/jpeg"))
        self.assertEqual(stock.content, (maps.STOCK_DIR / "nasa-bmng-07_1024.jpg").read_bytes())
        jpg = jpeg_bytes(40, 20)
        self.assertEqual(self.post("pic.jpeg", jpg, "image/jpeg").status_code, 200)
        self.assertEqual(self.client.get("/api/maps/pic.jpeg").headers["content-type"], "image/jpeg")

    def test_upload_rejects(self):
        png = png_bytes()
        cases = [("../x.png", "image/png", png, "name"), ("x.gif", "image/gif", png, "name"),
                 ("earth_800.png", "image/png", png, "name"), ("x.png", "image/jpeg", png, "Content-Type"),
                 ("x.png", None, png, "Content-Type"), ("x.png", "image/png", jpeg_bytes(), "body"),
                 ("x.png", "image/png", b"", "body"), (None, "image/png", png, "name"), ("", "image/png", png, "name")]
        for name, content_type, body, obj in cases:
            with self.subTest(name=name, content_type=content_type):
                self.assert_error(self.post(name, body, content_type), 422, "MAP_INVALID", obj)
        self.assertFalse((self.cfg.data_dir / "maps").exists())

    def test_uploaded_map_is_revalidated_so_a_replaced_one_does_not_show_stale(self):
        """ภาพที่อัปโหลดชื่อเดิมซ้ำแทนภาพเดิม: Cache-Control: no-cache ให้ browser ถามใหม่ทุกครั้ง (ไม่ใช้ภาพเก่าจาก cache เป็นชั่วโมง)
        ภาพของ Gpredict ไม่เคยเปลี่ยน จึงไม่ต้อง"""
        self.assertEqual(self.post("my.png", png_bytes()).status_code, 200)
        r = self.client.get("/api/maps/my.png")
        self.assertEqual((r.status_code, r.headers.get("cache-control")), (200, "no-cache"))
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        stock = self.client.get(f"/api/maps/{DEFAULT_MAP}")
        self.assertEqual(stock.status_code, 200)
        self.assertIsNone(stock.headers.get("cache-control"))

    def test_upload_too_big(self):
        big = padded(png_bytes(), MAP_UPLOAD_MAX + 1)
        self.assert_error(self.post("big.png", big), 422, "MAP_INVALID", "body")
        self.assertFalse((self.cfg.data_dir / "maps" / "big.png").exists())
        ok = padded(png_bytes(), MAP_UPLOAD_MAX)
        self.assertEqual(self.post("edge.png", ok).status_code, 200)
        self.assertEqual((self.cfg.data_dir / "maps" / "edge.png").stat().st_size, MAP_UPLOAD_MAX)

    def test_missing_map_404(self):
        self.assert_error(self.client.get("/api/maps/nope.png"), 404, "NOT_FOUND", "nope.png")
        self.assert_error(self.client.get("/api/maps/nope"), 404, "NOT_FOUND", "nope")
        self.assertEqual(self.client.get("/api/maps/..%2F..%2Fetc%2Fpasswd").status_code, 404)
        self.assertEqual(self.client.get("/api/maps/%2E%2E%2Fmaps.py").status_code, 404)
        self.assert_error(self.client.get("/api/maps/SOURCE.md"), 404, "NOT_FOUND", "SOURCE.md")      # ไม่ใช่ภาพ
        (self.cfg.data_dir / "maps").mkdir(parents=True)
        (self.cfg.data_dir / "maps" / "secret.txt").write_text("x", encoding="utf-8")
        self.assert_error(self.client.get("/api/maps/secret.txt"), 404, "NOT_FOUND", "secret.txt")

    def test_foreign_origin_cannot_upload(self):
        r = self.client.post("/api/maps", params={"name": "evil.png"}, content=png_bytes(),
                             headers={"content-type": "image/png", "origin": "http://evil.example"})
        self.assert_error(r, 403, "FORBIDDEN_ORIGIN", None)
        self.assertFalse((self.cfg.data_dir / "maps").exists())


if __name__ == "__main__":
    unittest.main()
