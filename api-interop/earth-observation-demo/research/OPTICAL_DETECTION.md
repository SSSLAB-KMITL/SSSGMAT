# Optical object detection

The high-resolution imagery page runs actual YOLO11s-OBB inference on the exact
500 m, 250 m or 100 m RGB crop displayed in the viewer. No model output is
generated from text, manually invented, or reused from the Umbra SAR detector.

Model: [Ultralytics YOLO11 oriented detection](https://docs.ultralytics.com/models/yolo11/),
pretrained on DOTAv1.0 with 15 classes. Official weights and SHA256 are pinned in
`optical-detector-model.json`. Model software/weights use AGPL-3.0; provenance
and licence URLs accompany every result. The source DOTA imagery/annotations
have academic-use terms; see [DOTA](https://captain-whu.github.io/DOTA/dataset.html).

Install with an isolated Python 3.12 environment, keeping torch and OpenCV out
of the image-processing/API environment:

```sh
uv venv --python python3.12 .venv-detection
uv pip install --python .venv-detection/bin/python -r requirements-detection.lock
.venv/bin/python bootstrap_detector.py
```

The existing cancellable queue launches `optical_worker_entry.py` through
`os.posix_spawn`, using the separate interpreter and process group. The model
executes locally on CPU. The app sends no imagery to an inference service and
does not download models when the user clicks detection. Ultralytics settings
are stored under local `data/model-config`, with sync disabled.

Inference preserves the PNG RGB/BGR channel convention, uses 1024 px tiles with
overlap, and merges same-class predictions using rotated NMS and containment
suppression. Predictions crossing the original crop boundary are excluded
because truncated objects/edge artifacts are unreliable. Geographic centers
come from the crop's original projected grid, not the satellite orbit.

Each result records the image hash, model hash, pipeline version, crop/view,
model package version, acquisition time and inference timestamp. Cache reuse
requires the same image, weights and processing parameters. The UI cannot draw
previous-image results while a new crop is loading. JSON contains predictions
with score >=0.10; the UI defaults to 0.25 and can filter categories or scores.
The model score is not a calibrated accuracy estimate for these four scenes.

The detector covers planes, ships, storage tanks, baseball diamonds, tennis and
basketball courts, running tracks, harbors, bridges, large/small vehicles,
helicopters, roundabouts, football fields and swimming pools. It does not
identify arbitrary objects, generic buildings or all roads. An empty result
does not establish absence. Outputs are unreviewed model predictions, and the
counts exclude crop-boundary objects; do not treat them as ground truth.

Read cache/status: `GET /api/eo/samples/{id}/detections?view=detail`.
Run: `POST /api/eo/samples/{id}/detect` with `{"view":"detail"}`.
The returned job supports existing status and cancel routes. PNG exports remain
the original display imagery; JSON exports retain polygons, scores, object
ground coordinates and provenance for overlays.
