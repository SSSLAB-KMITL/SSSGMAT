"""One isolated, cancellable analysis job."""

import json
import sys
import traceback
from .catalog import save_json, DATA


def main():
    job_id = sys.argv[1]
    path = DATA / "jobs" / f"{job_id}.json"
    job = json.loads(path.read_text())

    def progress(message, percent):
        print(json.dumps(dict(message=message, progress=percent)), flush=True)

    try:
        from .pipeline import prepare, detect, compare

        if job["kind"] == "prepare":
            result = prepare(job["scene_id"], **job["parameters"], progress=progress)
        elif job["kind"] == "detect":
            result = detect(job["scene_id"], **job["parameters"], progress=progress)
        elif job["kind"] == "compare":
            result = compare(job["scene_id"], **job["parameters"], progress=progress)
        elif job["kind"] == "geometry":
            from .geometry import extract_geometry

            result = extract_geometry(job["scene_id"])
        elif job["kind"] == "sequence":
            from .sequence import sequence

            result = sequence(job["scene_id"], **job["parameters"], progress=progress)
        elif job["kind"] in ("csi", "optical"):
            from .color import prepare_csi, prepare_optical

            operation = prepare_csi if job["kind"] == "csi" else prepare_optical
            result = operation(job["scene_id"], progress=progress)
        else:
            raise ValueError("Unsupported job")
        save_json(DATA / "jobs" / f"{job_id}.result.json", result)
        progress("Complete", 100)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps(dict(error=str(exc))), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
