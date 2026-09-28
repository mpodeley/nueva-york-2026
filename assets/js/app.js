/* Nueva York 2026 — guía de viaje. Vanilla JS + Leaflet, datos en data/trip.json. */
(function () {
  'use strict';

  const TZ = 'America/New_York';
  const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const CATEGORY_LABELS = {
    hotel: 'Hotel', comida: 'Comida', bar: 'Bar', museo: 'Museo', paseo: 'Paseo', golf: 'Golf',
    show: 'Show', mirador: 'Mirador', maraton: 'Maratón', transporte: 'Transporte', barrio: 'Barrio',
  };
  const REASON_LABELS = {
    'lluvia': 'Si llueve', 'cerrado': 'Si está cerrado', 'sin-entradas': 'Si no hay entradas',
    'cansados': 'Si estamos cansados', 'otra-opción': 'Otra opción', 'piernas': 'Para cuidar las piernas',
  };
  const MODE_LABELS = { 'a pie': 'A pie', subte: 'Subte', tren: 'Tren', taxi: 'Taxi', ferry: 'Ferry', bus: 'Bus' };
  const GMAPS_MODE = { 'a pie': 'walking', subte: 'transit', tren: 'transit', ferry: 'transit', bus: 'transit', taxi: 'driving' };
  const LINE_COLORS = {
    '1': '#ee352e', '2': '#ee352e', '3': '#ee352e', '4': '#00933c', '5': '#00933c', '6': '#00933c',
    '7': '#b933ad', A: '#0039a6', C: '#0039a6', E: '#0039a6', B: '#ff6319', D: '#ff6319', F: '#ff6319',
    M: '#ff6319', G: '#6cbe45', J: '#996633', Z: '#996633', L: '#a7a9ac', N: '#fccc0a', Q: '#fccc0a',
    R: '#fccc0a', W: '#fccc0a', S: '#808183', SIR: '#0039a6',
  };
  const DARK_INK_LINES = new Set(['N', 'Q', 'R', 'W', 'L']);
  const LS_RES = 'ny26-reservas';
  const LS_RUNNERS = 'ny26-corredores';

  const state = { trip: null, maps: [], baseHash: '#/', sheetOpenedInApp: false, observer: null };
  const view = document.getElementById('view');
  const sheet = document.getElementById('sheet');
  const sheetBody = sheet.querySelector('.sheet-body');
  const backdrop = document.getElementById('sheet-backdrop');

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = esc;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function lsGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: ignore */ }
  }

  function nyParts(d = new Date()) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  }
  function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function dateLong(iso) { const d = parseISO(iso); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; }
  function dateShort(iso) { const d = parseISO(iso); return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; }
  function weekdayCap(iso) { const w = WEEKDAYS[parseISO(iso).getUTCDay()]; return w[0].toUpperCase() + w.slice(1); }
  function toMin(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); }
  function fmtMin(total) { total = Math.round(total); const h = Math.floor(total / 60) % 24; const m = total % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  function lineBullet(line) {
    const l = String(line).trim();
    const color = LINE_COLORS[l.toUpperCase()] || '#808183';
    const ink = DARK_INK_LINES.has(l.toUpperCase()) ? '#111' : '#fff';
    const round = l.length === 1 ? ' round' : '';
    return `<span class="bullet${round}" style="--b:${color};--bi:${ink}" title="Línea ${esc(l)}">${esc(l)}</span>`;
  }
  // Plain text with [L] / [4] / [SIR] tokens rendered as subway bullets.
  function rich(text) {
    return esc(text).replace(/\[([A-Za-z0-9]{1,3})\]/g, (_, l) => lineBullet(l));
  }

  function ratingHtml(r) {
    if (!r) return '';
    const count = r.count ? ` <span class="muted">(${Number(r.count).toLocaleString('en-US')})</span>` : '';
    return `<span class="rating"><span class="star" aria-hidden="true">★</span><b>${esc(r.rating)}</b>${r.scale && r.scale !== 5 ? `/${esc(r.scale)}` : ''} ${esc(r.source)}${count}</span>`;
  }

  function photoOf(p, size = 'thumb') {
    if (!p || !p.photos || !p.photos.length) return null;
    const ph = p.photos[0];
    return size === 'thumb' ? (ph.thumb || ph.src) : ph.src;
  }
  function dayPhoto(d) {
    const P = state.trip.places;
    if (d.hero && P[d.hero] && P[d.hero].photos.length) return P[d.hero].photos[0];
    for (const b of d.blocks) { const p = P[b.place]; if (p && p.photos.length && p.category !== 'hotel' && p.category !== 'transporte') return p.photos[0]; }
    return null;
  }
  function creditHtml(ph) {
    if (!ph) return '';
    return `Foto: ${esc(ph.author || 'Wikimedia Commons')}${ph.license ? ` · ${esc(ph.license)}` : ''} · <a href="${attr(ph.source)}" target="_blank" rel="noopener">fuente</a>`;
  }
  function gmapsPlace(p) {
    const q = encodeURIComponent(`${p.name}, ${p.address || ''}`);
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }
  function gmapsDir(from, to, mode) {
    const m = GMAPS_MODE[mode] || 'transit';
    const origin = from ? `&origin=${from.lat},${from.lng}` : '';
    return `https://www.google.com/maps/dir/?api=1${origin}&destination=${to.lat},${to.lng}&travelmode=${m}`;
  }

  // ---------- maps ----------
  function destroyMaps() {
    state.maps.forEach((m) => m.remove());
    state.maps = [];
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
  }
  function tiles() {
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  }
  function makeMap(el, opts = {}) {
    const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, tap: true, ...opts });
    tiles().addTo(map);
    map.setView([40.73, -73.97], 12);
    state.maps.push(map);
    addLocate(map);
    return map;
  }
  function addLocate(map) {
    if (!('geolocation' in navigator)) return;
    const Ctl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar');
        const btn = L.DomUtil.create('button', 'locate-btn', div);
        btn.type = 'button'; btn.title = 'Dónde estoy'; btn.setAttribute('aria-label', 'Dónde estoy'); btn.textContent = '◎';
        let marker = null;
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stop(e);
          navigator.geolocation.getCurrentPosition((pos) => {
            const ll = [pos.coords.latitude, pos.coords.longitude];
            if (marker) marker.setLatLng(ll); else marker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
            map.setView(ll, Math.max(map.getZoom(), 15));
          }, () => alert('No pude obtener la ubicación.'), { enableHighAccuracy: true, timeout: 10000 });
        });
        return div;
      },
    });
    map.addControl(new Ctl());
  }
  function pinIcon(cat, label = '', cls = '') {
    const size = cls.includes('dot') ? 16 : cls.includes('alt') ? 20 : 28;
    return L.divIcon({
      className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
      html: `<div class="pin ${cls}" data-cat="${attr(cat)}">${esc(label)}</div>`,
    });
  }
  function popupHtml(p, extra = '') {
    return `<div data-cat="${attr(p.category)}"><span class="eyebrow">${esc(CATEGORY_LABELS[p.category] || p.category)} · ${esc(p.neighborhood || '')}</span><br><strong>${esc(p.name)}</strong>${extra}<br><a href="#/lugar/${attr(p.id)}">Ver ficha →</a></div>`;
  }
  function drawCourse(map, course, withLandmarks = true) {
    if (!course) return null;
    const group = L.featureGroup();
    course.segments.forEach((s) => {
      L.polyline(s.coords, { color: '#fff', weight: 8, opacity: 0.9 }).addTo(group);
      L.polyline(s.coords, { color: s.color, weight: 5, opacity: 1 }).bindTooltip(s.name, { sticky: true }).addTo(group);
    });
    course.km.filter((k) => k.km % 5 === 0).forEach((k) => {
      L.marker([k.lat, k.lng], { icon: L.divIcon({ className: '', html: `<span class="km-label">${k.km} km</span>`, iconSize: [40, 18], iconAnchor: [20, 9] }), interactive: false }).addTo(group);
    });
    if (withLandmarks) {
      course.landmarks.forEach((h) => {
        L.circleMarker([h.lat, h.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#ee352e', fillOpacity: 1 })
          .bindPopup(`<strong>${esc(h.name)}</strong><br><span class="muted">km ${esc(h.km)}</span><br>${esc(h.note)}`)
          .addTo(group);
      });
    }
    group.addTo(map);
    return group;
  }

  // ---------- routing ----------
  function setTab(tab) {
    $$('.tabs a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function route() {
    const hash = location.hash || '#/';
    const parts = hash.slice(1).split('/').filter(Boolean);
    if (parts[0] === 'lugar') {
      if (!view.dataset.rendered) renderBase('#/');
      openSheet(decodeURIComponent(parts[1] || ''));
      return;
    }
    closeSheet(false);
    renderBase(hash);
  }
  function renderBase(hash) {
    state.baseHash = hash;
    const parts = hash.slice(1).split('/').filter(Boolean);
    destroyMaps();
    view.dataset.rendered = '1';
    const r = parts[0] || '';
    if (r === 'dia' && parts[1]) { setTab('home'); renderDay(parts[1]); }
    else if (r === 'mapa') { setTab('mapa'); renderMapPage(); }
    else if (r === 'maraton') { setTab('maraton'); renderDay(state.trip.marathon.date || '2026-11-01', true); }
    else if (r === 'reservas') { setTab('reservas'); renderReservations(); }
    else if (r === 'info') { setTab('info'); renderInfo(); }
    else { setTab('home'); renderHome(); }
    if (!(r === 'maraton')) window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }

  // ---------- home ----------
  function renderHome() {
    const t = state.trip;
    const days = t.days;
    const first = days[0].date, last = days[days.length - 1].date;
    const today = nyParts().date;
    let count;
    const toGo = daysBetween(today, first);
    if (toGo > 1) count = `Faltan ${toGo} días`;
    else if (toGo === 1) count = 'Mañana arranca el viaje';
    else if (today <= last) count = `Día ${daysBetween(first, today) + 1} de ${days.length}`;
    else count = 'Viaje terminado';
    const todayDay = days.find((d) => d.date === today);
    const hero = (t.meta && t.meta.hero) || null;

    view.innerHTML = `
      <section class="hero" style="background-image:url('${attr(hero ? hero.src : '')}')">
        <div class="wrap">
          <p class="eyebrow" style="color:#fff;opacity:.85">Guía del viaje · Matías y Dani</p>
          <h1>Nueva York</h1>
          <p class="dates">Del ${dateShort(first)} al ${dateShort(last)} de 2026 · maratón el ${dateLong(t.marathon.date || '2026-11-01')}</p>
          <span class="count">${esc(count)}</span>
        </div>
        ${hero ? `<p class="credit">${creditHtml(hero)}</p>` : ''}
      </section>
      <div class="wrap">
        ${todayDay ? `<a class="today" href="#/dia/${todayDay.date}"><span class="eyebrow" style="color:inherit;opacity:.7">Hoy</span><strong>${esc(todayDay.title)}</strong><span>Abrir el día →</span></a>` : ''}
        <section class="section">
          ${t.meta && t.meta.epigraph ? `<p class="epigraph">"${esc(t.meta.epigraph)}"</p>` : ''}
        </section>
        <section class="section" aria-labelledby="dias-h">
          <h2 id="dias-h">Día por día</h2>
          <ul class="daycards">${days.map((d, i) => dayCard(d, i)).join('')}</ul>
        </section>
        <section class="section" aria-labelledby="mapa-h">
          <h2 id="mapa-h">Todo el viaje en un mapa</h2>
          <div id="homemap" class="map"></div>
          <p class="small muted" style="margin-top:8px">Cada punto es una parada del plan. <a href="#/mapa">Abrir el mapa completo, con filtros y Plan B →</a></p>
        </section>
        <footer class="footer">Datos verificados el ${esc(dateShort(t.generated))} de 2026. Horarios y precios cambian: la ficha de cada lugar tiene el link a la fuente.</footer>
      </div>`;

    const map = makeMap('homemap');
    const pts = [];
    days.forEach((d, di) => d.blocks.forEach((b) => {
      const p = t.places[b.place];
      if (!p || p.category === 'transporte') return;
      pts.push([p.lat, p.lng]);
      L.marker([p.lat, p.lng], { icon: pinIcon(p.category, String(di + 1)) })
        .bindPopup(popupHtml(p, `<br><span class="muted">${esc(weekdayCap(d.date))} ${esc(dateShort(d.date))}</span>`)).addTo(map);
    }));
    if (pts.length) map.fitBounds(pts, { padding: [24, 24] });
  }
  function dayCard(d, i) {
    const ph = dayPhoto(d);
    const highlights = d.blocks
      .filter((b) => { const p = state.trip.places[b.place]; return p && !['hotel', 'transporte'].includes(p.category); })
      .slice(0, 4).map((b) => `<li>${esc(b.title)}</li>`).join('');
    const cat = d.marathon ? 'maraton' : 'comida';
    return `<li class="daycard" data-cat="${cat}"><a href="#/dia/${d.date}">
      <div class="ph" ${ph ? `style="background-image:url('${attr(ph.thumb || ph.src)}')"` : ''}><span class="num">${i + 1}</span></div>
      <div class="txt"><p class="eyebrow">${esc(weekdayCap(d.date))} ${esc(dateShort(d.date))}</p><h3>${esc(d.title)}</h3><ul>${highlights}</ul></div>
    </a></li>`;
  }

  // ---------- day ----------
  function renderDay(date, focusMarathon = false) {
    const t = state.trip;
    const idx = t.days.findIndex((d) => d.date === date);
    if (idx < 0) { view.innerHTML = '<div class="wrap"><p class="loading">No encontré ese día.</p></div>'; return; }
    const d = t.days[idx];
    const P = t.places;
    const ph = dayPhoto(d);
    const today = nyParts();
    let nowIdx = -1;
    if (today.date === d.date) d.blocks.forEach((b, i) => { if (toMin(b.time) <= today.minutes) nowIdx = i; });

    const blocksHtml = d.blocks.map((b, i) => {
      const p = P[b.place];
      const prev = i > 0 ? P[d.blocks[i - 1].place] : null;
      let leg = '';
      if (b.from_prev) {
        const f = b.from_prev;
        const link = gmapsDir(prev, p, f.mode);
        leg = `<div class="leg"><span class="mode">${esc(MODE_LABELS[f.mode] || f.mode || '')}</span>${f.minutes ? `<span>${esc(f.minutes)} min</span>` : ''}<span>${rich(f.detail || '')}</span><a href="${attr(link)}" target="_blank" rel="noopener">Ruta en Google Maps</a></div>`;
      }
      const alts = (b.alternatives || []).map((a) => {
        const ap = P[a.place];
        if (!ap) return '';
        return `<li data-cat="${attr(ap.category)}"><span class="why">${esc(REASON_LABELS[a.reason] || a.reason)}</span><br><a class="name" href="#/lugar/${attr(ap.id)}">${esc(ap.name)}</a> ${ratingHtml((ap.reviews || {}).ratings && ap.reviews.ratings[0])}<p>${rich(a.note || ap.why || '')}</p></li>`;
      }).join('');
      const rating = (p.reviews || {}).ratings && p.reviews.ratings[0];
      const thumb = photoOf(p);
      return `<li id="b${i}">${leg}
        <article class="stop${i === nowIdx ? ' now' : ''}" data-i="${i}" data-cat="${attr(p.category)}">
          <div class="rail"><span class="time">${esc(b.time)}</span><div class="pin" data-cat="${attr(p.category)}">${i + 1}</div></div>
          <div>
            <p class="cat">${esc(CATEGORY_LABELS[p.category] || p.category)} · ${esc(p.neighborhood || '')}</p>
            <h3>${esc(b.title)}</h3>
            <p class="placeline"><a href="#/lugar/${attr(p.id)}">${esc(p.name)}</a>${rating ? ratingHtml(rating) : ''}${p.price ? `<span class="muted">${esc(p.price)}</span>` : ''}</p>
            ${thumb ? `<img class="thumb" loading="lazy" src="${attr(thumb)}" alt="${attr(p.name)}">` : ''}
            ${b.note ? `<p class="note">${rich(b.note)}</p>` : ''}
            <div class="actions"><a class="btn primary" href="#/lugar/${attr(p.id)}">Ficha completa</a><a class="btn" href="${attr(gmapsDir(null, p, 'subte'))}" target="_blank" rel="noopener">Cómo llegar desde acá</a></div>
            ${alts ? `<details class="planb"><summary>Plan B · ${(b.alternatives || []).length} ${(b.alternatives || []).length === 1 ? 'opción' : 'opciones'}</summary><ul class="alts">${alts}</ul></details>` : ''}
          </div>
        </article></li>`;
    }).join('');

    const tips = (d.tips || []).length ? `<div class="box"><h2>Para tener en cuenta</h2><ul>${d.tips.map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div>` : '';
    const res = (d.reservations || []).length ? `<div class="box"><h2>Reservas de este día</h2><ul>${d.reservations.map((r) => `<li>${r.url ? `<a href="${attr(r.url)}" target="_blank" rel="noopener">${esc(r.what)}</a>` : esc(r.what)}${r.deadline ? ` <span class="due">antes del ${esc(dateShort(r.deadline))}</span>` : ''}${r.note ? `<br><span class="small muted">${rich(r.note)}</span>` : ''}</li>`).join('')}</ul><p class="small" style="margin-top:8px"><a href="#/reservas">Ver todas las reservas →</a></p></div>` : '';
    const prev = t.days[idx - 1], next = t.days[idx + 1];

    view.innerHTML = `
      <div class="wrap" data-cat="${d.marathon ? 'maraton' : 'comida'}">
        <header class="dayhead">
          <p class="kicker">${esc(weekdayCap(d.date))} ${esc(dateShort(d.date))} · Día ${idx + 1} de ${t.days.length}</p>
          <h1>${esc(d.title)}</h1>
          ${d.lede ? `<p class="lede">${rich(d.lede)}</p>` : ''}
          ${ph ? `<div class="photo" role="img" aria-label="Foto del día" style="background-image:url('${attr(ph.src)}')"></div><p class="photo-credit">${creditHtml(ph)}</p>` : ''}
        </header>
        <div class="daygrid">
          <div id="daymap" class="map"></div>
          <div>
            <ol class="timeline">${blocksHtml}</ol>
            ${tips}${res}
          </div>
        </div>
        ${d.marathon ? marathonHtml() : ''}
        <nav class="pager" aria-label="Días">
          ${prev ? `<a href="#/dia/${prev.date}"><small>← Día anterior</small>${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="next" href="#/dia/${next.date}"><small>Día siguiente →</small>${esc(next.title)}</a>` : '<span></span>'}
        </nav>
      </div>`;

    // Map
    const map = makeMap('daymap');
    const markers = [];
    const pts = [];
    if (d.marathon) drawCourse(map, t.marathon.course, false);
    d.blocks.forEach((b, i) => {
      const p = P[b.place];
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p.category, String(i + 1)), zIndexOffset: 1000 })
        .bindPopup(popupHtml(p, `<br><span class="muted">${esc(b.time)} · ${esc(b.title)}</span>`)).addTo(map);
      m.on('click', () => setActive(i, false));
      markers.push(m);
      pts.push([p.lat, p.lng]);
    });
    if (pts.length > 1) L.polyline(pts, { color: '#888', weight: 2, dashArray: '4 6', opacity: 0.8 }).addTo(map);
    const altLayer = L.layerGroup();
    d.blocks.forEach((b) => (b.alternatives || []).forEach((a) => {
      const ap = P[a.place]; if (!ap) return;
      L.marker([ap.lat, ap.lng], { icon: pinIcon(ap.category, 'B', 'alt') }).bindPopup(popupHtml(ap, `<br><span class="muted">Plan B de "${esc(b.title)}"</span>`)).addTo(altLayer);
    }));
    const AltCtl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const btn = L.DomUtil.create('button', 'chip');
        btn.type = 'button'; btn.textContent = 'Plan B en el mapa'; btn.setAttribute('aria-pressed', 'false');
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.stop(e);
          const on = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(on));
          if (on) altLayer.addTo(map); else altLayer.remove();
        });
        return btn;
      },
    });
    map.addControl(new AltCtl());
    if (d.marathon) {
      const all = L.latLngBounds(pts);
      t.marathon.course.segments.forEach((s) => s.coords.forEach((c) => all.extend(c)));
      map.fitBounds(all, { padding: [20, 20] });
    } else if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });

    function setActive(i, pan = true) {
      $$('.stop').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === i));
      markers.forEach((m, j) => { const el = m.getElement(); if (el) el.firstElementChild.classList.toggle('active', j === i); });
      if (pan && markers[i]) map.panInside(markers[i].getLatLng(), { padding: [40, 40] });
    }
    $$('.stop').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('a, summary, details')) return;
      const i = Number(el.dataset.i);
      setActive(i, false);
      map.flyTo(markers[i].getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
    }));
    if ('IntersectionObserver' in window) {
      state.observer = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) setActive(Number(en.target.dataset.i)); });
      }, { rootMargin: '-50% 0px -45% 0px' });
      $$('.stop').forEach((el) => state.observer.observe(el));
    }

    if (d.marathon) initMarathon();
    if (focusMarathon) { const el = document.getElementById('maraton'); if (el) el.scrollIntoView(); }
    else if (nowIdx >= 0) { const el = document.getElementById(`b${nowIdx}`); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 50); }
  }

  // ---------- marathon ----------
  function marathonHtml() {
    const M = state.trip.marathon;
    const sections = (M.sections || []).map((s) => `
      <div class="card"><h3>${esc(s.title)}</h3>${(s.body || []).map((p) => `<p>${rich(p)}</p>`).join('')}
      ${(s.items || []).length ? `<ul>${s.items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}
      ${s.source ? `<p class="small"><a href="${attr(s.source)}" target="_blank" rel="noopener">Fuente</a></p>` : ''}</div>`).join('');
    return `
      <section class="section" id="maraton" aria-labelledby="mar-h">
        <h2 id="mar-h">La carrera, kilómetro a kilómetro</h2>
        ${M.notice ? `<div class="notice"><div><strong>${esc(M.notice.title)}</strong><p style="margin:4px 0 0">${rich(M.notice.body)}</p></div></div>` : ''}
        <p class="muted" style="margin-top:14px">Cargá la hora de largada de cada ola y el tiempo objetivo: la tabla calcula a qué hora pasa cada uno por cada punto, con ritmo parejo. Sirve para coordinar el reencuentro y para avisar a quien sigue desde Argentina.</p>
        <div class="runners" id="runners"></div>
        <div class="table-scroll" style="margin-top:14px"><table class="splits" id="splits"></table></div>
        <h2 style="margin-top:28px">Logística</h2>
        <div class="cards">${sections}</div>
      </section>`;
  }
  function initMarathon() {
    const M = state.trip.marathon;
    const waves = M.waves || [];
    const defaults = M.runners || [
      { name: 'Dani', start: waves[0] ? waves[0].start : '09:10', target: '3:50', color: '#ff6319' },
      { name: 'Matías', start: waves[1] ? waves[1].start : '09:35', target: '4:45', color: '#0039a6' },
    ];
    const saved = lsGet(LS_RUNNERS, null);
    const runners = defaults.map((r, i) => ({ ...r, ...(saved && saved[i] ? { start: saved[i].start, target: saved[i].target } : {}) }));
    const box = document.getElementById('runners');
    const waveOptions = (sel) => waves.map((w) => `<option value="${attr(w.start)}"${w.start === sel ? ' selected' : ''}>Ola ${esc(w.wave)} · ${esc(w.start)}</option>`).join('');
    box.innerHTML = runners.map((r, i) => `
      <div class="runner" style="--rc:${attr(r.color)}" data-i="${i}">
        <h3>${esc(r.name)}</h3>
        <label for="st${i}">Largada</label>
        ${waves.length ? `<select id="st${i}" data-k="start">${waveOptions(r.start)}</select>` : `<input id="st${i}" data-k="start" type="time" value="${attr(r.start)}">`}
        <label for="tg${i}">Tiempo objetivo (h:mm)</label>
        <input id="tg${i}" data-k="target" inputmode="numeric" pattern="[0-9]:[0-5][0-9]" value="${attr(r.target)}">
        <p class="pace" id="pace${i}"></p>
      </div>`).join('');
    const course = M.course || { landmarks: [] };
    const notes = M.course_notes || [];
    const rows = (course.landmarks.length ? course.landmarks : notes).map((h) => {
      const extra = notes.find((n) => Math.abs(Number(n.km) - Number(h.km)) < 0.8);
      return { km: Number(h.km), name: h.name, note: extra ? extra.note : h.note };
    });
    function parseTarget(s) { const m = /^(\d):([0-5]\d)$/.exec(String(s).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
    function update() {
      const vals = runners.map((r, i) => {
        const start = $(`#st${i}`).value; const target = $(`#tg${i}`).value;
        r.start = start; r.target = target;
        const tm = parseTarget(target);
        const pace = tm ? tm / 42.195 : null;
        $(`#pace${i}`).textContent = pace ? `Ritmo ${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, '0')} min/km · llega ${fmtMin(toMin(start) + tm)}` : 'Formato h:mm, por ejemplo 4:15';
        return { start: toMin(start), tm };
      });
      lsSet(LS_RUNNERS, runners.map((r) => ({ start: r.start, target: r.target })));
      $('#splits').innerHTML = `<thead><tr><th>km</th><th>Punto</th>${runners.map((r) => `<th style="color:${attr(r.color)}">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `
        <tr><td class="t">${esc(row.km)}</td><td><strong>${esc(row.name)}</strong>${row.note ? `<div class="note">${rich(row.note)}</div>` : ''}</td>
        ${vals.map((v) => `<td class="t">${v.tm ? fmtMin(v.start + (row.km / 42.195) * v.tm) : '–'}</td>`).join('')}</tr>`).join('')}</tbody>`;
    }
    box.addEventListener('input', update);
    box.addEventListener('change', update);
    update();
  }

  // ---------- map page ----------
  function renderMapPage() {
    const t = state.trip;
    const P = t.places;
    const main = new Map(); // placeId -> [dayIdx]
    const alt = new Map();
    t.days.forEach((d, di) => d.blocks.forEach((b) => {
      if (!main.has(b.place)) main.set(b.place, []);
      main.get(b.place).push(di);
      (b.alternatives || []).forEach((a) => { if (!alt.has(a.place)) alt.set(a.place, []); alt.get(a.place).push(di); });
    }));
    const cats = Object.keys(CATEGORY_LABELS).filter((c) => Object.values(P).some((p) => p.category === c));
    view.innerHTML = `
      <div class="wrap section">
        <h2>Mapa</h2>
        <div class="chips" id="daychips" role="group" aria-label="Filtrar por día">
          <button class="chip solo" data-day="all" aria-pressed="true">Todo el viaje</button>
          ${t.days.map((d, i) => `<button class="chip solo" data-day="${i}" aria-pressed="false">${i + 1} · ${esc(weekdayCap(d.date).slice(0, 3))} ${parseISO(d.date).getUTCDate()}</button>`).join('')}
        </div>
        <div class="chips" id="catchips" role="group" aria-label="Filtrar por categoría">
          ${cats.map((c) => `<button class="chip" data-cat="${c}" aria-pressed="true"><span class="dot"></span>${esc(CATEGORY_LABELS[c])}</button>`).join('')}
          <button class="chip" id="altchip" aria-pressed="false">Plan B</button>
        </div>
        <div id="bigmap" class="map map-full"></div>
      </div>`;
    const map = makeMap('bigmap');
    const layer = L.layerGroup().addTo(map);
    let day = 'all';
    const activeCats = new Set(cats);
    let showAlt = false;
    function draw(fit) {
      layer.clearLayers();
      const pts = [];
      Object.values(P).forEach((p) => {
        if (!activeCats.has(p.category)) return;
        const inMain = main.get(p.id), inAlt = alt.get(p.id);
        const matchMain = inMain && (day === 'all' || inMain.includes(Number(day)));
        const matchAlt = showAlt && inAlt && (day === 'all' || inAlt.includes(Number(day)));
        if (!matchMain && !matchAlt) return;
        const label = matchMain ? (day === 'all' ? String(inMain[0] + 1) : String(t.days[Number(day)].blocks.findIndex((b) => b.place === p.id) + 1)) : 'B';
        const when = (inMain || []).map((i) => `${weekdayCap(t.days[i].date)} ${parseISO(t.days[i].date).getUTCDate()}`).join(', ');
        L.marker([p.lat, p.lng], { icon: pinIcon(p.category, label, matchMain ? '' : 'alt') })
          .bindPopup(popupHtml(p, when ? `<br><span class="muted">${esc(when)}</span>` : '<br><span class="muted">Plan B</span>')).addTo(layer);
        pts.push([p.lat, p.lng]);
      });
      if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    }
    $('#daychips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      day = b.dataset.day;
      $$('#daychips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      draw(true);
    });
    $('#catchips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'altchip') { showAlt = !showAlt; b.setAttribute('aria-pressed', String(showAlt)); draw(false); return; }
      const c = b.dataset.cat;
      if (activeCats.has(c)) activeCats.delete(c); else activeCats.add(c);
      b.setAttribute('aria-pressed', String(activeCats.has(c)));
      draw(false);
    });
    draw(true);
  }

  // ---------- reservations ----------
  function renderReservations() {
    const t = state.trip;
    const done = lsGet(LS_RES, {});
    const today = nyParts().date;
    const items = [];
    t.days.forEach((d) => (d.reservations || []).forEach((r, i) => items.push({ ...r, day: d, key: `${d.date}-${i}-${r.what}` })));
    items.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    view.innerHTML = `
      <div class="wrap section">
        <h2>Reservas y entradas</h2>
        <p class="muted">Ordenadas por fecha límite. El tilde queda guardado en este teléfono.</p>
        ${items.length ? '' : '<p class="card">Todavía no hay reservas cargadas: aparecen acá a medida que se verifica cada lugar.</p>'}
        <ul class="checklist">${items.map((r) => {
          const left = r.deadline ? daysBetween(today, r.deadline) : null;
          const cls = left === null ? '' : left < 0 ? 'late' : left <= 7 ? 'soon' : '';
          const dueTxt = left === null ? '' : left < 0 ? `venció el ${dateShort(r.deadline)}` : left === 0 ? 'vence hoy' : `antes del ${dateShort(r.deadline)} · ${left} días`;
          const isDone = !!done[r.key];
          return `<li class="${isDone ? 'done' : ''}"><input type="checkbox" aria-label="Hecho" data-key="${attr(r.key)}" ${isDone ? 'checked' : ''}>
            <div><div class="t">${esc(r.what)}</div>
            <div class="small muted">Para el ${esc(dateLong(r.day.date))}${r.place && t.places[r.place] ? ` · <a href="#/lugar/${attr(r.place)}">${esc(t.places[r.place].name)}</a>` : ''}</div>
            ${r.note ? `<p class="small" style="margin:6px 0 0">${rich(r.note)}</p>` : ''}
            <p style="margin:8px 0 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${dueTxt ? `<span class="due ${isDone ? '' : cls}">${esc(dueTxt)}</span>` : ''}${r.url ? `<a class="btn" href="${attr(r.url)}" target="_blank" rel="noopener">Reservar</a>` : ''}</p></div></li>`;
        }).join('')}</ul>
      </div>`;
    $('.checklist').addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-key]'); if (!cb) return;
      const cur = lsGet(LS_RES, {});
      if (cb.checked) cur[cb.dataset.key] = true; else delete cur[cb.dataset.key];
      lsSet(LS_RES, cur);
      cb.closest('li').classList.toggle('done', cb.checked);
    });
  }

  // ---------- info ----------
  function renderInfo() {
    const t = state.trip;
    const findings = t.findings || [];
    view.innerHTML = `
      <div class="wrap section">
        <h2>Info práctica</h2>
        ${(t.practical || []).length ? '' : '<p class="card">La info práctica (visa, subte, propinas, clima, consulado) se está verificando y aparece acá en la próxima actualización.</p>'}
        <div class="cards">${(t.practical || []).map((x) => `
          <div class="card"><h3>${esc(x.title)}</h3>${String(x.body || '').split(/\n\n+/).map((p) => `<p>${rich(p)}</p>`).join('')}
          ${x.source ? `<p class="small"><a href="${attr(x.source)}" target="_blank" rel="noopener">Fuente</a></p>` : ''}</div>`).join('')}</div>
      </div>
      <div class="wrap section">
        <h2>Sin señal</h2>
        <p class="muted">La guía queda guardada en el teléfono después de abrirla una vez, con las fotos chicas. Este botón baja también las fotos grandes (conviene hacerlo con wifi, en el hotel). El mapa guarda solo las zonas que ya se miraron.</p>
        <button class="btn primary offline-btn" id="offline-btn" type="button">Guardar todo para usar sin señal</button>
        <p class="small muted" id="offline-status" style="margin-top:8px"></p>
      </div>
      ${findings.length ? `<div class="wrap section">
        <h2>Lo que verificamos</h2>
        <p class="muted">Cada punto que podía mover el plan, con su fuente, al ${esc(dateShort(t.generated))}.</p>
        <div class="cards">${findings.map((f) => `<div class="card"><span class="status ${attr(f.status)}">${esc({ ok: 'ok', riesgo: 'riesgo', 'cambia-plan': 'cambia el plan' }[f.status] || f.status)}</span>
          <h3 style="margin-top:8px">${esc(f.topic)}</h3><p>${rich(f.detail)}</p>${f.source ? `<p class="small"><a href="${attr(f.source)}" target="_blank" rel="noopener">Fuente</a></p>` : ''}</div>`).join('')}</div>
      </div>` : ''}
      <div class="wrap footer">Fotos de Wikimedia Commons, con autor y licencia en cada imagen. Mapas © OpenStreetMap. Los ratings muestran la fuente y la fecha de consulta.</div>`;
    const btn = $('#offline-btn');
    const status = $('#offline-status');
    btn.addEventListener('click', async () => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
        status.textContent = 'El modo sin señal se activa cuando la página se abre desde internet (https). Recargá y probá de nuevo.';
        return;
      }
      const urls = [];
      Object.values(t.places).forEach((p) => (p.photos || []).forEach((ph) => { urls.push(ph.src); if (ph.thumb) urls.push(ph.thumb); }));
      if (t.meta && t.meta.hero) urls.push(t.meta.hero.src);
      btn.disabled = true;
      status.textContent = `Guardando ${urls.length} imágenes…`;
      navigator.serviceWorker.controller.postMessage({ type: 'cache-images', urls });
    });
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const status = document.getElementById('offline-status');
      const btn = document.getElementById('offline-btn');
      if (!e.data || e.data.type !== 'cache-progress' || !status) return;
      const finished = e.data.done >= e.data.total;
      status.textContent = finished ? `Listo: ${e.data.total} imágenes guardadas.` : `Guardando… ${e.data.done} de ${e.data.total}`;
      if (finished && btn) btn.disabled = false;
    });
  }

  // ---------- place sheet ----------
  function openSheet(id) {
    const t = state.trip;
    const p = t.places[id];
    if (!p) { location.hash = state.baseHash; return; }
    const photos = p.photos || [];
    const gallery = photos.length
      ? `<div class="gallery">${photos.map((ph) => `<figure><img src="${attr(ph.src)}" alt="${attr(p.name)}" loading="lazy"><figcaption>${creditHtml(ph)}</figcaption></figure>`).join('')}</div>`
      : `<div class="nophoto">No hay fotos libres de este lugar. <a href="${attr(gmapsPlace(p))}" target="_blank" rel="noopener">Ver fotos en Google Maps →</a></div>`;
    const rv = p.reviews || {};
    const facts = [];
    if (p.address) facts.push(['Dirección', `<a href="${attr(gmapsPlace(p))}" target="_blank" rel="noopener">${esc(p.address)}</a>`]);
    if (p.hours) facts.push(['Horario', `${esc(p.hours)}${p.hours_source ? ` · <a href="${attr(p.hours_source)}" target="_blank" rel="noopener">fuente</a>` : ''}`]);
    if (p.price) facts.push(['Precio', esc(p.price)]);
    if (p.duration_min) facts.push(['Tiempo', `${p.duration_min >= 60 ? `${Math.floor(p.duration_min / 60)} h${p.duration_min % 60 ? ` ${p.duration_min % 60} min` : ''}` : `${p.duration_min} min`}`]);
    if (p.booking && p.booking.needed) {
      const b = p.booking;
      facts.push(['Reserva', `${esc(b.needed === 'sí' ? 'Sí' : b.needed === 'no' ? 'No hace falta' : 'Recomendada')}${b.lead ? `, ${esc(b.lead)}` : ''}${b.url ? ` · <a href="${attr(b.url)}" target="_blank" rel="noopener">reservar</a>` : ''}${b.notes ? `<br><span class="small muted">${rich(b.notes)}</span>` : ''}`]);
    }
    if (p.transit && (p.transit.station || (p.transit.lines || []).length)) {
      const tr = p.transit;
      facts.push(['Subte', `${(tr.lines || []).map(lineBullet).join(' ')} ${esc(tr.station || '')}${tr.walk_min ? `, ${esc(tr.walk_min)} min a pie` : ''}${tr.notes ? `<br><span class="small muted">${rich(tr.notes)}</span>` : ''}`]);
    }
    const food = ['comida', 'bar'].includes(p.category);
    const links = p.links || {};
    const linkDefs = [['official', 'Sitio oficial'], ['tickets', 'Entradas'], ['reserve', 'Reservar'], ['menu', 'Menú'], ['instagram', 'Instagram'], ['wikipedia', 'Wikipedia']];
    const linkHtml = linkDefs.filter(([k]) => links[k]).map(([k, label]) => `<a class="btn" href="${attr(links[k])}" target="_blank" rel="noopener">${label}</a>`).join('')
      + `<a class="btn" href="${attr(gmapsPlace(p))}" target="_blank" rel="noopener">Google Maps</a>`;
    const appears = [];
    t.days.forEach((d, di) => d.blocks.forEach((b) => {
      if (b.place === id) appears.push(`<a class="btn" href="#/dia/${d.date}">Día ${di + 1} · ${esc(b.time)} · ${esc(b.title)}</a>`);
      (b.alternatives || []).forEach((a) => { if (a.place === id) appears.push(`<a class="btn" href="#/dia/${d.date}">Plan B del día ${di + 1} · ${esc(b.title)}</a>`); });
    }));

    sheetBody.innerHTML = `
      ${gallery}
      <div class="content" data-cat="${attr(p.category)}">
        <p class="eyebrow" style="color:var(--c)">${esc(CATEGORY_LABELS[p.category] || p.category)} · ${esc(p.neighborhood || '')}</p>
        <h2 id="sheet-title">${esc(p.name)}</h2>
        ${(rv.ratings || []).length ? `<div class="ratings">${rv.ratings.map((r) => `<a href="${attr(r.url)}" target="_blank" rel="noopener" style="text-decoration:none">${ratingHtml(r)}</a>`).join('')}</div>` : ''}
        ${p.why ? `<p>${rich(p.why)}</p>` : ''}
        ${facts.length ? `<h4>Datos</h4><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
        ${(p.what || []).length ? `<h4>${food ? 'Qué pedir' : 'Qué mirar'}</h4><ul class="what">${p.what.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}
        ${p.tip ? `<h4>El dato</h4><p class="tip">${rich(p.tip)}</p>` : ''}
        ${(p.warnings || []).length ? `<h4>Ojo</h4><div class="warn"><ul>${p.warnings.map((x) => `<li>${rich(x)}</li>`).join('')}</ul></div>` : ''}
        ${(rv.consensus || []).length || (rv.press || []).length ? `<h4>Lo que dicen</h4>
          ${(rv.consensus || []).length ? `<ul class="what">${rv.consensus.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : ''}
          ${(rv.press || []).map((q) => `<blockquote class="press" lang="en">"${esc(q.quote)}"<cite><a href="${attr(q.url)}" target="_blank" rel="noopener">${esc(q.outlet)}</a></cite></blockquote>`).join('')}` : ''}
        <h4>Links</h4><div class="links">${linkHtml}</div>
        ${appears.length ? `<h4>En el plan</h4><div class="appears">${appears.join('')}</div>` : ''}
        ${p.checked ? `<p class="checked">Datos verificados el ${esc(dateShort(p.checked))}.</p>` : ''}
      </div>`;
    const wasOpen = !sheet.hidden;
    sheet.hidden = false; backdrop.hidden = false;
    sheet.scrollTop = 0;
    if (!wasOpen) document.body.style.overflow = 'hidden';
    sheet.querySelector('.sheet-close').focus({ preventScroll: true });
  }
  function closeSheet(navigate = true) {
    if (sheet.hidden) return;
    sheet.hidden = true; backdrop.hidden = true;
    document.body.style.overflow = '';
    if (navigate) {
      if (state.sheetOpenedInApp) history.back();
      else location.hash = state.baseHash;
    }
    state.sheetOpenedInApp = false;
  }
  sheet.querySelector('.sheet-close').addEventListener('click', () => closeSheet(true));
  backdrop.addEventListener('click', () => closeSheet(true));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(true); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/lugar/"]');
    if (a) state.sheetOpenedInApp = true;
  });

  // ---------- boot ----------
  async function boot() {
    try {
      const res = await fetch('data/trip.json', { cache: 'no-cache' });
      state.trip = await res.json();
    } catch (e) {
      view.innerHTML = '<div class="wrap"><p class="loading">No pude cargar los datos de la guía. Si no hay señal, abrila una vez con conexión para que quede guardada.</p></div>';
      return;
    }
    window.addEventListener('hashchange', route);
    route();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  boot();
})();
