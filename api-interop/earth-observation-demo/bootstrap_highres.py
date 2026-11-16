"""Prepare the four public optical examples, using bounded source windows."""

import argparse
from eo_engine.samples import catalog, prepare

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample", choices=[r["id"] for r in catalog()])
    args = parser.parse_args()
    for row in catalog():
        if not args.sample or row["id"] == args.sample:
            prepare(row["id"], lambda message: print(message, flush=True))
