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


def main():
    if not os.path.exists(CATALOG_PATH):
        print(f"ERROR: {CATALOG_PATH} not found", file=sys.stderr)
        sys.exit(1)
    with open(CATALOG_PATH, "r", encoding="utf-8") as fh:
        cat = json.load(fh)

    errors = []
    seen_ids = set()
    seen_blocks = {}

    for entry in cat.get("models", []):
        mid = entry["id"]
        if mid in seen_ids:
            errors.append(f"Duplicate model id: {mid}")
        seen_ids.add(mid)

        for blk in entry.get("blocks", []):
            if blk in seen_blocks:
                errors.append(f"Block {blk!r} listed in both {seen_blocks[blk]!r} and {mid!r}")
            seen_blocks[blk] = mid

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
          f"{len(seen_blocks)} blocks mapped to models, {len(fallback_blocks)} blocks mapped to fallback ({cat.get('fallback')!r}).")

    if errors:
        for e in errors:
            print("ERROR:", e, file=sys.stderr)
        sys.exit(1)
    print("CATALOG_STATUS PASS")


if __name__ == "__main__":
    main()

