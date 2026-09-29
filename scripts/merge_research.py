#!/usr/bin/env python3
"""One-time bootstrap: merge research/*.json into data/places.json, data/days.json,
data/findings.json, data/practical.json and data/marathon.json.

After this runs, the files in data/ are the source of truth and get edited by hand.
Run it again only to start over (it overwrites them).

Usage: python3 scripts/merge_research.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "research"
DATA = ROOT / "data"
SLICES = ["mie-jue", "vie", "sab", "dom", "lun-mar-info"]

# Editorial layer: titles and ledes come from Matías's own text.
DAYS = {
    "2026-10-28": {
        "title": "Brooklyn y golf",
        "lede": "Llegamos a JFK a las 9:30, dejamos las valijas en The Hoxton de Williamsburg y nos vamos a jugar 9 hoyos en Dyker Beach, un campo histórico de Brooklyn con vista al puente Verrazzano. Después comemos comida yemení en Bay Ridge (lamb haneeth y pan recién hecho en Yemen Café) y cerramos con un trago en Westlight, un rooftop con Manhattan iluminado enfrente.",
    },
    "2026-10-29": {
        "title": "Expo, bote, queso y vino",
        "lede": "Vamos a la Expo apenas abre, a las 10, para retirar el kit y sacarnos eso de encima. Almorzamos en Chelsea Market, caminamos un rato por la High Line y dejamos las cosas en el hotel de Lexington. A media tarde, barquito de remos en Central Park. Después nos sentamos frente al lago en el Boathouse a comer burrata, pan y tomar vino. Si nos queda energía, vamos a Edge a ver la ciudad de noche.",
    },
    "2026-10-30": {
        "title": "Arte y Broadway",
        "lede": "A la mañana, Frick Collection; almuerzo de pastrami en Pastrami Queen, por Lexington; y a la tarde, el Met. A la noche, Broadway: el voto es Hadestown, que tiene música, mitología y una puesta tremenda. Cenamos después de la función.",
    },
    "2026-10-31": {
        "title": "Manhattan a pleno y Halloween",
        "lede": "Arrancamos por Grand Central, vamos al MoMA, bajamos a picar cosas por Chinatown y a la tarde cruzamos caminando el Brooklyn Bridge hacia DUMBO. Nos quedamos a ver cómo se enciende Manhattan desde el río. Esa noche es Halloween: podemos asomarnos un rato al desfile del Village y después volver cuando tengamos ganas.",
    },
    "2026-11-01": {
        "title": "Maratón de Nueva York",
        "lede": "Los dos tenemos la misma misión: atravesar los cinco boroughs y encontrarnos al final. Después, ducha, medalla y cena sin horario rígido.",
        "marathon": True,
    },
    "2026-11-02": {
        "title": "Harlem y festejo",
        "lede": "Paseamos por Harlem sin apuro y almorzamos para festejar en Harry Cipriani, junto a Central Park. Después buscamos las valijas y vamos al hotel de Queens. Si nos quedan piernas y hambre, cerramos el viaje comiendo tacos de birria y otras cosas ricas por Jackson Heights.",
    },
    "2026-11-03": {
        "title": "Vuelta",
        "lede": "Salimos tranquilos hacia LaGuardia para el vuelo de las 15.",
    },
}

# The same place under different ids across slices: alias → canonical id.
ALIASES = {
    "the-lexington-hotel": "hotel-lexington",
    "lexington-hotel": "hotel-lexington",
}

# Commons files reviewed and rejected (hazy, off-topic or under construction).
PHOTO_BLOCKLIST = {
    "File:Verrazano Narrows Bridge from Staten Island to Brooklyn, New York (2896539552).jpg",
    "File:William Vale Hotel Brooklyn NY 2015 06 10 01.jpg",
    "File:New York High Line West 30th Street (8675159802).jpg",
}

LINE = r"(?:[1-7ABCDEFGJLMNQRSWZ]|SIR)"


def bulletize(text):
    """Mark subway lines as [X] after words like 'línea' or 'tren'."""
    if not text:
        return text

    def repl(m):
        lines = re.split(r"(\s*/\s*|\s*,\s*|\s+o\s+|\s+y\s+)", m.group(2))
        out = "".join(f"[{t}]" if re.fullmatch(LINE, t) else t for t in lines)
        return m.group(1) + out

    pattern = rf"(\b(?:[Ll]íneas?|[Tt]renes|[Tt]ren|[Ss]ubte)\s+)({LINE}(?:(?:\s*/\s*|\s*,\s*|\s+o\s+|\s+y\s+){LINE})*)\b"
    return re.sub(pattern, repl, text)


def richness(p):
    return len(json.dumps(p, ensure_ascii=False))


def main():
    places, days, findings, practical, marathon = {}, {}, [], [], {}
    for slug in SLICES:
        path = RESEARCH / f"{slug}.json"
        if not path.exists():
            print(f"  missing {path.name}, skipping")
            continue
        data = json.loads(path.read_text())
        for p in data.get("places", []):
            pid = p["id"] = ALIASES.get(p["id"], p["id"])
            if pid in places:
                # Keep the richer entry, but never lose a photo list.
                keep, other = (p, places[pid]) if richness(p) > richness(places[pid]) else (places[pid], p)
                keep["commons_files"] = keep.get("commons_files") or other.get("commons_files") or []
                places[pid] = keep
            else:
                places[pid] = p
        for d in data.get("days", []):
            for b in d.get("blocks", []):
                b["place"] = ALIASES.get(b["place"], b["place"])
                for a in b.get("alternatives") or []:
                    a["place"] = ALIASES.get(a["place"], a["place"])
            for r in d.get("reservations", []):
                if r.get("place"):
                    r["place"] = ALIASES.get(r["place"], r["place"])
            if d["date"] in days:
                days[d["date"]]["blocks"] += d.get("blocks", [])
                days[d["date"]]["tips"] += d.get("tips", [])
                days[d["date"]]["reservations"] += d.get("reservations", [])
            else:
                days[d["date"]] = {"blocks": [], "tips": [], "reservations": [], **d}
        findings += [{**f, "slice": slug} for f in data.get("findings", [])]
        practical += data.get("practical", [])
        if "marathon" in data:
            marathon.update(data["marathon"])

    for p in places.values():
        p["commons_files"] = [f for f in p.get("commons_files") or [] if f not in PHOTO_BLOCKLIST]
        if p.get("transit", {}).get("notes"):
            p["transit"]["notes"] = bulletize(p["transit"]["notes"])
        for k in ("why", "tip"):
            p[k] = bulletize(p.get(k))
    out_days = []
    for date, meta in DAYS.items():
        d = days.get(date, {"date": date, "blocks": [], "tips": [], "reservations": []})
        d.update(meta)
        d["blocks"].sort(key=lambda b: b["time"])
        for b in d["blocks"]:
            b["note"] = bulletize(b.get("note"))
            if b.get("from_prev"):
                b["from_prev"]["detail"] = bulletize(b["from_prev"].get("detail"))
        d["tips"] = [bulletize(t) for t in d["tips"]]
        out_days.append(d)

    marathon.setdefault("date", "2026-11-01")
    DATA.mkdir(exist_ok=True)
    dump = lambda name, obj: (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    dump("places.json", sorted(places.values(), key=lambda p: p["id"]))
    dump("days.json", out_days)
    dump("findings.json", findings)
    dump("practical.json", practical)
    dump("marathon.json", marathon)
    print(f"ok  {len(places)} places, {sum(len(d['blocks']) for d in out_days)} blocks, "
          f"{len(findings)} findings, {len(practical)} practical items")


if __name__ == "__main__":
    main()
