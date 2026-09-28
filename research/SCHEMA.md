# Research brief: Nueva York 2026 travel guide

Context: Matías and Daniela (Argentines, from Buenos Aires) travel to New York City from
Wednesday 2026-10-28 to Tuesday 2026-11-03. Both run the TCS New York City Marathon on Sunday
2026-11-01. Today is 2026-09-28. We are building an offline-capable travel guide webapp
(Lonely Planet style) around their plan. Your job: research one slice of the trip on the live
web and write a JSON file with verified facts. Your training data may be stale: verify
everything that can change (hours, prices, whether a show is still running, whether a place
still exists or moved) against 2026 sources, and record the URL you used.

Hotels: The Hoxton Williamsburg (night of Wed 28), The Lexington Hotel on Lexington Ave in
Midtown East (nights Thu 29 → Mon 2 morning; luggage picked up there Monday), DoubleTree by
Hilton New York LaGuardia Airport (night of Mon 2). Flight out: LaGuardia, Tue 3 at 15:00.

## Output

Write exactly one file, `research/<slug>.json` (slug given in your task), UTF-8, valid JSON,
with this shape:

```json
{
  "places": [ Place, ... ],
  "days": [ Day, ... ],
  "findings": [ Finding, ... ],
  "practical": [ PracticalItem, ... ]
}
```

Validate it with `python3 -m json.tool research/<slug>.json > /dev/null` before finishing.

### Place

```json
{
  "id": "kebab-case-unique-id",
  "name": "Official name",
  "category": "hotel | comida | bar | museo | paseo | golf | show | mirador | maraton | transporte | barrio",
  "neighborhood": "Bay Ridge, Brooklyn",
  "address": "Street address, City, NY ZIP",
  "lat": 40.12345, "lng": -74.12345,
  "coords_source": "URL (OSM/Nominatim, Wikipedia, official site)",
  "hours": "Hours on the day we go, e.g. 'mié 28-oct: 11:00–23:00'",
  "hours_source": "URL",
  "price": "Concrete: 'Entrada USD 32', 'Plato principal USD 18–28', '9 hoyos USD 34'",
  "duration_min": 90,
  "booking": { "needed": "sí | no | recomendado", "url": "...", "lead": "e.g. 'se abre 30 días antes'", "notes": "" },
  "transit": { "station": "86 St", "lines": ["R"], "walk_min": 8, "notes": "" },
  "why": "2–4 sentences in Spanish: what it is and why it's worth it, facts first.",
  "what": ["Qué pedir / qué mirar: 3–5 concrete items in Spanish"],
  "tip": "1–2 sentences in Spanish: the practical insider tip.",
  "warnings": ["Anything that could break the plan: closed days, cash only, dress code, lines."],
  "reviews": {
    "ratings": [ { "source": "Google | Tripadvisor | Yelp | Michelin | Infatuation", "rating": 4.6, "scale": 5, "count": 3200, "url": "...", "checked": "2026-09-28" } ],
    "consensus": ["Own synthesis in Spanish of what reviewers repeat, praise or complain about. 2–4 bullets."],
    "press": [ { "outlet": "The Infatuation", "quote": "verbatim, 25 words max, original language", "url": "..." } ]
  },
  "links": { "official": "", "menu": "", "reserve": "", "tickets": "", "instagram": "", "wikipedia": "" },
  "commons_files": ["File:Exact title on Wikimedia Commons.jpg"],
  "checked": "2026-09-28"
}
```

### Day

```json
{
  "date": "2026-10-28",
  "blocks": [
    {
      "time": "09:30",
      "place": "place-id",
      "title": "Short title in Spanish",
      "note": "1–3 sentences in Spanish, specific to this visit.",
      "from_prev": { "mode": "a pie | subte | tren | taxi | ferry | bus", "detail": "Línea L de Bedford Av a 8 Av, combinar...", "minutes": 35 },
      "alternatives": [ { "place": "place-id", "reason": "lluvia | cerrado | sin-entradas | cansados | otra-opción | piernas", "note": "When and why to switch, in Spanish." } ]
    }
  ],
  "tips": ["Day-level tips in Spanish."],
  "reservations": [ { "what": "Spanish label", "place": "place-id", "deadline": "2026-10-10", "url": "...", "note": "" } ]
}
```

Every alternative referenced must also be a full Place in `places`. Aim for 1–3 alternatives
per block, chosen for real reasons (rain, closed, sold out, tired legs before the marathon,
closer option).

### Finding

For each critical check in your task: `{ "topic": "...", "status": "ok | riesgo | cambia-plan", "detail": "Spanish, concrete", "source": "URL" }`.

### PracticalItem

Only if your task asks for practical info: `{ "topic": "...", "title": "Spanish", "body": "Spanish, 2–6 sentences", "source": "URL" }`.

## Rules for research

- **Never invent a number.** Ratings, review counts, prices, hours and coordinates only if you
  saw them in a source, with the URL. If Google's rating isn't fetchable, use what you can
  verify (Tripadvisor, Yelp, Michelin, The Infatuation, Eater, NYT, Time Out). Omit rather
  than guess. Search-result snippets showing a rating count as a source (cite the page URL).
- Coordinates: Nominatim works well:
  `https://nominatim.openstreetmap.org/search?q=<name+address>&format=json&limit=3`.
  Accuracy matters (pins on a map); check the result's display_name matches.
- Wikimedia Commons: find 1–3 files that actually show the place, via
  `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=<query>&srnamespace=6&format=json&srlimit=20`
  or the place's Commons category. Prefer exterior/iconic shots, landscape orientation, jpg.
  Give exact titles with the `File:` prefix. Empty list is fine for small restaurants.
- Press quotes are short and verbatim with outlet and URL. Never copy user reviews verbatim:
  `consensus` is your own synthesis.
- Do not book, sign up or submit anything.

## Rules for Spanish text (why, what, tip, note, consensus, findings, practical)

- Rioplatense Spanish. First person plural when talking about the plan ("vamos", "pedimos",
  "conviene llegar"). Voseo if addressing the reader ("reservá").
- Short sentences (average under 25 words). Facts and numbers before adjectives: an evaluative
  adjective with no number behind it gets cut.
- Numbers use the English convention even in Spanish: `USD 1,250.50`, `4.6`, `15%`, `3 km`.
  Dates in prose: `28 de octubre`. Ranges with en dash, no spaces: `11:00–23:00`.
- Never an em dash (—) in prose. Use commas, parentheses or a colon.
- No emoji. No filler ("imperdible", "sin dudas", "una experiencia única", "vale la pena
  destacar", "icónico" unless it's literally an icon). No antithesis formulas ("no es X, es Y",
  "X, no Y", "no X sino Y"): just say Y.
- Bold is not needed; plain text only.
