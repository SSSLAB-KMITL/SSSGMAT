"""เขียน OpenAPI ของ server พร้อม schema เต็มของ scenario.json ลงไฟล์ JSON (เรียงคีย์ เขียนซ้ำแล้วได้ไฟล์เดิมตรงตัว)

ใช้โดย `npm run gen:api` ของ web/: python -I tools/dump_openapi.py <out.json>

route ของ server รับ scenario เป็น dict จึงไม่มี `ScenarioDoc` ใน openapi เอง: เอา `ScenarioDoc.model_json_schema()` (รวม `$defs`
ของ model ย่อย) ใส่ใน `components.schemas` เพื่อให้ openapi-typescript สร้าง type ของ scenario.json ครบ ชื่อที่ซ้ำกับ model ที่ route
ใช้ (AccessGraphics, AccessTimePeriod) ใช้ฉบับของ `ScenarioDoc` เพราะเป็นตัวอธิบายเอกสารที่เก็บลงดิสก์

ไม่ทำอะไรกับ GMAT, เครือข่าย หรือโฟลเดอร์ data จริง: app สร้างด้วย start_background=False ในโฟลเดอร์ชั่วคราวที่ลบทิ้งตอนจบ
"""

import json
import sys
import tempfile
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]               # api-interop/gnss-predict/server
sys.path.insert(0, str(SERVER_DIR.parent))                     # gnss_predict (python -I ไม่ใส่โฟลเดอร์ของสคริปต์ใน sys.path)
sys.path.insert(0, str(SERVER_DIR))                            # gnss_studio_server

from gnss_studio_server.app import create_app                  # noqa: E402
from gnss_studio_server.config import Config                   # noqa: E402
from gnss_studio_server.schema import ScenarioDoc             # noqa: E402

REF_TEMPLATE = "#/components/schemas/{model}"


def build_openapi() -> dict:
    with tempfile.TemporaryDirectory(prefix="gnss-studio-openapi-") as tmp:
        app = create_app(Config(data_dir=Path(tmp)), start_background=False)
        try:
            doc = app.openapi()
        finally:
            app.state.log_handler.close()                       # ไฟล์ log อยู่ในโฟลเดอร์ชั่วคราวที่กำลังจะลบ
    scenario = ScenarioDoc.model_json_schema(ref_template=REF_TEMPLATE)
    defs = scenario.pop("$defs")
    schemas = doc.setdefault("components", {}).setdefault("schemas", {})
    schemas.update(defs)
    schemas["ScenarioDoc"] = scenario
    return doc


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: dump_openapi.py <out.json>", file=sys.stderr)
        return 2
    out = Path(argv[1])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
