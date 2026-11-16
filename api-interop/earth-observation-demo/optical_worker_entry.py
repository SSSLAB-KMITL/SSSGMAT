"""Clean Python 3.12 process for optical ML; launched through posix_spawn."""
import json
import os
import sys
import traceback
from pathlib import Path

root = Path(__file__).resolve().parent
data = Path(os.environ.get("EO_DATA", str(root / "data")))
os.environ["YOLO_CONFIG_DIR"] = str(data / "model-config")
os.environ["YOLO_AUTOINSTALL"] = "false"
os.environ["YOLO_VERBOSE"] = "false"

from eo_engine.catalog import save_json
from eo_engine.optical_detection import detect

def progress(message, percent):
    print(json.dumps({"message": message, "progress": percent}), flush=True)

if __name__ == "__main__":
    job_id = sys.argv[1]
    job = json.loads((data / "jobs" / f"{job_id}.json").read_text())
    try:
        result = detect(job["scene_id"], job["parameters"]["view"], progress)
        save_json(data / "jobs" / f"{job_id}.result.json", result)
        progress("Complete", 100)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(exc)}), flush=True)
        sys.exit(1)
