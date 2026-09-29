#!/usr/bin/env python3
"""Apply research/enrich-*.json (history, curiosities, legs, day context) to data/.

Unlike merge_research.py this edits data/places.json and data/days.json in place: it only
sets the enrichment fields and leaves everything else as hand-edited.

Usage: python3 scripts/merge_enrich.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from merge_research import bulletize  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main():
    places = json.loads((DATA / "places.json").read_text())
    days = json.loads((DATA / "days.json").read_text())
    by_id = {p["id"]: p for p in places}
    by_date = {d["date"]: d for d in days}
    counts = {"places": 0, "blocks": 0, "sights": 0, "days": 0}
    for path in sorted((ROOT / "research").glob("enrich-*.json")):
        data = json.loads(path.read_text())
        for pid, extra in data.get("places", {}).items():
            if pid not in by_id:
                print(f"  {path.name}: unknown place {pid}")
                continue
            for k in ("history", "curiosities"):
                if extra.get(k):
                    by_id[pid][k] = extra[k]
            counts["places"] += 1
        for key, extra in data.get("blocks", {}).items():
            date, _, idx = key.partition("#")
            day = by_date.get(date)
            if not day or not idx.isdigit() or int(idx) >= len(day["blocks"]):
                print(f"  {path.name}: bad block key {key}")
                continue
            b = day["blocks"][int(idx)]
            if extra.get("note"):
                b["note"] = bulletize(extra["note"])
            fp = extra.get("from_prev")
            if fp:
                fp["detail"] = bulletize(fp.get("detail"))
                b["from_prev"] = {**(b.get("from_prev") or {}), **fp}
                counts["sights"] += len(fp.get("sights") or [])
            counts["blocks"] += 1
        for date, extra in data.get("days", {}).items():
            if date in by_date:
                by_date[date].update({k: v for k, v in extra.items() if k in ("context", "km_walk")})
                counts["days"] += 1
    for d in days:
        for b in d["blocks"]:
            b.pop("_rewrite", None)
    (DATA / "places.json").write_text(json.dumps(places, ensure_ascii=False, indent=1))
    (DATA / "days.json").write_text(json.dumps(days, ensure_ascii=False, indent=1))
    print("ok  " + ", ".join(f"{v} {k}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
