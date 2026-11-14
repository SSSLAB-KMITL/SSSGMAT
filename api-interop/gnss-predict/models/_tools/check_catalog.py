"""Check models/catalog.json against disk .glb files and IGS satellite metadata block strings.

Run with:
  python3 -I models/_tools/check_catalog.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.dirname(HERE)
CATALOG_PATH = os.path.join(MODELS_DIR, "catalog.json")
DEFAULT_SNX = "/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data/orbits/20261110T2147Z/igs_satellite_metadata.snx"

BRIEF_BLOCKS = {
    "GPS-IIR-A", "GPS-IIR-B", "GPS-IIR-M", "GPS-IIF", "GPS-IIIA", "GPS-III", "GPS-III-1",
    "GLO-M", "GLO-M+", "GLO-K1", "GLO-K1+", "GLO-K1A", "GLO-K1B", "GLO-K2",
    "GAL-1", "GAL-2", "GAL-0A", "GAL-0B",
    "BDS-2I", "BDS-2G", "BDS-2M",
    "BDS-3M-CAST", "BDS-3M-SECM-A", "BDS-3M-SECM-B", "BDS-3G", "BDS-3I",
    "BDS-3SM-CAST", "BDS-3SI-CAST", "BDS-3SM-SECM", "BDS-3SI-SECM", "BDS-3S",
}
VALID_CELL_NORMALS = ("+X", "-X", "+Y", "-Y", "+Z", "-Z")
VALID_CONFIDENCES = ("high", "medium", "low")


def read_snx_blocks(path):
    blocks = set()
    if not os.path.exists(path):
        return blocks
    in_id = False
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if line.startswith("+SATELLITE/IDENTIFIER"):
                in_id = True
                continue
            if line.startswith("-SATELLITE/IDENTIFIER"):
                in_id = False
                continue
            if in_id and not line.startswith("*"):
                parts = line.split()
                if len(parts) >= 4:
                    blocks.add(parts[3])
    return blocks


def _reject_dup_keys(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError(f"Duplicate JSON object key: {k!r}")
        out[k] = v
    return out


def main():
    if not os.path.exists(CATALOG_PATH):
        print(f"ERROR: {CATALOG_PATH} not found", file=sys.stderr)
        sys.exit(1)
    try:
        with open(CATALOG_PATH, "r", encoding="utf-8") as fh:
            cat = json.load(fh, object_pairs_hook=_reject_dup_keys)
    except ValueError as exc:
        print(f"ERROR: invalid catalog JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    errors = []
    seen_ids = set()
    seen_blocks = {}
    seen_norads = {}

    for entry in cat.get("models", []):
        mid = entry["id"]
        if mid in seen_ids:
            errors.append(f"Duplicate model id: {mid}")
        seen_ids.add(mid)

        for blk in entry.get("blocks", []):
            if blk in seen_blocks:
                errors.append(f"Block {blk!r} listed in both {seen_blocks[blk]!r} and {mid!r}")
            seen_blocks[blk] = mid

        for nid in entry.get("norad_ids", []):
            if isinstance(nid, bool) or not isinstance(nid, int) or nid <= 0:
                errors.append(f"Invalid NORAD ID {nid!r} in model {mid!r} (expected positive int)")
                continue
            if nid in seen_norads:
                errors.append(f"NORAD ID {nid} listed in both {seen_norads[nid]!r} and {mid!r}")
            seen_norads[nid] = mid

        cell_normal = entry.get("cell_normal")
        if cell_normal not in VALID_CELL_NORMALS:
            errors.append(
                f"Model {mid!r} missing or invalid 'cell_normal' {cell_normal!r} "
                f"(expected one of {VALID_CELL_NORMALS})"
            )

        confidence = entry.get("confidence")
        if confidence is not None and confidence not in VALID_CONFIDENCES:
            errors.append(
                f"Model {mid!r} invalid 'confidence' {confidence!r} "
                f"(expected one of {VALID_CONFIDENCES})"
            )

        status = entry.get("status", "pending")
        glb_rel = entry.get("glb", "")
        glb_abs = os.path.join(MODELS_DIR, glb_rel)
        if status == "done":
            if not os.path.isfile(glb_abs):
                errors.append(f"Model {mid!r} has status 'done' but missing glb: {glb_rel}")
            else:
                sz = os.path.getsize(glb_abs)
                if sz > int(1.5 * 1048576):
                    errors.append(f"Model {mid!r} glb {glb_rel} exceeds 1.5 MB ({sz} bytes)")

    overrides = cat.get("overrides", {})
    if not isinstance(overrides, dict):
        errors.append(f"Top-level 'overrides' must be an object, got {type(overrides).__name__}")
        overrides = {}
    else:
        for cospar, target_mid in overrides.items():
            if not isinstance(cospar, str) or not cospar.strip():
                errors.append(f"Invalid override COSPAR key: {cospar!r}")
            if target_mid not in seen_ids:
                errors.append(f"Override {cospar!r} points to unknown model id {target_mid!r}")

    fallback_blocks = set(cat.get("fallback_blocks", []))
    for blk in fallback_blocks:
        if blk in seen_blocks:
            errors.append(f"Block {blk!r} is in both model {seen_blocks[blk]!r} and fallback_blocks")

    all_required = BRIEF_BLOCKS | read_snx_blocks(DEFAULT_SNX)
    unaccounted = sorted(all_required - set(seen_blocks) - fallback_blocks)
    if unaccounted:
        errors.append(f"Blocks neither mapped to a model nor listed in fallback_blocks: {unaccounted}")

    done_count = sum(1 for m in cat.get("models", []) if m.get("status") == "done")
    total_count = len(cat.get("models", []))
    print(f"Catalog check: {done_count}/{total_count} models done, "
          f"{len(seen_blocks)} blocks mapped to models, {len(seen_norads)} NORAD IDs mapped, "
          f"{len(overrides)} COSPAR overrides, {len(fallback_blocks)} blocks mapped to fallback ({cat.get('fallback')!r}).")

    if errors:
        for e in errors:
            print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
    print("CATALOG_STATUS PASS")


if __name__ == "__main__":
    main()

