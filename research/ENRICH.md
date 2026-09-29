# Enrichment brief: history, curiosities and what to see on the way

Context: travel-guide webapp for Matías and Daniela's New York trip, 2026-10-28 → 2026-11-03
(both run the marathon on Sunday 2026-11-01). Today is 2026-09-28. The itinerary is final and
lives in `data/days.json`; places live in `data/places.json`. Read both, plus
`research/SCHEMA.md` (the Spanish style rules there apply here too).

Matías asked for "mucho más contexto, historia, Atlas Obscura, cosas para ver en el recorrido",
and for every leg between stops to say how we get there (transit line, or walking time).

**Do not edit anything in `data/`.** Write exactly one file, `research/enrich-<slug>.json`,
and validate it with `python3 -m json.tool`. Put scratch files only in
`/tmp/claude-1000/-var-home-matias/f4ae4bed-93c0-4e47-845e-4786fa5e0d9d/scratchpad/enrich-<slug>/`
(other agents share the scratchpad root).

## Output

```json
{
  "places": {
    "<place-id>": {
      "history": "2–3 paragraphs in Spanish separated by \n\n, 120–250 words total. Dates, names, what happened here. Facts only.",
      "curiosities": [
        { "title": "Short title in Spanish", "text": "1–3 sentences in Spanish, in our own words.", "source": "URL", "source_name": "Atlas Obscura | Wikipedia | NYT | ..." }
      ]
    }
  },
  "blocks": {
    "<date>#<index>": {
      "note": "1–3 sentences in Spanish for this visit, consistent with the new order of the day.",
      "from_prev": {
        "mode": "a pie | subte | tren | taxi | ferry | bus",
        "detail": "How exactly. Transit: '[6] de Grand Central–42 St a 68 St–Hunter College, 3 paradas; 5 min a pie hasta la puerta'. Walking: 'Por Fifth Avenue hasta la 59 y entramos al parque por Grand Army Plaza'.",
        "minutes": 25,
        "km": 1.8,
        "sights": [
          { "name": "What we pass", "text": "1–2 sentences in Spanish: what it is and what to look at.", "lat": 40.0, "lng": -73.0, "source": "URL" }
        ]
      }
    }
  },
  "days": {
    "<date>": { "context": "1–2 paragraphs in Spanish on the neighborhoods of the day and how they connect.", "km_walk": 7.5 }
  }
}
```

- `<index>` is the 0-based position of the block in that day's `blocks` array in
  `data/days.json`. Cover every block of your days. For a day's first block, `from_prev` is the
  leg from where we slept (omit it only if there is no movement, e.g. waking up in the hotel).
- Subway lines in `detail` go as tokens: `[6]`, `[A]`, `[7]`, `[SIR]`. Other modes in words
  (AirTrain, LIRR, NYC Ferry, Q70).
- `km` only for walking legs (and the walking part of mixed legs, noted in `detail`). Walking
  speed about 4.5 km/h. For real walking distances use the OSM foot router:
  `https://routing.openstreetmap.de/routed-foot/route/v1/driving/<lng>,<lat>;<lng>,<lat>?overview=false`
  (distance in meters, in `routes[0].distance`).
- `sights`: things we actually pass or see on that leg. Walking: buildings, plaques, statues,
  shop windows, street details, with coordinates so they show on the map. Subway: the art in
  the stations we use (MTA Arts & Design permanent art), what shows through the window on
  elevated or bridge sections. Ferry and bridges: what we see from the water. 2–6 per leg of
  more than 10 minutes; 0–1 for short hops.
- `history` is mandatory for every place that is a main block of your days. For places that
  only appear as alternatives, one short paragraph is enough. `curiosities`: 2–5 for main
  places, prefer Atlas Obscura entries (the odd, the hidden, the overlooked), then Wikipedia,
  NYT, Untapped New York, official sites. Each curiosity cites a source URL; for Atlas Obscura
  cite the live `https://www.atlasobscura.com/places/<slug>` URL.
- Also add Atlas Obscura entries that are near a stop but aren't places in the plan: put them
  as `sights` on the leg where we pass closest, with coordinates.

## How to fetch (web search is exhausted for this session)

WebSearch no longer works in this session. Use WebFetch or `curl` directly:

- **Atlas Obscura** blocks direct requests (Cloudflare 403). Read it through the Wayback
  Machine, which works:
  `curl -sL --compressed -A "Mozilla/5.0" "https://web.archive.org/web/2026id_/https://www.atlasobscura.com/places/<slug>"`
  Title, description and the "About" text are in the HTML; strip tags. Each page links to
  nearby places (`href=".../places/<slug>"`): crawl those to discover entries around each
  stop. Seed with slugs you know (e.g. `grand-central-terminal-whispering-gallery`,
  `grand-central-ceiling-dark-patch`) and verify each one exists before citing it. If a
  snapshot is missing, check `https://archive.org/wayback/available?url=atlasobscura.com/places/<slug>`.
- **Wikipedia**: `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|coordinates&explaintext=1&redirects=1&titles=<Title>&format=json`
  (also `es.wikipedia.org`).
- **Geocoding**: Photon `https://photon.komoot.io/api/?q=<query>&limit=3` (Nominatim is
  rate-limited for us). Add a `User-Agent`.
- **MTA**: `https://new.mta.info` pages (Arts & Design permanent art per station), and the
  station list for lines and stops.
- Never invent a fact, date, distance or coordinate. If you can't verify it, leave it out.
