#!/usr/bin/env python3
"""Download Wikimedia Commons photos listed in data/places.json and data/meta.json.

For each place, `commons_files` lists exact Commons titles ("File:..."). Each file is
fetched as a 1600 px thumbnail, converted to webp at 1200 px and 480 px with ImageMagick,
and its author, license and source page go to data/photos.json.

Usage:
  python3 scripts/fetch_photos.py            download what is missing
  python3 scripts/fetch_photos.py --suggest  print Commons candidates for places with no files
"""

import html
import json
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMG = ROOT / "assets" / "img"
API = "https://commons.wikimedia.org/w/api.php"
UA = "nueva-york-2026/1.0 (https://github.com/mpodeley/nueva-york-2026)"
MAX_PER_PLACE = 3


def api(params):
    params = {**params, "format": "json", "formatversion": "2"}
    req = urllib.request.Request(f"{API}?{urllib.parse.urlencode(params)}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def strip_html(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    return html.unescape(s).strip()


def imageinfo(titles):
    out = {}
    for i in range(0, len(titles), 40):
        batch = titles[i:i + 40]
        data = api({"action": "query", "titles": "|".join(batch), "prop": "imageinfo",
                    "iiprop": "url|extmetadata|size|mime", "iiurlwidth": "1600"})
        norm = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
        pages = {p["title"]: p for p in data["query"]["pages"]}
        for t in batch:
            page = pages.get(norm.get(t, t))
            if not page or "imageinfo" not in page:
                print(f"  missing on Commons: {t}")
                continue
            out[t] = page["imageinfo"][0]
    return out


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                dest.write_bytes(r.read())
            return
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise


def convert(src, dest, width, quality):
    subprocess.run(["magick", str(src), "-auto-orient", "-resize", f"{width}x>", "-strip",
                    "-quality", str(quality), str(dest)], check=True)


def fetch(pid, titles, photos):
    have = {p["title"] for p in photos.get(pid, [])}
    todo = [t for t in titles[:MAX_PER_PLACE] if t not in have]
    if not todo:
        return
    info = imageinfo(todo)
    folder = IMG / pid
    folder.mkdir(parents=True, exist_ok=True)
    entries = [p for p in photos.get(pid, []) if p["title"] in titles]
    for t in todo:
        ii = info.get(t)
        if not ii or not ii.get("mime", "").startswith("image/"):
            continue
        n = 1 + max((int(Path(e["src"]).stem) for e in entries), default=0)
        raw = folder / f"_raw{n}"
        try:
            download(ii.get("thumburl") or ii["url"], raw)
            big, small = folder / f"{n}.webp", folder / f"{n}-480.webp"
            convert(raw, big, 1200, 78)
            convert(raw, small, 480, 70)
        except Exception as e:  # keep going with the rest
            print(f"  failed {pid} {t}: {e}")
            continue
        finally:
            raw.unlink(missing_ok=True)
        meta = ii.get("extmetadata", {})
        entries.append({
            "title": t,
            "src": str(big.relative_to(ROOT)),
            "thumb": str(small.relative_to(ROOT)),
            "author": strip_html(meta.get("Artist", {}).get("value"))[:80],
            "license": strip_html(meta.get("LicenseShortName", {}).get("value")),
            "source": ii.get("descriptionurl"),
        })
        print(f"  {pid}: {t}")
        time.sleep(0.5)
    photos[pid] = entries


def suggest(places, photos):
    for p in places:
        if p.get("commons_files") or photos.get(p["id"]):
            continue
        data = api({"action": "query", "list": "search", "srsearch": f"{p['name']} New York",
                    "srnamespace": "6", "srlimit": "6"})
        hits = [h["title"] for h in data["query"]["search"]]
        print(f"{p['id']}: {hits}")


def main():
    places = json.loads((DATA / "places.json").read_text())
    meta_path = DATA / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    photos_path = DATA / "photos.json"
    photos = json.loads(photos_path.read_text()) if photos_path.exists() else {}
    if "--suggest" in sys.argv:
        suggest(places, photos)
        return
    jobs = [(p["id"], p.get("commons_files") or []) for p in places]
    if meta.get("hero_file"):
        jobs.append(("_hero", [meta["hero_file"]]))
    for pid, titles in jobs:
        if titles:
            fetch(pid, titles, photos)
        elif pid in photos:
            del photos[pid]
    photos_path.write_text(json.dumps(photos, ensure_ascii=False, indent=1))
    # Drop image files no longer referenced (rejected or replaced photos).
    keep = {e[k] for v in photos.values() for e in v for k in ("src", "thumb")}
    for img in IMG.glob("*/*.webp"):
        if str(img.relative_to(ROOT)) not in keep:
            img.unlink()
    for d in IMG.iterdir():
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    total = sum(len(v) for v in photos.values())
    print(f"ok  {total} photos for {len(photos)} places")


if __name__ == "__main__":
    main()
