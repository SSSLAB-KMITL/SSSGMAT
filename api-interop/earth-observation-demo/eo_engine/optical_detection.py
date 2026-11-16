"""Aerial object detection on the exact RGB crop displayed by the web app.

Only the isolated detector worker imports torch/Ultralytics. The API uses the
lightweight cache/validation functions below, without importing ML libraries.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from .catalog import ROOT, DATA, save_json

VIEWS = ("area", "detail", "close")
VERSION = 2
MIN_SCORE = 0.10
CLASS_LABELS = {
    "plane": "เครื่องบิน", "ship": "เรือ", "storage tank": "ถังเก็บ",
    "baseball diamond": "สนามเบสบอล", "tennis court": "สนามเทนนิส",
    "basketball court": "สนามบาสเกตบอล", "ground track field": "สนามกรีฑา",
    "harbor": "บริเวณท่าเรือ", "bridge": "สะพาน", "large vehicle": "รถขนาดใหญ่",
    "small vehicle": "รถขนาดเล็ก", "helicopter": "เฮลิคอปเตอร์",
    "roundabout": "วงเวียน", "soccer ball field": "สนามฟุตบอล",
    "swimming pool": "สระว่ายน้ำ",
}


def inputs(sample_id, view):
    if view not in VIEWS:
        raise ValueError("Unknown image view")
    rows = json.loads((ROOT / "research/highres-samples.json").read_text())["samples"]
    row = next((r for r in rows if r["id"] == sample_id), None)
    if row is None:
        raise ValueError("Unknown high-resolution image")
    folder = DATA / "highres-samples" / sample_id
    product_path = folder / "product.json"
    image_path = folder / f"{view}.png"
    if not product_path.is_file() or not image_path.is_file():
        raise FileNotFoundError("Prepare the RGB imagery before detection")
    product = json.loads(product_path.read_text())
    source_signature = hashlib.sha256(json.dumps({"source": row, "render_version": 1}, sort_keys=True).encode()).hexdigest()
    if product.get("source_signature") != source_signature:
        raise FileNotFoundError("RGB crop is out of date; prepare the imagery again")
    return row, product, image_path


def model_info():
    path = DATA / "models/yolo11s-obb.json"
    if not path.is_file():
        raise FileNotFoundError("Detection model is not installed; run bootstrap_detector.py")
    return json.loads(path.read_text())


def signature(image_path, model):
    return hashlib.sha256(json.dumps({
        "image_sha256": hashlib.sha256(image_path.read_bytes()).hexdigest(),
        "model_sha256": model["sha256"], "version": VERSION,
        "min_score": MIN_SCORE, "tile_size": 1024, "overlap": 256,
        "edge_policy": "exclude_source_boundary_truncation", "nested_overlap": 0.7,
    }, sort_keys=True).encode()).hexdigest()


def cached(sample_id, view):
    row, product, image_path = inputs(sample_id, view)
    path = image_path.with_name(f"detections-{view}.json")
    if not path.exists():
        return None
    result = json.loads(path.read_text())
    try:
        valid = result.get("input_signature") == signature(image_path, model_info())
    except FileNotFoundError:
        return None
    return result if valid else None


def tile_starts(length, size=1024, overlap=256):
    if length <= size:
        return [0]
    return sorted(set([*range(0, length - size + 1, size - overlap), length - size]))


def detect(sample_id, view, progress=lambda *_: None):
    row, product, image_path = inputs(sample_id, view)
    meta = model_info()
    weights = DATA / "models" / meta["weights"]
    if hashlib.sha256(weights.read_bytes()).hexdigest() != meta["sha256"]:
        raise ValueError("Detector weight checksum mismatch")
    previous = cached(sample_id, view)
    if previous:
        progress("Using cached detection for this image", 95)
        return previous
    # Import ML only for actual inference, in the isolated worker environment.
    import cv2
    import numpy as np
    from PIL import Image
    from pyproj import Transformer
    import ultralytics
    from ultralytics import YOLO, settings

    settings.update({"sync": False})
    progress("Loading YOLO11s-OBB aerial detector", 10)
    model = YOLO(str(weights), task="obb")
    with Image.open(image_path) as img:
        rgba = np.asarray(img.convert("RGBA"))
    height, width = rgba.shape[:2]
    if max(width, height) > 2048:
        raise ValueError("Detection crop exceeds supported size")
    tiles = [(x, y) for y in tile_starts(height) for x in tile_starts(width)]
    found = []
    excluded_boundary = 0
    for i, (x, y) in enumerate(tiles):
        tile = np.ascontiguousarray(rgba[y:y+1024, x:x+1024, :3][:, :, ::-1])
        result = model.predict(source=tile, imgsz=1024, conf=MIN_SCORE,
                               iou=0.4, max_det=300, device="cpu", verbose=False)[0]
        if result.obb is not None:
            for polygon, score, cls, xywhr in zip(result.obb.xyxyxyxy.cpu().numpy(),
                                                 result.obb.conf.cpu().numpy(),
                                                 result.obb.cls.cpu().numpy(),
                                                 result.obb.xywhr.cpu().numpy()):
                polygon += [x, y]
                if (polygon[:, 0].min() <= 0 or polygon[:, 1].min() <= 0
                        or polygon[:, 0].max() >= width-1 or polygon[:, 1].max() >= height-1):
                    excluded_boundary += 1
                    continue
                center = polygon.mean(axis=0)
                cx, cy = float(center[0]), float(center[1])
                if not (0 <= cx < width and 0 <= cy < height):
                    continue
                if rgba[int(cy), int(cx), 3] == 0:
                    continue
                name = result.names[int(cls)].replace("-", " ")
                found.append({"class_name": name, "label": CLASS_LABELS.get(name, name),
                              "score": float(score), "polygon_px": polygon.tolist(),
                              "center_px": [cx, cy],
                              "rotated_box": ((cx, cy), (float(xywhr[2]), float(xywhr[3])), float(np.degrees(xywhr[4])))})
        progress(f"Detecting aerial objects · tile {i+1}/{len(tiles)}", 15 + int(65*(i+1)/len(tiles)))
    # Merge overlapping tile predictions per category using rotated-box IoU.
    keep = []
    for name in sorted({f["class_name"] for f in found}):
        group = [f for f in found if f["class_name"] == name]
        indices = cv2.dnn.NMSBoxesRotated([f["rotated_box"] for f in group],
                                         [f["score"] for f in group], MIN_SCORE, 0.3)
        accepted = []
        for index in sorted(np.asarray(indices).reshape(-1), key=lambda i: -group[int(i)]["score"]):
            item = group[int(index)]
            nested = False
            for other in accepted:
                _, intersection = cv2.rotatedRectangleIntersection(item["rotated_box"], other["rotated_box"])
                if intersection is not None:
                    area = abs(cv2.contourArea(intersection))
                    smaller = min(a["rotated_box"][1][0]*a["rotated_box"][1][1] for a in (item, other))
                    if smaller > 0 and area / smaller > 0.7:
                        nested = True
                        break
            if not nested:
                accepted.append(item)
        keep.extend(accepted)
    keep.sort(key=lambda f: -f["score"])
    grid = product["views"][view]
    project = Transformer.from_crs(4326, grid["crs"], always_xy=True)
    unproject = Transformer.from_crs(grid["crs"], 4326, always_xy=True)
    x0, y0 = project.transform(row["lon"], row["lat"])
    for i, item in enumerate(keep):
        item.pop("rotated_box")
        item["id"] = i + 1
        cx, cy = item["center_px"]
        lon, lat = unproject.transform(x0 + (cx/width-.5)*grid["width_m"],
                                     y0 + (.5-cy/height)*grid["width_m"])
        item["ground_point"] = {"lon": lon, "lat": lat}
        item["review"] = "unreviewed"
    result = {"sample_id": sample_id, "view": view,
              "input_signature": signature(image_path, meta),
              "generated_utc": datetime.now(timezone.utc).isoformat(),
              "model": {**meta, "ultralytics_version": ultralytics.__version__},
              "image": {"url": grid["url"], "width": width, "height": height,
                        "width_m": grid["width_m"], "acquired_utc": row["acquired_utc"]},
              "min_score": MIN_SCORE, "count": len(keep),
              "excluded_boundary_predictions": excluded_boundary,
              "counts": dict(Counter(f["class_name"] for f in keep)),
              "supported_classes": [{"name": k, "label": v} for k, v in CLASS_LABELS.items()],
              "objects": keep,
              "note": "ผลคาดการณ์จากโมเดล 15 ประเภท ยังไม่ผ่านการตรวจยืนยัน · ไม่ครอบคลุมอาคารหรือถนนทุกชนิด · คะแนนโมเดลไม่ใช่ค่าความแม่นยำที่ทดสอบในพื้นที่นี้",
              "coordinate_basis": "Center on the displayed RGB crop's projected grid; not a surveyed object location"}
    save_json(image_path.with_name(f"detections-{view}.json"), result)
    progress(f"Detected {len(keep)} candidate objects", 95)
    return result
