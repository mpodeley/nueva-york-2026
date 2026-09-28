# Nueva York 2026

Guía del viaje de Matías y Dani a Nueva York (28 de octubre al 3 de noviembre de 2026,
maratón el domingo 1 de noviembre). App estática para el celu: itinerario por día con mapa,
fichas de cada lugar con fotos, ratings y links, Plan B por bloque, calculadora de pasos de la
maratón para los dos, reservas con fecha límite y modo sin señal.

Publicada en https://mpodeley.github.io/nueva-york-2026/

## Estructura

```
index.html, assets/          app (vanilla JS + Leaflet, sin build de front)
data/places.json             fichas de lugares            ← se edita a mano
data/days.json               itinerario por día            ← se edita a mano
data/marathon.json           olas, notas del recorrido, logística
data/practical.json          info práctica
data/findings.json           verificaciones con fuente
data/meta.json               epígrafe y foto de portada
data/photos.json             créditos de fotos (lo escribe fetch_photos.py)
data/trip.json               bundle que lee la app (lo escribe build.py)
research/                    salida cruda de la investigación
scripts/build.py             valida y arma trip.json, places.kml y sw.js
scripts/fetch_photos.py      baja fotos de Wikimedia Commons y las pasa a webp
scripts/merge_research.py    bootstrap: research/ → data/ (sobrescribe)
```

## Flujo

```bash
python3 scripts/fetch_photos.py   # si cambiaron commons_files
python3 scripts/build.py          # falla si hay ids rotos, coords fuera de NYC, bloques sin Plan B
python3 -m http.server 8000       # y abrir http://localhost:8000
```

El recorrido de la maratón sale del KML en `~/Projects/personal/maraton-viajes/`; el build
guarda una copia en `data/course.json` para no depender de esa carpeta.
