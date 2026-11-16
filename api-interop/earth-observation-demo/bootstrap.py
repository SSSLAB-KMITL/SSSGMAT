"""Prepare historical scenes now; --all prepares every catalog acquisition."""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from eo_engine.catalog import scenes, DATA, save_json
from eo_engine.pipeline import prepare, detect


def choose(rows, per_site):
    selected = []
    for sid in ("suvarnabhumi", "rotterdam", "singapore"):
        rr = [r for r in rows if r["site_id"] == sid]
        pairs = []
        for i, a in enumerate(rr):
            for b in rr[i + 1 :]:
                if a["polarization"] != b["polarization"]:
                    continue
                az = abs(a["view_azimuth_deg_raw"] - b["view_azimuth_deg_raw"])
                az = min(az, 360 - az)
                inc = abs(a["incidence_deg"] - b["incidence_deg"])
                if (
                    a["center_utc"][:10] != b["center_utc"][:10]
                    and az <= 2
                    and inc <= 1
                ):
                    pairs.append((az + inc, a, b))
        picks = [rr[0], rr[-1]]
        if pairs:
            _, a, b = min(pairs, key=lambda x: x[0])
            picks.extend([a, b])
        picks.extend(rr)
        unique = {r["id"]: r for r in picks}
        selected.extend(list(unique.values())[:per_site])
    return selected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--per-site", type=int, default=4)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    rows = scenes()
    selected = rows if args.all else choose(rows, max(1, args.per_site))
    print(
        f"Preparing {len(selected)} historical scenes; cached scenes are reused.",
        flush=True,
    )

    def one(row):
        try:
            if not row["ready"]:
                prepare(
                    row["id"],
                    width_m=250,
                    progress=lambda m, n: print(
                        row["site_id"], row["center_utc"][:10], n, m, flush=True
                    ),
                )
            result = detect(row["id"])
            return dict(
                id=row["id"],
                site=row["site_id"],
                state="completed",
                candidate_count=result["count"],
            )
        except Exception as e:
            return dict(id=row["id"], site=row["site_id"], state="failed", error=str(e))

    results = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as pool:
        for future in as_completed([pool.submit(one, row) for row in selected]):
            result = future.result()
            results.append(result)
            print(json.dumps(result), flush=True)
            save_json(
                DATA / "bootstrap-results.json",
                dict(requested=len(selected), completed=len(results), results=results),
            )
    if any(r["state"] == "failed" for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
