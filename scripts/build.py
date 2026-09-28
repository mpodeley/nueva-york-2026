#!/usr/bin/env python3
"""Validate the editorial data and bundle it into data/trip.json.

Inputs (hand-edited):  data/places.json, data/days.json, data/marathon.json,
                       data/practical.json, data/findings.json, data/photos.json
Also reads:            the marathon course KML (see COURSE_KML)
Outputs:               data/trip.json, data/places.kml, sw.js (precache list + version)

Usage: python3 scripts/build.py [--draft]
Exits non-zero when validation fails.
"""

import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
COURSE_KML = Path.home() / "Projects/personal/maraton-viajes/maraton-ny-recorrido.kml"
COURSE_CACHE = DATA / "course.json"  # committed, so the build works without the KML

NS = {"k": "http://www.opengis.net/kml/2.2"}
NYC_BBOX = (40.45, 40.95, -74.30, -73.65)  # lat_min, lat_max, lng_min, lng_max
CATEGORIES = {"hotel", "comida", "bar", "museo", "paseo", "golf", "show", "mirador",
              "maraton", "transporte", "barrio"}
# Blocks at these categories are logistics: no Plan B required.
NO_ALT_CATEGORIES = {"hotel", "transporte", "maraton"}
REASONS = {"lluvia", "cerrado", "sin-entradas", "cansados", "otra-opción", "piernas"}
SEGMENT_COLORS = {
    "Staten Island": "#8c5bd1",
    "Brooklyn": "#ff8b2e",
    "Queens": "#3cb42f",
    "Manhattan (First Avenue)": "#1e6bd4",
    "Bronx": "#e63c3c",
    "Manhattan (Harlem y Central Park)": "#1e6bd4",
}

DRAFT = "--draft" in sys.argv  # skeleton mode: missing Plan B is a warning

errors: list[str] = []
warnings: list[str] = []


def load(name, default=None):
    path = DATA / name
    if not path.exists():
        if default is not None:
            return default
        errors.append(f"missing {path.relative_to(ROOT)}")
        return default
    return json.loads(path.read_text())


def parse_coords(text):
    pts = []
    for tok in text.split():
        lng, lat, *_ = tok.split(",")
        pts.append([round(float(lat), 6), round(float(lng), 6)])
    return pts


def course_from_kml():
    """Course segments, km markers and landmarks from the marathon KML."""
    if not COURSE_KML.exists():
        if COURSE_CACHE.exists():
            return json.loads(COURSE_CACHE.read_text())
        errors.append(f"course KML not found at {COURSE_KML} and no {COURSE_CACHE.name}")
        return None
    root = ET.parse(COURSE_KML).getroot()
    course = {"segments": [], "km": [], "landmarks": []}
    for folder in root.iter("{%s}Folder" % NS["k"]):
        fname = folder.findtext("k:name", namespaces=NS)
        for pm in folder.findall("k:Placemark", NS):
            name = pm.findtext("k:name", namespaces=NS)
            desc = pm.findtext("k:description", default="", namespaces=NS)
            if fname == "Recorrido por distrito":
                coords = parse_coords(pm.find(".//k:coordinates", NS).text)
                km_len = re.search(r"Longitud aproximada: ([\d,\.]+) km", desc)
                course["segments"].append({
                    "name": name,
                    "color": SEGMENT_COLORS.get(name, "#1e6bd4"),
                    "km": float(km_len.group(1).replace(",", ".")) if km_len else None,
                    "coords": coords,
                })
            elif fname == "Kilómetros":
                lat, lng = parse_coords(pm.find(".//k:coordinates", NS).text)[0]
                course["km"].append({"km": int(name), "lat": lat, "lng": lng})
            elif fname == "Hitos":
                lat, lng = parse_coords(pm.find(".//k:coordinates", NS).text)[0]
                m = re.match(r"km ([\d,]+) · (.*)", desc, re.S)
                km = float(m.group(1).replace(",", ".")) if m else None
                note = m.group(2).strip() if m else desc
                # The KML predates the English number convention: convert "42,195 km".
                note = re.sub(r"(\d),(\d)", r"\1.\2", note)
                course["landmarks"].append({"km": km, "name": name, "note": note,
                                            "lat": lat, "lng": lng})
    COURSE_CACHE.write_text(json.dumps(course, ensure_ascii=False))
    return course



def in_bbox(lat, lng):
    return NYC_BBOX[0] <= lat <= NYC_BBOX[1] and NYC_BBOX[2] <= lng <= NYC_BBOX[3]


def validate_places(places, photos):
    by_id = {}
    for p in places:
        pid = p.get("id")
        if not pid:
            errors.append(f"place without id: {p.get('name')}")
            continue
        if pid in by_id:
            errors.append(f"duplicate place id {pid}")
        by_id[pid] = p
        if p.get("category") not in CATEGORIES:
            errors.append(f"{pid}: bad category {p.get('category')!r}")
        lat, lng = p.get("lat"), p.get("lng")
        if lat is None or lng is None:
            errors.append(f"{pid}: missing coordinates")
        elif not in_bbox(lat, lng):
            errors.append(f"{pid}: coordinates {lat},{lng} outside NYC")
        if not photos.get(pid) and not p.get("photo_fallback"):
            warnings.append(f"{pid}: no photo (and no photo_fallback)")
        for r in (p.get("reviews") or {}).get("ratings", []):
            if not r.get("url") or not r.get("checked"):
                errors.append(f"{pid}: rating from {r.get('source')} lacks url or checked date")
        for q in (p.get("reviews") or {}).get("press", []):
            if not q.get("url"):
                errors.append(f"{pid}: press quote from {q.get('outlet')} lacks url")
            if len(q.get("quote", "").split()) > 30:
                warnings.append(f"{pid}: press quote from {q.get('outlet')} over 30 words")
    return by_id


def validate_days(days, by_id):
    used = set()
    for d in days:
        try:
            date.fromisoformat(d["date"])
        except (KeyError, ValueError):
            errors.append(f"day with bad date: {d.get('date')}")
        for i, b in enumerate(d.get("blocks", [])):
            where = f"{d.get('date')} block {i} ({b.get('title')})"
            pid = b.get("place")
            if pid not in by_id:
                errors.append(f"{where}: unknown place {pid!r}")
                continue
            used.add(pid)
            alts = b.get("alternatives", [])
            if not alts and by_id[pid]["category"] not in NO_ALT_CATEGORIES and not b.get("no_alt"):
                (warnings if DRAFT else errors).append(f"{where}: no Plan B")
            for a in alts:
                if a.get("place") not in by_id:
                    errors.append(f"{where}: unknown alternative {a.get('place')!r}")
                else:
                    used.add(a["place"])
                if a.get("reason") not in REASONS:
                    errors.append(f"{where}: bad alternative reason {a.get('reason')!r}")
        for r in d.get("reservations", []):
            if r.get("place") and r["place"] not in by_id:
                errors.append(f"{d['date']} reservation: unknown place {r['place']!r}")
    for pid in by_id:
        if pid not in used and not by_id[pid].get("standalone"):
            warnings.append(f"{pid}: not referenced by any day")


def build_kml(places, days):
    appears = {}
    for d in days:
        for b in d.get("blocks", []):
            appears.setdefault(b["place"], set()).add(d["date"])
    esc = lambda s: (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
           "<name>Nueva York 2026</name>"]
    for cat in sorted(CATEGORIES):
        members = [p for p in places if p.get("category") == cat]
        if not members:
            continue
        out.append(f"<Folder><name>{cat}</name>")
        for p in members:
            when = ", ".join(sorted(appears.get(p["id"], []))) or "alternativa"
            out.append(
                f"<Placemark><name>{esc(p['name'])}</name>"
                f"<description>{esc(p.get('neighborhood'))} · {when}</description>"
                f"<Point><coordinates>{p['lng']},{p['lat']},0</coordinates></Point></Placemark>")
        out.append("</Folder>")
    out.append("</Document></kml>")
    (DATA / "places.kml").write_text("\n".join(out))


def build_sw(trip_bytes):
    """Stamp sw.js with the precache list and a content hash."""
    shell = ["./", "index.html", "manifest.webmanifest", "assets/css/app.css",
             "assets/js/app.js", "assets/vendor/leaflet/leaflet.js",
             "assets/vendor/leaflet/leaflet.css", "data/trip.json", "assets/img/icon-192.png"]
    shell += sorted(f"assets/fonts/{f.name}" for f in (ROOT / "assets/fonts").glob("*.woff2"))
    thumbs = sorted(str(f.relative_to(ROOT)) for f in (ROOT / "assets/img").rglob("*-480.webp"))
    h = hashlib.sha256(trip_bytes)
    for rel in shell[2:] + thumbs:
        path = ROOT / rel
        if path.exists():
            h.update(path.read_bytes())
    version = h.hexdigest()[:10]
    template = (ROOT / "scripts/sw.template.js").read_text()
    sw = (template.replace("__VERSION__", version)
                  .replace("__SHELL__", json.dumps(shell, indent=2))
                  .replace("__THUMBS__", json.dumps(thumbs)))
    (ROOT / "sw.js").write_text(sw)
    return version


def main():
    places = load("places.json")
    days = load("days.json")
    marathon = load("marathon.json", {})
    practical = load("practical.json", [])
    findings = load("findings.json", [])
    photos = load("photos.json", {})
    meta = load("meta.json", {})
    if errors:
        report_and_exit()

    by_id = validate_places(places, photos)
    validate_days(days, by_id)
    course = course_from_kml()
    if errors:
        report_and_exit()

    for pid, p in by_id.items():
        p["photos"] = photos.get(pid, [])
    trip = {
        "generated": date.today().isoformat(),
        "meta": {**meta, "hero": (photos.get("_hero") or [None])[0]},
        "places": by_id,
        "days": sorted(days, key=lambda d: d["date"]),
        "marathon": {**marathon, "course": course},
        "practical": practical,
        "findings": findings,
    }
    trip_bytes = json.dumps(trip, ensure_ascii=False, separators=(",", ":")).encode()
    (DATA / "trip.json").write_bytes(trip_bytes)
    build_kml(places, days)
    version = build_sw(trip_bytes)
    for w in warnings:
        print(f"  warn  {w}")
    print(f"ok  {len(by_id)} places, {len(days)} days, trip.json {len(trip_bytes) // 1024} kB, sw {version}")


def report_and_exit():
    for e in errors:
        print(f"  ERROR {e}")
    for w in warnings:
        print(f"  warn  {w}")
    sys.exit(1)


if __name__ == "__main__":
    main()
