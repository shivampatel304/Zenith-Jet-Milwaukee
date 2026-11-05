/* Milwaukee Covered Buildings · 3D dashboard (Azzera)
 *
 * INTERNAL USE ONLY. The building and contact data is loaded from ./data and never leaves
 * this browser. Every map source is keyless:
 *   - MapLibre GL JS 5.24.0 + deck.gl 9.4.0 (pinned, from unpkg)
 *   - OpenFreeMap Positron style + OpenMapTiles vector tiles (basemap and the white 3D city)
 *   - AWS Terrain Tiles (Terrarium) for the hillshade
 */

const {
  MapboxOverlay, MVTLayer, GeoJsonLayer, SolidPolygonLayer, PathLayer, ArcLayer,
  ScatterplotLayer, TextLayer, TripsLayer, LightingEffect, AmbientLight, DirectionalLight,
  LayerExtension, DataFilterExtension, WebMercatorViewport,
} = window.deck;

/* ------------------------------------------------------------------ config */

const CONFIG = {
  dataUrl: 'data/milwaukee_data.json',
  lotsUrl: 'data/milwaukee_lots.geojson',
  styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  vectorTiles: 'https://tiles.openfreemap.org/planet',
  terrainTiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  sun: { lat: 43.038, lon: -87.906, month: 9, day: 15, utcOffsetHours: -5 }, // Oct 15, CDT
  defaultMinutes: 14 * 60,
  intro: { center: [-87.95, 43.02], zoom: 10.6, pitch: 50, bearing: -20 },
  home: { center: [-87.906, 43.038], zoom: 13.4, pitch: 55, bearing: -15 },
  cityMinZoom: 13,
};

const FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const UNKNOWN = 'Unknown';
const NO_ENTITY = 'No owner on file';

const STATUS = {
  'named contact': '#16A34A',        // green  — sure: a named person + email/phone
  'company contact only': '#2563EB', // blue   — not sure: a company/mailing lead only
  'not researched yet': '#F59E0B',   // yellow — backlog (rare after enrichment)
  'no contact found': '#EF4444',     // red    — researched, nothing reachable
  'no owner found': '#EF4444',       // red    — no owner on record
};
const KIND = {
  'building owner': '#4F46E5',
};
const SECTOR = {
  '2 - Local Commercial': '#E11D48',
  '4 - Special Mercantile': '#0D9488',
  '7 - Mercantile Apartments': '#7C3AED',
  '9 - Exempt': '#94A3B8',
};
const PRIORITY = {
  A: '#6D28D9', B: '#8B5CF6', C: '#A78BFA',
};
const RESEARCH = {
  'done': '#16A34A', 'partial': '#2563EB', 'to do': '#F59E0B', 'nothing found': '#94A3B8', 'not in research list': '#CBD5E1',
};
const FALLBACK_PALETTE = ['#0EA5E9', '#A855F7', '#F43F5E', '#14B8A6', '#F97316', '#84CC16', '#6366F1', '#EAB308', '#EC4899', '#22C55E'];
const NEUTRAL = '#A3ACB9';
const CONTACT_STATUSES = new Set(['named contact', 'company contact only']);

const SQFT_STEPS = [0, 10000, 25000, 50000, 100000, 150000, 200000, 300000, 500000, 1000000];
const FLOOR_STEPS = [0, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ state */

const S = {
  meta: {}, B: [], E: [], bById: new Map(), eById: new Map(), lotById: new Map(),
  rows: [], groundRows: [], rowsByB: new Map(), mapped: [], notOnMap: [],
  f: {}, minUnits: 0, minFloors: 0, multiOnly: false,
  pass: null, vis: null, forced: new Set(), visKey: 0, styleKey: 0,
  colorBy: 'status', sel: null, hover: null, backTo: null,
  showAll: false, zoom: CONFIG.intro.zoom,
  arcs: [], arcKey: '', labels: [], labelKey: '', labelsShown: [], labelsShownKey: '',
  minutes: CONFIG.defaultMinutes, sun: null,
  raf: 0, orbitRaf: 0, flyToken: 0, tour: null, tourToken: 0,
  ownerKind: 'all', ownerLimit: 60, kpis: {},
};
let map = null;
let overlay = null;

/* ------------------------------------------------------------------ utils */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = new Intl.NumberFormat('en-CA');
const fmt = (n) => (n == null || !Number.isFinite(+n) ? '—' : nf.format(Math.round(+n)));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = (s) => fold(s).replace(/\s+/g, ' ').trim();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null && x !== '') : v ? [v] : []);

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const mixRgb = (a, b, t) => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
const WHITE = [255, 255, 255];

function safeUrl(u) {
  try {
    const x = new URL(String(u).trim());
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
  } catch { return null; }
}
function pillStyle(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const text = lum > 0.72 ? '#475569' : `rgb(${mixRgb([r, g, b], [0, 0, 0], 0.28).join(',')})`;
  return `background:rgba(${r},${g},${b},0.14);color:${text}`;
}
function cap(s) { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- geo helpers ---------- */
const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * R2D;
function metersBetween(a, b) {
  const lat = ((a[1] + b[1]) / 2) * D2R;
  const dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110574;
  return Math.hypot(dx, dy);
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i]; const [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-14) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
// Rounded-square footprint (superellipse) of a given area, rotated to `angle` (radians, east = 0).
function squircle([lon, lat], areaM2, angle = 0, aspect = 1.25, n = 36) {
  const a = Math.sqrt(areaM2 * aspect) / 2;
  const b = areaM2 / (4 * a);
  const kx = 1 / (111320 * Math.cos(lat * D2R));
  const ky = 1 / 110574;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = ((i % n) / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = Math.sign(c) * Math.sqrt(Math.abs(c)) * a;
    const y = Math.sign(s) * Math.sqrt(Math.abs(s)) * b;
    ring.push([lon + (x * ca - y * sa) * kx, lat + (x * sa + y * ca) * ky]);
  }
  return [ring];
}
function ringAreaM2(ring) {
  const lat = ring[0][1] * D2R;
  return Math.abs(ringArea(ring)) * 111320 * Math.cos(lat) * 110574;
}
// Direction of the longest edge, so a stand-in footprint follows the street grid.
function ringAngle(ring) {
  const k = Math.cos(ring[0][1] * D2R);
  let best = 0;
  let ang = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const dx = (ring[i + 1][0] - ring[i][0]) * k;
    const dy = ring[i + 1][1] - ring[i][1];
    const len = dx * dx + dy * dy;
    if (len > best) { best = len; ang = Math.atan2(dy, dx); }
  }
  return ang;
}
const TYPE_FOOTPRINT = [
  [/shopping/, 24000], [/warehouse|manufactur|industrial/, 9000], [/transport|utilit/, 5000], [/grocery|store|dealership/, 4000],
  [/hotel|office/, 2500], [/condo|rental|social|seniors|student|rooming|residential/, 1500],
];
function estFootprint(b) {
  const area = num(b.floor_area_m2);
  if (area > 0) return area / b._floorsEff;
  const t = String(b.building_type || '').toLowerCase();
  for (const [re, v] of TYPE_FOOTPRINT) if (re.test(t)) return v;
  return 2500;
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

/* ------------------------------------------------------------------ sun */

function sunPosition(ms, lat, lon) {
  const d = (ms - 946728000000) / 86400000; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const H = (gmst * 15 + lon) * D2R - ra;
  const phi = lat * D2R;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}

function computeSun(minutes) {
  const c = CONFIG.sun;
  const year = new Date().getFullYear();
  const ms = Date.UTC(year, c.month, c.day, 0, minutes - c.utcOffsetHours * 60);
  const { alt, az } = sunPosition(ms, c.lat, c.lon);
  const altDeg = alt * R2D;
  const k = 1 / Math.tan(Math.max(alt, 7 * D2R)); // cap shadow length near sunset so streets stay readable
  const warm = 1 - smooth(5, 30, altDeg);
  return {
    minutes, ms, alt, az, altDeg, azDeg: az * R2D,
    up: altDeg > 0.5,
    offset: [-Math.sin(az) * k, -Math.cos(az) * k],
    direction: [-Math.sin(az) * Math.cos(alt), -Math.cos(az) * Math.cos(alt), -Math.sin(alt)],
    fill: [Math.sin(az) * 0.6, Math.cos(az) * 0.6, -0.55],
    color: mixRgb([255, 251, 245], [255, 190, 132], warm),
    intensity: 0.45 + 0.6 * smooth(-2, 32, altDeg),
    ambient: 0.92 + 0.08 * smooth(0, 40, altDeg),
    shadow: mixRgb([212, 218, 228], [226, 221, 228], warm).map((v) => v / 255).concat([1]),
    fog: mixRgb([238, 242, 247], [247, 236, 228], warm).map((v) => v / 255),
    sky: mixRgb([214, 228, 243], [238, 222, 214], warm),
    horizon: mixRgb([246, 248, 251], [251, 236, 222], warm),
  };
}

/* ------------------------------------------------------------------ shader extensions */

// Shared uniforms read by the extensions at draw time.
const ATMO = { fogColor: [0.93, 0.95, 0.97, 0.78], fogStart: 2.7, fogEnd: 9.5, baseShade: 0.86 };
const SUNSHADOW = { color: [0.84, 0.86, 0.895, 1], offset: [0.5, 0.8] };

// Distance fog toward the pale horizon + a soft darkening toward the base of the city volumes.
// Distance is clip-space w, which deck.gl expresses in viewport heights, so the fog is zoom-independent.
const atmoBlock = `layout(std140) uniform atmoUniforms {
  vec4 fogColor;
  float fogStart;
  float fogEnd;
  float baseShade;
} atmo;`;
const atmoModule = {
  name: 'atmo',
  vs: `${atmoBlock}\nout float atmo_dist;\nout float atmo_h;\n`,
  fs: `${atmoBlock}\nin float atmo_dist;\nin float atmo_h;\n`,
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': `
      atmo_dist = position.w;
      atmo_h = geometry.position.z / max(project.commonUnitsPerMeter.z, 1e-12);
    `,
    'fs:DECKGL_FILTER_COLOR': `
      color.rgb *= mix(atmo.baseShade, 1.0, smoothstep(0.0, 26.0, atmo_h));
      color.rgb = mix(color.rgb, atmo.fogColor.rgb, atmo.fogColor.a * smoothstep(atmo.fogStart, atmo.fogEnd, atmo_dist));
    `,
  },
  uniformTypes: { fogColor: 'vec4<f32>', fogStart: 'f32', fogEnd: 'f32', baseShade: 'f32' },
  defaultUniforms: { fogColor: [0.93, 0.95, 0.97, 0.78], fogStart: 2.7, fogEnd: 9.5, baseShade: 1 },
  getUniforms: (p) => p,
};
class AtmosphereExtension extends LayerExtension {
  getShaders() { return { modules: [atmoModule] }; }
  draw(params, extension) {
    const baseShade = extension.opts && extension.opts.baseShade === false ? 1 : ATMO.baseShade;
    this.setShaderModuleProps({ atmo: { ...ATMO, baseShade } });
  }
}
AtmosphereExtension.extensionName = 'AtmosphereExtension';
AtmosphereExtension.defaultProps = {};

// Planar sun shadows: each building is redrawn flattened onto the ground along the sun direction.
// Drawn with MIN blending so overlapping shadow faces never stack into darker patches.
const sunBlock = `layout(std140) uniform sunshadowUniforms {
  vec4 color;
  vec2 offset;
} sunshadow;`;
const sunShadowModule = {
  name: 'sunshadow',
  vs: `${sunBlock}\n`,
  fs: `${sunBlock}\n`,
  inject: {
    'vs:DECKGL_FILTER_GL_POSITION': `
      vec4 sunP = geometry.position;
      sunP.xy += sunP.z * sunshadow.offset;
      sunP.z = 0.0;
      position = project_common_position_to_clipspace(sunP);
    `,
    'fs:DECKGL_FILTER_COLOR': `
      color = vec4(sunshadow.color.rgb, 1.0);
    `,
  },
  uniformTypes: { color: 'vec4<f32>', offset: 'vec2<f32>' },
  defaultUniforms: { color: [0.86, 0.875, 0.905, 1], offset: [0, 0] },
  getUniforms: (p) => p,
};
class SunShadowExtension extends LayerExtension {
  getShaders() { return { modules: [sunShadowModule] }; }
  draw() { this.setShaderModuleProps({ sunshadow: { color: SUNSHADOW.color, offset: SUNSHADOW.offset } }); }
}
SunShadowExtension.extensionName = 'SunShadowExtension';
SunShadowExtension.defaultProps = {};

const ATMO_CITY = new AtmosphereExtension();
const ATMO_GLASS = new AtmosphereExtension({ baseShade: false });
const SUN_EXT = new SunShadowExtension();
const FILTER = new DataFilterExtension({ filterSize: 1 });

const SHADOW_PARAMS = {
  depthWriteEnabled: false,
  depthCompare: 'less-equal',
  blend: true,
  blendColorOperation: 'min',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'max',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one',
};
const GLASS_PARAMS = { depthWriteEnabled: false };
const GLASS_VOLUME_PARAMS = { depthWriteEnabled: false, cullMode: 'back' };
const CITY_MATERIAL = { ambient: 0.82, diffuse: 0.34, shininess: 12, specularColor: [18, 18, 18] };
const GLASS_MATERIAL = { ambient: 0.8, diffuse: 0.4, shininess: 90, specularColor: [255, 255, 255] };

/* ------------------------------------------------------------------ lights */

const ambientLight = new AmbientLight({ color: [255, 255, 255], intensity: 1 });
const sunLight = new DirectionalLight({ color: [255, 250, 244], intensity: 1, direction: [-0.3, 0.6, -0.7] });
const fillLight = new DirectionalLight({ color: [226, 234, 248], intensity: 0.22, direction: [0.3, -0.6, -0.5] });
const lighting = new LightingEffect({ ambientLight, sunLight, fillLight });

/* ------------------------------------------------------------------ colours */

const dynamicColors = new Map();
function dynColor(key) {
  if (!dynamicColors.has(key)) dynamicColors.set(key, FALLBACK_PALETTE[dynamicColors.size % FALLBACK_PALETTE.length]);
  return dynamicColors.get(key);
}
const COLOR_MODES = {
  status: { label: 'Contact status', facet: 'status', color: (v) => STATUS[v] || (v === UNKNOWN ? NEUTRAL : dynColor('s:' + v)) },
  sector: { label: 'Sector', facet: 'sector', color: (v) => SECTOR[v] || (v === UNKNOWN ? NEUTRAL : dynColor('c:' + v)) },
  priority: { label: 'Priority', facet: 'priority', color: (v) => PRIORITY[v] || (v === UNKNOWN ? NEUTRAL : dynColor('p:' + v)) },
  kind: { label: 'Entity kind', facet: 'kind', color: (v) => KIND[v] || (v === NO_ENTITY ? '#CBD5E1' : dynColor('k:' + v)) },
};
const kindColor = (k) => KIND[k] || NEUTRAL;
const statusColor = (s) => STATUS[s] || NEUTRAL;

/* ------------------------------------------------------------------ facets */

function priorityLabel(p) {
  const raw = S.meta.priority_labels && S.meta.priority_labels[p];
  return raw ? String(raw).replace(new RegExp('^\\s*' + p + '\\s*[—–-]\\s*'), '') : '';
}

const FACETS = [
  { key: 'form', label: 'Form', get: (b) => b.form || UNKNOWN, open: true },
  { key: 'sector', label: 'Class / sector', get: (b) => b.sector || UNKNOWN, open: true, color: COLOR_MODES.sector.color },
  { key: 'type', label: 'Building type', get: (b) => b.building_type || UNKNOWN, scroll: true },
  {
    key: 'priority', label: 'Priority', get: (b) => b.priority || UNKNOWN, open: true, color: COLOR_MODES.priority.color,
    order: () => Object.keys(S.meta.priority_labels || {}),
    render: (v) => (v === UNKNOWN ? UNKNOWN : `<b>${esc(v)}</b>${esc(priorityLabel(v) || '')}`),
    title: (v) => (S.meta.priority_labels && S.meta.priority_labels[v]) || v,
  },
  {
    key: 'status', label: 'Contact status', get: (b) => b.contact_status || UNKNOWN, open: true, color: COLOR_MODES.status.color,
    order: () => [...Object.keys(STATUS), ...arr(S.meta.contact_status_values)], render: (v) => esc(cap(v)),
  },
  {
    key: 'kind', label: 'Owner kind', get: (b) => (b._e && b._e.kind) || NO_ENTITY, open: true, color: COLOR_MODES.kind.color,
    order: () => [...Object.keys(KIND), NO_ENTITY], render: (v) => esc(cap(v)),
  },
];
const FACET_INDEX = Object.fromEntries(FACETS.map((f, i) => [f.key, i]));

/* ------------------------------------------------------------------ data loading */

async function fetchJSON(url, onProgress) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`Could not reach ${url}. Open the dashboard through a local web server (see README).`);
  }
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}.`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) {
    const json = await res.json();
    onProgress(1);
    return json;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(total ? Math.min(loaded / total, 1) : Math.min(loaded / 5e6, 0.95));
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  onProgress(1);
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(buf));
  } catch (err) {
    throw new Error(`${url} is not valid JSON (${err.message}).`);
  }
}

function defaultFloors(b) {
  const t = String(b.building_type || '').toLowerCase();
  const s = String(b.sector || '').toLowerCase();
  if (t.includes('hotel')) return 8;
  if (/office building - class a|multi story \( ofc/.test(t)) return 10;
  if (t.includes('office')) return 6;
  if (/apartment|apt|ap4|conv apt/.test(t)) return 6;
  if (/multi story warehouse/.test(t)) return 4;
  if (/warehouse|self storage|manufactur|industrial/.test(t)) return 2;
  if (/parking garage|parking ramp/.test(t)) return 4;
  if (/parking lot/.test(t)) return 1;
  if (/store|market|center|department|clinic|medical/.test(t)) return 2;
  if (s.includes('apartment')) return 6;
  if (s.includes('commercial')) return 3;
  if (s.includes('mercantile')) return 2;
  return 3;
}

function prepare(data, lots) {
  S.meta = (data && data.meta) || {};
  S.B = arr(data && data.buildings).filter((b) => b && typeof b === 'object' && b.id != null);
  S.E = arr(data && data.entities).filter((e) => e && typeof e === 'object' && e.id != null);

  for (const e of S.E) {
    e.id = String(e.id);
    e.name = clean(e.name) || '(unnamed)';
    e._b = [];
    S.eById.set(e.id, e);
  }

  for (const f of arr(lots && lots.features)) {
    const id = f && f.properties && f.properties.id;
    const g = f && f.geometry;
    if (id == null || !g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const ok = arr(polys).filter((p) => Array.isArray(p) && validRing(p[0]));
    if (!ok.length) continue;
    const key = String(id);
    S.lotById.set(key, (S.lotById.get(key) || []).concat(ok));
  }

  S.B.forEach((b, i) => {
    b._i = i;
    b.id = String(b.id);
    S.bById.set(b.id, b);
    b.units = num(b.units) ?? 0;
    b.floors = num(b.floors) > 0 ? num(b.floors) : null;
    b._e = b.entity != null ? S.eById.get(String(b.entity)) || null : null;
    if (b._e) b._e._b.push(b);
  });
  // Buildings listed on an entity but without the back-link still belong to it.
  for (const e of S.E) {
    for (const id of arr(e.buildings)) {
      const b = S.bById.get(String(id));
      if (b && !b._e) { b._e = e; e._b.push(b); }
    }
  }

  const sizes = [];
  for (const b of S.B) {
    const polys = S.lotById.get(b.id) || null;
    const lat = num(b.lat);
    const lon = num(b.lon);
    if (lat != null && lon != null && Math.abs(lat) > 1 && Math.abs(lon) > 1) {
      b._pos = [lon, lat];
    } else if (polys) {
      let best = polys[0];
      for (const p of polys) if (Math.abs(ringArea(p[0])) > Math.abs(ringArea(best[0]))) best = p;
      b._pos = ringCentroid(best[0]);
      b._posFromLot = true;
    } else {
      b._pos = null;
    }
    b._floorsEff = b.floors ?? defaultFloors(b);
    b._h = b._floorsEff * 3.5 + 6;
    const area = num(b.floor_area_m2);
    b._size = b.units > 0 ? b.units : area > 0 ? area / 90 : 25;
    sizes.push(b._size);
    b._fv = FACETS.map((f) => f.get(b));
    b._rgb = {};
    for (const [mode, def] of Object.entries(COLOR_MODES)) b._rgb[mode] = hexToRgb(def.color(b._fv[FACET_INDEX[def.facet]]));

    if (!b._pos) { S.notOnMap.push(b); continue; }
    S.mapped.push(b);
    // Lots are close to the building for most towers, but some cover yards, quays or whole cemeteries.
    // When a lot is far larger than the building can be, the lot stays a faint ground tint and the glass
    // volume becomes a building-sized stand-in at the address point.
    const foot = estFootprint(b);
    const lotArea = polys ? polys.reduce((sum, p) => sum + ringAreaM2(p[0]), 0) : 0;
    b._oversized = !!polys && lotArea > 15000 && lotArea / foot > (num(b.floor_area_m2) > 0 ? 6 : 4);
    let shapes = polys;
    if (!polys || b._oversized) {
      const ang = polys ? ringAngle(polys.reduce((m, p) => (ringAreaM2(p[0]) > ringAreaM2(m[0]) ? p : m))[0]) : 0;
      shapes = [squircle(b._pos, clamp(polys ? Math.min(foot, lotArea * 0.4) : foot, 250, 30000), ang)];
    }
    const rows = shapes.map((poly) => ({ b, polygon: poly, top: poly[0].map((c) => [c[0], c[1], b._h + 0.35]) }));
    S.rows.push(...rows);
    S.rowsByB.set(b._i, rows);
    for (const poly of polys || shapes) S.groundRows.push({ b, polygon: poly, big: !!b._oversized });
  }

  sizes.sort((a, c) => a - c);
  const ref = sizes.length ? sizes[Math.floor(sizes.length * 0.995)] || sizes[sizes.length - 1] : 1;
  for (const b of S.mapped) {
    b._beamH = 140 + 2700 * Math.sqrt(Math.min(b._size / ref, 1.35));
    b._base = [b._pos[0], b._pos[1], 0];
    // ArcLayer normalises the horizontal direction, so a perfectly vertical arc would be NaN: nudge the top 10 cm east.
    b._top = [b._pos[0] + 1.2e-6, b._pos[1], b._beamH];
  }

  for (const e of S.E) {
    e._homes = e._b.reduce((s, b) => s + (b.floor_area_sqft || 0), 0);
    e._contacts = arr(e.contacts).filter((c) => c && typeof c === 'object' && (clean(c.name) || c.email || c.phone));
    e._named = e._contacts.filter((c) => clean(c.name)).length;
    e._mapped = e._b.filter((b) => b._pos);
    e._hub = e._mapped.reduce((h, b) => (!h || sizeRank(b) > sizeRank(h) ? b : h), null);
    e._norm = norm(e.name);
  }

  S.f = Object.fromEntries(FACETS.map((f) => [f.key, new Set()]));
  S.pass = new Uint8Array(S.B.length);
  S.vis = new Uint8Array(S.B.length);
  buildSearchIndex();
}

const sizeRank = (b) => b.units * 1e7 + (num(b.floor_area_m2) || 0);

function bestContact(e) {
  if (!e) return null;
  const cs = e._contacts || [];
  return cs.find((c) => c.email && clean(c.name)) || cs.find((c) => c.email) || cs.find((c) => c.phone && clean(c.name)) || cs.find((c) => clean(c.name)) || null;
}

/* ------------------------------------------------------------------ filtering */

function applyFilters({ animate = true } = {}) {
  const counts = FACETS.map(() => new Map());
  const sets = FACETS.map((f) => S.f[f.key]);
  const minU = S.minUnits;
  const minF = S.minFloors;
  for (const b of S.B) {
    const numOk = (b.floor_area_sqft || 0) >= minU && (minF === 0 || (b.floors != null && b.floors >= minF)) && (!S.multiOnly || (b._e && b._e._b.length >= 2));
    let fails = 0;
    let failAt = -1;
    for (let k = 0; k < sets.length; k++) {
      if (sets[k].size && !sets[k].has(b._fv[k])) { fails++; failAt = k; if (fails > 1) break; }
    }
    S.pass[b._i] = numOk && fails === 0 ? 1 : 0;
    if (!numOk) continue;
    if (fails === 0) {
      for (let k = 0; k < sets.length; k++) counts[k].set(b._fv[k], (counts[k].get(b._fv[k]) || 0) + 1);
    } else if (fails === 1) {
      counts[failAt].set(b._fv[failAt], (counts[failAt].get(b._fv[failAt]) || 0) + 1);
    }
  }
  S.facetCounts = counts;
  refreshVisibility();
  updateFacetUI();
  updateKPIs(animate);
  updateLegend();
  updateOwners();
  updateFilterSummary();
}

function refreshVisibility() {
  for (let i = 0; i < S.B.length; i++) S.vis[i] = S.pass[i] || S.forced.has(i) ? 1 : 0;
  S.visKey++;
  S.arcKey = '';
  cullLabels();
  requestRender();
}

const filterValue = (r) => S.vis[(r.b || r)._i];
function activeFilterCount() {
  let n = FACETS.reduce((s, f) => s + (S.f[f.key].size ? 1 : 0), 0);
  if (S.minUnits) n++;
  if (S.minFloors) n++;
  if (S.multiOnly) n++;
  return n;
}

/* ------------------------------------------------------------------ deck layers */

const isDimmed = (b) => S.sel != null && !S.forced.has(b._i);
const footColor = (r) => { const c = r.b._rgb[S.colorBy]; return [c[0], c[1], c[2], (isDimmed(r.b) ? 14 : 54) * (r.big ? 0.45 : 1)]; };
const glassColor = (r) => { const c = r.b._rgb[S.colorBy]; return [c[0], c[1], c[2], isDimmed(r.b) ? 38 : 115]; };
const edgeColor = (r) => { const c = mixRgb(r.b._rgb[S.colorBy], WHITE, 0.12); return [c[0], c[1], c[2], isDimmed(r.b) ? 50 : 235]; };
const glassHighlight = (info) => {
  const b = info && info.object && (info.object.b || info.object);
  const c = b ? mixRgb(b._rgb[S.colorBy], WHITE, 0.1) : [255, 255, 255];
  return [c[0], c[1], c[2], 165];
};
const beamCore0 = (b) => { const c = b._rgb[S.colorBy]; return [c[0], c[1], c[2], isDimmed(b) ? 40 : 235]; };
const beamCore1 = (b) => { const c = b._rgb[S.colorBy]; return [c[0], c[1], c[2], 0]; };
const beamGlow0 = (b) => { const c = b._rgb[S.colorBy]; return [c[0], c[1], c[2], isDimmed(b) ? 10 : 64]; };
const dotColor = (b) => { const c = b._rgb[S.colorBy]; return [c[0], c[1], c[2], isDimmed(b) ? 70 : 255]; };
const cityHeight = (f) => { const h = +(f && f.properties && f.properties.render_height); return h > 0 ? h : 5; };

function renderCitySubLayers(props) {
  const ext = props.extensions || [];
  // Distant (lower-zoom) tiles sit in the fog: skip their shadow pass.
  const nearTile = !props.tile || props.tile.index.z >= 14;
  return [
    S.sun && S.sun.up && nearTile && new GeoJsonLayer({
      ...props,
      id: `${props.id}-shadow`,
      extensions: [...ext, SUN_EXT],
      material: false,
      parameters: SHADOW_PARAMS,
      getFillColor: [0, 0, 0, 255],
    }),
    new GeoJsonLayer({ ...props, extensions: [...ext, ATMO_CITY] }),
  ];
}

function buildLayers() {
  const z = S.zoom;
  const beamA = 1 - smooth(11.8, 12.9, z);
  const glassA = smooth(12.25, 13.3, z);
  const now = performance.now() / 1000;
  const layers = [];
  const trig = { getFilterValue: S.visKey };
  const style = `${S.colorBy}|${S.styleKey}`;

  if (glassA > 0.01) {
    layers.push(new SolidPolygonLayer({
      id: 'lot-footprints', data: S.groundRows, getPolygon: (r) => r.polygon, extruded: false,
      getFillColor: footColor, opacity: glassA, parameters: GLASS_PARAMS,
      extensions: [FILTER], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getFillColor: style },
    }));
  }

  layers.push(new MVTLayer({
    id: 'city',
    data: CONFIG.vectorTiles,
    minZoom: CONFIG.cityMinZoom,
    maxZoom: 14,
    visible: z >= 12.85,
    loadOptions: { mvt: { layers: ['building'] } },
    extruded: true, filled: true, stroked: false, pickable: false,
    getElevation: cityHeight,
    getFillColor: [247, 247, 245, 255],
    material: CITY_MATERIAL,
    refinementStrategy: 'no-overlap',
    maxRequests: 8,
    renderSubLayers: renderCitySubLayers,
    sunUp: !!(S.sun && S.sun.up),
  }));

  if (glassA > 0.01) {
    layers.push(new SolidPolygonLayer({
      id: 'glass', data: S.rows, getPolygon: (r) => r.polygon, extruded: true, getElevation: (r) => r.b._h,
      getFillColor: glassColor, opacity: glassA, material: GLASS_MATERIAL, parameters: GLASS_VOLUME_PARAMS,
      pickable: glassA > 0.4, autoHighlight: true, highlightColor: glassHighlight,
      onHover: onHoverObject, onClick: onClickObject,
      extensions: [FILTER, ATMO_GLASS], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getFillColor: style },
    }));
    layers.push(new PathLayer({
      id: 'glass-edges', data: S.rows, getPath: (r) => r.top, getColor: edgeColor, getWidth: 1.4,
      widthUnits: 'pixels', jointRounded: true, opacity: glassA, parameters: GLASS_PARAMS,
      extensions: [FILTER, ATMO_GLASS], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getColor: style },
    }));
  }

  layers.push(...selectionLayers(now));

  if (beamA > 0.01) {
    layers.push(new ArcLayer({
      id: 'beam-glow', data: S.mapped, getSourcePosition: (b) => b._base, getTargetPosition: (b) => b._top,
      getSourceColor: beamGlow0, getTargetColor: beamCore1, getWidth: 5.5, getHeight: 0, widthUnits: 'pixels', numSegments: 2,
      opacity: beamA, parameters: GLASS_PARAMS,
      extensions: [FILTER], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getSourceColor: style, getTargetColor: style },
    }));
    layers.push(new ArcLayer({
      id: 'beam-core', data: S.mapped, getSourcePosition: (b) => b._base, getTargetPosition: (b) => b._top,
      getSourceColor: beamCore0, getTargetColor: beamCore1, getWidth: 1.5, getHeight: 0, widthUnits: 'pixels', numSegments: 2,
      opacity: beamA, parameters: GLASS_PARAMS,
      extensions: [FILTER], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getSourceColor: style, getTargetColor: style },
    }));
  }
  const dotA = 1 - smooth(12.4, 13.35, z);
  if (dotA > 0.04) {
    layers.push(new ScatterplotLayer({
      id: 'beam-base', data: S.mapped, getPosition: (b) => b._pos, getRadius: 26, radiusUnits: 'meters',
      radiusMinPixels: 2.3, radiusMaxPixels: 6, getFillColor: dotColor, stroked: true, getLineColor: [255, 255, 255, 230],
      lineWidthUnits: 'pixels', getLineWidth: 1, opacity: dotA, parameters: { depthWriteEnabled: false },
      pickable: glassA < 0.6, autoHighlight: true, highlightColor: [17, 24, 39, 200],
      onHover: onHoverObject, onClick: onClickObject,
      extensions: [FILTER], getFilterValue: filterValue, filterRange: [0.5, 1.5],
      updateTriggers: { ...trig, getFillColor: style },
    }));
  }

  const arcs = activeArcs();
  if (arcs.length) {
    const cycle = 1400;
    layers.push(new ArcLayer({
      id: 'links', data: arcs, getSourcePosition: (a) => a.s, getTargetPosition: (a) => a.t,
      getSourceColor: (a) => a.c0, getTargetColor: (a) => a.c1, getHeight: (a) => a.h, getWidth: (a) => a.w,
      widthUnits: 'pixels', numSegments: 48, parameters: GLASS_PARAMS,
    }));
    layers.push(new TripsLayer({
      id: 'link-pulses', data: arcs, getPath: (a) => a.path, getTimestamps: (a) => a.ts,
      positionFormat: 'XYZ', getColor: (a) => a.pc, getWidth: (a) => a.pw, widthUnits: 'pixels', capRounded: true, jointRounded: true,
      fadeTrail: true, trailLength: 300, currentTime: reducedMotion ? 1000 : (now * 560) % cycle,
      parameters: GLASS_PARAMS, _pathType: 'open',
    }));
  }

  const labels = S.labelsShown;
  if (labels.length && z > 11.5) {
    layers.push(new TextLayer({
      id: 'labels', data: labels,
      getPosition: (b) => [b._pos[0], b._pos[1], b._h + 4], getText: labelText,
      getSize: 12, sizeUnits: 'pixels', getColor: [17, 24, 39, 255], fontFamily: FONT, fontWeight: 600,
      lineHeight: 1.3, characterSet: 'auto', billboard: true,
      background: true, getBackgroundColor: [255, 255, 255, 238], backgroundPadding: [7, 4, 7, 4],
      getBorderColor: [229, 231, 235, 255], getBorderWidth: 1, backgroundBorderRadius: 6,
      getTextAnchor: 'middle', getAlignmentBaseline: 'bottom', getPixelOffset: [0, -6],
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
    }));
  }
  return layers;
}

function labelText(b) {
  const second = b.floor_area_sqft > 0 ? `${fmt(b.floor_area_sqft)} sq ft` : clean(b.building_type) || clean(b.sector);
  return `${clean(b.address)}\n${second}`;
}

function selectionLayers(now) {
  const out = [];
  if (!S.sel) return out;
  const phase = reducedMotion ? 0.5 : (now * 0.55) % 1;
  const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now * 3.2);
  if (S.sel.type === 'building' && S.sel.b._pos) {
    const b = S.sel.b;
    const rows = S.rowsByB.get(b._i) || [];
    const c = mixRgb(b._rgb[S.colorBy], [17, 24, 39], 0.22); // a touch darker so pale statuses still read
    out.push(new SolidPolygonLayer({
      id: 'sel-volume', data: rows, getPolygon: (r) => r.polygon, extruded: true, getElevation: (r) => r.b._h + 0.6,
      getFillColor: [c[0], c[1], c[2], 255], opacity: 0.12 + 0.2 * breathe, material: GLASS_MATERIAL, parameters: GLASS_PARAMS,
      updateTriggers: { getFillColor: S.colorBy },
    }));
    out.push(new PathLayer({
      id: 'sel-top', data: rows, getPath: (r) => r.top, getColor: [c[0], c[1], c[2], 255], getWidth: 3,
      widthUnits: 'pixels', jointRounded: true, parameters: GLASS_PARAMS, updateTriggers: { getColor: S.colorBy },
    }));
    out.push(new ScatterplotLayer({
      id: 'sel-ring', data: [b], getPosition: (x) => x._pos, getRadius: 1, radiusScale: 18 + Math.max(60, b._h * 1.2) * phase,
      stroked: true, filled: false, getLineColor: [c[0], c[1], c[2], 255], lineWidthUnits: 'pixels', getLineWidth: 2.2,
      opacity: 1 - phase, parameters: { depthWriteEnabled: false }, updateTriggers: { getLineColor: S.colorBy },
    }));
  } else if (S.sel.type === 'entity') {
    const e = S.sel.e;
    const col = hexToRgb(kindColor(e.kind));
    out.push(new ScatterplotLayer({
      id: 'sel-rings', data: e._mapped, getPosition: (x) => x._pos, getRadius: 1, radiusScale: 14 + 70 * phase,
      stroked: true, filled: false, getLineColor: [col[0], col[1], col[2], 255], lineWidthUnits: 'pixels', getLineWidth: 1.6,
      opacity: (1 - phase) * 0.9, parameters: { depthWriteEnabled: false },
    }));
  }
  return out;
}

/* ---------- portfolio links ---------- */

function makeArc(hub, b, color, bold) {
  const s = hub._pos;
  const t = b._pos;
  const dist = Math.max(metersBetween(s, t), 1);
  const h = bold ? clamp(Math.max(0.3, 560 / dist), 0.3, 6) : clamp(Math.max(0.16, 260 / dist), 0.16, 4);
  // Same curve as ArcLayer (flat interpolation in Web Mercator, height = sqrt(r(1-r)) * distance * h),
  // as a flat XYZ array: TripsLayer with _pathType 'open' skips normalisation and expects flat paths.
  const N = 40;
  const path = new Float64Array((N + 1) * 3);
  const ts = new Float32Array(N + 1);
  const ys = mercY(s[1]);
  const yt = mercY(t[1]);
  for (let i = 0; i <= N; i++) {
    const r = i / N;
    path[i * 3] = lerp(s[0], t[0], r);
    path[i * 3 + 1] = invMercY(lerp(ys, yt, r));
    path[i * 3 + 2] = Math.sqrt(r * (1 - r)) * dist * h;
    ts[i] = r * 1000;
  }
  const bright = mixRgb(color, WHITE, 0.35);
  return {
    s: [s[0], s[1], 0], t: [t[0], t[1], 0], h, path, ts,
    c0: [color[0], color[1], color[2], bold ? 235 : 78],
    c1: [bright[0], bright[1], bright[2], bold ? 170 : 34],
    w: bold ? 2.2 : 0.9,
    pc: bold ? [bright[0], bright[1], bright[2], 255] : [bright[0], bright[1], bright[2], 150],
    pw: bold ? 4.5 : 1.8,
  };
}

function entityArcs(e, members, bold) {
  const pts = members.filter((b) => b._pos);
  if (pts.length < 2) return [];
  let hub = e._hub && pts.includes(e._hub) ? e._hub : pts[0];
  if (hub !== e._hub) for (const b of pts) if (sizeRank(b) > sizeRank(hub)) hub = b;
  const col = hexToRgb(kindColor(e.kind));
  const out = [];
  // Buildings that share the hub's address point get no arc (a zero-length arc also breaks TripsLayer).
  for (const b of pts) if (b !== hub && metersBetween(hub._pos, b._pos) > 5) out.push(makeArc(hub, b, col, bold));
  return out;
}

function focusEntities() {
  const out = [];
  const selE = S.sel ? (S.sel.type === 'entity' ? S.sel.e : S.sel.b._e) : null;
  if (selE) out.push(selE);
  const hovE = S.hover && S.hover._e;
  if (hovE && hovE !== selE) out.push(hovE);
  return out;
}

function activeArcs() {
  const focus = focusEntities();
  const key = `${S.showAll ? 'all:' + S.visKey : 'none'}|${focus.map((e) => e.id).join(',')}|${S.visKey}`;
  if (key === S.arcKey) return S.arcs;
  S.arcKey = key;
  const arcs = [];
  const focusSet = new Set(focus);
  if (S.showAll) {
    const groups = new Map();
    for (const b of S.mapped) {
      if (!S.pass[b._i] || !b._e || focusSet.has(b._e)) continue;
      if (!groups.has(b._e)) groups.set(b._e, []);
      groups.get(b._e).push(b);
    }
    for (const [e, members] of groups) if (members.length > 1) arcs.push(...entityArcs(e, members, false));
  }
  for (const e of focus) arcs.push(...entityArcs(e, e._mapped.filter((b) => S.vis[b._i]), true));
  S.arcs = arcs;
  return arcs;
}

function activeLabels() {
  const e = S.sel ? (S.sel.type === 'entity' ? S.sel.e : S.sel.b._e) : null;
  const key = S.sel ? `${S.sel.type}:${e ? e.id : S.sel.b.id}|${S.visKey}` : '';
  if (key === S.labelKey) return S.labels;
  S.labelKey = key;
  if (!S.sel) S.labels = [];
  else if (e) S.labels = e._mapped.filter((b) => S.vis[b._i]);
  else S.labels = S.sel.b._pos ? [S.sel.b] : [];
  return S.labels;
}

// Label decluttering on the CPU (deck's GPU collision filter does not work in interleaved mode).
// Biggest buildings win; the selected building always wins. Re-run while the camera moves.
const labelPriority = (b) => (S.sel && S.sel.type === 'building' && S.sel.b === b ? 1e12 : b._size);
function cullLabels() {
  const all = activeLabels();
  if (!all.length || !map) {
    if (S.labelsShown.length) { S.labelsShown = []; S.labelsShownKey = ''; requestRender(); }
    return;
  }
  const canvas = map.getCanvas();
  const c = map.getCenter();
  const vp = new WebMercatorViewport({
    width: canvas.clientWidth, height: canvas.clientHeight, longitude: c.lng, latitude: c.lat,
    zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding(),
  });
  const sorted = [...all].sort((a, b) => labelPriority(b) - labelPriority(a));
  const boxes = [];
  const out = [];
  for (const b of sorted) {
    const [x, y] = vp.project([b._pos[0], b._pos[1], b._h + 4]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -40 || y < 0 || x > vp.width + 40 || y > vp.height + 40) continue;
    const lines = labelText(b).split('\n');
    const w = Math.max(...lines.map((l) => l.length)) * 6.9 + 18;
    const box = [x - w / 2, y - 48, x + w / 2, y - 4];
    if (boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
    boxes.push(box);
    out.push(b);
    if (out.length >= 80) break;
  }
  const key = out.map((b) => b._i).join(',');
  if (key !== S.labelsShownKey) { S.labelsShownKey = key; S.labelsShown = out; requestRender(); }
}
let cullTimer = 0;
function scheduleCull() {
  if (cullTimer) return;
  cullTimer = setTimeout(() => { cullTimer = 0; cullLabels(); }, 120);
}

/* ---------- render loop ---------- */

function isAnimating() {
  return !document.hidden && !reducedMotion && (S.arcs.length > 0 || S.sel != null);
}
function frame() {
  S.raf = 0;
  if (!overlay) return;
  overlay.setProps({ layers: buildLayers() });
  if (isAnimating()) S.raf = requestAnimationFrame(frame);
}
function requestRender() {
  if (!S.raf && overlay) S.raf = requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', requestRender);

/* ------------------------------------------------------------------ basemap */

function restyleBasemap(style) {
  const P = {
    land: '#F5F5F2', park: '#E7EDE3', wood: '#E2E9DE', water: '#D3DEE7', waterway: '#C9D6E1', residential: '#F1F1EE',
    road: '#E5E5E1', major: '#DEDEDA', motorway: '#D6D6D2', rail: '#E1E1DD', label: '#8B95A3', labelStrong: '#4B5563', water_label: '#8AA0B4',
  };
  if (style.sources) delete style.sources.ne2_shaded;
  style.sources.terrain = {
    type: 'raster-dem', tiles: [CONFIG.terrainTiles], encoding: 'terrarium', tileSize: 256, maxzoom: 13,
    attribution: 'Relief: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">AWS Terrain Tiles</a> (Mapzen)',
  };
  style.sky = {
    'sky-color': '#D8E5F3', 'horizon-color': '#F4F7FA', 'fog-color': '#F1F4F8',
    'sky-horizon-blend': 0.65, 'horizon-fog-blend': 0.75, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0,
  };
  const hillshade = {
    id: 'hillshade', type: 'hillshade', source: 'terrain',
    paint: {
      'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#9EA8B5', 'hillshade-highlight-color': '#FFFFFF',
      'hillshade-accent-color': '#D3D9E0', 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 215,
    },
  };
  const drop = /^building$|boundary|shield|airport|aeroway-taxiway|highway-name-path|highway-name-minor|waterway_line_label|label_country|label_state|dashline|casing|highway_path|road_pier|road_area_pier|landcover_ice|landcover_glacier/;
  const width = {
    minor: ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.3, 14, 0.9, 16, 2.6, 18, 8],
    major: ['interpolate', ['exponential', 1.5], ['zoom'], 10, 0.5, 13, 1.2, 15, 2.6, 17, 7, 19, 16],
    motorway: ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.6, 12, 1.6, 15, 3.4, 17, 8, 19, 18],
  };
  const out = [];
  for (const l of style.layers || []) {
    if (drop.test(l.id)) continue;
    const p = (l.paint = l.paint || {});
    const id = l.id;
    if (id === 'background') p['background-color'] = P.land;
    else if (id === 'park') { p['fill-color'] = P.park; p['fill-opacity'] = 1; }
    else if (id === 'water') p['fill-color'] = P.water;
    else if (id === 'landuse_residential') { p['fill-color'] = P.residential; p['fill-opacity'] = 0.7; }
    else if (id === 'landcover_wood') { p['fill-color'] = P.wood; p['fill-opacity'] = 0.8; }
    else if (id === 'waterway') p['line-color'] = P.waterway;
    else if (id.startsWith('aeroway')) { if (l.type === 'fill') p['fill-color'] = '#EFEFEC'; else p['line-color'] = '#ECECE8'; }
    else if (id.startsWith('railway')) { p['line-color'] = P.rail; }
    else if (/motorway/.test(id) && l.type === 'line') { p['line-color'] = P.motorway; p['line-width'] = width.motorway; }
    else if (/highway_major/.test(id) && l.type === 'line') { p['line-color'] = P.major; p['line-width'] = width.major; }
    else if (id === 'highway_minor') { p['line-color'] = P.road; p['line-width'] = width.minor; }
    else if (/^water_name/.test(id)) { p['text-color'] = P.water_label; p['text-halo-color'] = 'rgba(245,247,250,0.9)'; }
    else if (id === 'highway-name-major') { p['text-color'] = '#A1A8B3'; p['text-halo-color'] = '#FFFFFF'; l.minzoom = 14.5; }
    else if (id === 'label_other') { p['text-color'] = P.label; p['text-halo-color'] = 'rgba(255,255,255,0.95)'; }
    else if (/^label_/.test(id)) { p['text-color'] = P.labelStrong; p['text-halo-color'] = 'rgba(255,255,255,0.95)'; }
    out.push(l);
    if (id === 'landcover_wood') out.push(hillshade);
  }
  if (!out.includes(hillshade)) {
    const i = out.findIndex((l) => l.type === 'line');
    out.splice(i < 0 ? out.length : i, 0, hillshade);
  }
  style.layers = out;
  return style;
}

/* ------------------------------------------------------------------ sun & atmosphere */

function applySun(minutes) {
  S.minutes = minutes;
  const sun = (S.sun = computeSun(minutes));
  sunLight.direction = sun.direction;
  sunLight.color = sun.color;
  sunLight.intensity = sun.intensity;
  fillLight.direction = sun.fill;
  ambientLight.intensity = sun.ambient;
  SUNSHADOW.offset = sun.offset;
  SUNSHADOW.color = sun.shadow;
  ATMO.fogColor = [...sun.fog, 0.78];
  if (map && map.isStyleLoaded()) {
    if (map.getLayer('hillshade')) map.setPaintProperty('hillshade', 'hillshade-illumination-direction', Math.round(sun.azDeg) % 360);
    const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    try {
      map.setSky({
        'sky-color': toHex(sun.sky), 'horizon-color': toHex(sun.horizon), 'fog-color': toHex(sun.fog.map((v) => Math.round(v * 255))),
        'sky-horizon-blend': 0.65, 'horizon-fog-blend': 0.75, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0,
      });
    } catch { /* sky is decorative */ }
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  $('#time-label').textContent = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const slider = $('#time-slider');
  slider.value = minutes;
  $$('#time-presets button').forEach((btn) => btn.classList.toggle('is-active', Math.abs(+btn.dataset.t - minutes) < 15));
  if (map) map.triggerRepaint();
  requestRender();
}

/* ------------------------------------------------------------------ UI: facets */

function facetValues(f) {
  const counts = new Map();
  for (const b of S.B) { const v = b._fv[FACET_INDEX[f.key]]; counts.set(v, (counts.get(v) || 0) + 1); }
  let values = [...counts.keys()];
  if (f.order) {
    const order = f.order();
    values.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      if (a === UNKNOWN || a === NO_ENTITY) return 1;
      if (b === UNKNOWN || b === NO_ENTITY) return -1;
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || String(a).localeCompare(b);
    });
  } else if (f.sort === 'alpha') {
    values.sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || String(a).localeCompare(b, 'fr'));
  } else {
    values.sort((a, b) => (a === UNKNOWN) - (b === UNKNOWN) || counts.get(b) - counts.get(a));
  }
  return values;
}

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';
const CHEV_SVG = '<svg class="icon chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>';

function buildFacetsUI() {
  const root = $('#facets');
  root.innerHTML = '';
  S.facetRefs = {};
  for (const f of FACETS) {
    const det = document.createElement('details');
    det.className = 'facet';
    det.open = !!f.open;
    det.innerHTML = `<summary>${esc(f.label)} <span class="facet-active" hidden></span>${CHEV_SVG}</summary>
      <div class="facet-body"><div class="opts${f.scroll ? ' scroll' : ''}"></div></div>`;
    const opts = det.querySelector('.opts');
    const refs = new Map();
    for (const v of facetValues(f)) {
      const lab = document.createElement('label');
      lab.className = 'opt';
      const color = f.color ? f.color(v) : null;
      const text = f.render ? f.render(v) : esc(v);
      const title = f.title ? f.title(v) : v;
      lab.innerHTML = `<input type="checkbox"><span class="box">${CHECK_SVG}</span>${color ? `<span class="dot" style="background:${color}"></span>` : ''}<span class="opt-l" title="${esc(title)}">${text}</span><span class="opt-c">0</span>`;
      const input = lab.querySelector('input');
      input.addEventListener('change', () => {
        if (input.checked) S.f[f.key].add(v); else S.f[f.key].delete(v);
        applyFilters();
      });
      refs.set(v, { lab, input, count: lab.querySelector('.opt-c') });
      opts.appendChild(lab);
    }
    S.facetRefs[f.key] = { det, refs, badge: det.querySelector('.facet-active') };
    root.appendChild(det);
  }

  const size = document.createElement('details');
  size.className = 'facet';
  size.open = true;
  size.innerHTML = `<summary>Size &amp; portfolio <span class="facet-active" hidden></span>${CHEV_SVG}</summary>
    <div class="facet-body">
      <div class="range-row">
        <div class="range-head"><span>Minimum sq ft</span><b id="min-units-v">Any</b></div>
        <input type="range" id="min-units" min="0" max="${SQFT_STEPS.length - 1}" step="1" value="0" aria-label="Minimum sq ft">
      </div>
      <div class="range-row">
        <div class="range-head"><span>Minimum floors</span><b id="min-floors-v">Any</b></div>
        <input type="range" id="min-floors" min="0" max="${FLOOR_STEPS.length - 1}" step="1" value="0" aria-label="Minimum floors">
      </div>
      <label class="opt"><input type="checkbox" id="multi-only"><span class="box">${CHECK_SVG}</span><span class="opt-l">Only owners with 2+ buildings</span></label>
    </div>`;
  root.appendChild(size);
  S.sizeBadge = size.querySelector('.facet-active');

  const units = $('#min-units');
  const floors = $('#min-floors');
  const paintRange = (el) => el.style.setProperty('--fill', `${(el.value / el.max) * 100}%`);
  units.addEventListener('input', () => {
    S.minUnits = SQFT_STEPS[+units.value];
    $('#min-units-v').textContent = S.minUnits ? `≥ ${fmt(S.minUnits)}` : 'Any';
    paintRange(units);
    applyFilters();
  });
  floors.addEventListener('input', () => {
    S.minFloors = FLOOR_STEPS[+floors.value];
    $('#min-floors-v').textContent = S.minFloors ? `≥ ${S.minFloors}` : 'Any';
    paintRange(floors);
    applyFilters();
  });
  $('#multi-only').addEventListener('change', (ev) => { S.multiOnly = ev.target.checked; applyFilters(); });
  paintRange(units);
  paintRange(floors);
}

function updateFacetUI() {
  FACETS.forEach((f, k) => {
    const ref = S.facetRefs[f.key];
    for (const [v, r] of ref.refs) {
      const c = S.facetCounts[k].get(v) || 0;
      r.count.textContent = fmt(c);
      r.lab.classList.toggle('is-zero', c === 0 && !r.input.checked);
      r.input.checked = S.f[f.key].has(v);
    }
    const n = S.f[f.key].size;
    ref.badge.hidden = !n;
    ref.badge.textContent = n;
  });
  const sizeN = (S.minUnits ? 1 : 0) + (S.minFloors ? 1 : 0) + (S.multiOnly ? 1 : 0);
  S.sizeBadge.hidden = !sizeN;
  S.sizeBadge.textContent = sizeN;
}

function resetFilters() {
  for (const f of FACETS) S.f[f.key].clear();
  S.minUnits = 0; S.minFloors = 0; S.multiOnly = false;
  const u = $('#min-units'); const fl = $('#min-floors');
  u.value = 0; fl.value = 0;
  u.style.setProperty('--fill', '0%'); fl.style.setProperty('--fill', '0%');
  $('#min-units-v').textContent = 'Any'; $('#min-floors-v').textContent = 'Any';
  $('#multi-only').checked = false;
  applyFilters();
}

function updateFilterSummary() {
  const n = S.pass.reduce((s, v) => s + v, 0);
  const active = activeFilterCount();
  $('#filter-summary').textContent = active ? `${fmt(n)} of ${fmt(S.B.length)} buildings · ${active} filter${active > 1 ? 's' : ''}` : `All ${fmt(S.B.length)} buildings`;
  $('#filters-reset').hidden = !active;
  $('#left-open-count').textContent = active ? active : '';
  $('#export-buildings span').textContent = `Export CSV (${fmt(n)})`;
}

/* ------------------------------------------------------------------ UI: KPIs */

function animateNumber(el, to, format) {
  const from = +(el.dataset.v || 0);
  el.dataset.v = to;
  cancelAnimationFrame(el._raf);
  if (reducedMotion || from === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const D = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / D);
    el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

function updateKPIs(animate = true) {
  let n = 0; let area = 0; let withC = 0;
  const ents = new Set();
  for (const b of S.B) {
    if (!S.pass[b._i]) continue;
    n++;
    area += (b.floor_area_sqft || 0);
    if (CONTACT_STATUSES.has(b.contact_status)) withC++;
    if (b._e) ents.add(b._e);
  }
  let named = 0;
  for (const e of ents) named += e._named;
  const vals = { buildings: n, entities: ents.size, named, area, pct: n ? (withC / n) * 100 : 0 };
  for (const [k, v] of Object.entries(vals)) {
    const el = $(`[data-kpi="${k}"]`);
    const format = k === 'pct' ? (x) => `${Math.round(x)}%` : (x) => fmt(x);
    if (animate) animateNumber(el, v, format); else { el.dataset.v = v; el.textContent = format(v); }
  }
  S.kpis = vals;
}

/* ------------------------------------------------------------------ UI: legend */

function updateLegend() {
  const mode = COLOR_MODES[S.colorBy];
  const k = FACET_INDEX[mode.facet];
  const counts = new Map();
  for (const b of S.B) if (S.pass[b._i]) counts.set(b._fv[k], (counts.get(b._fv[k]) || 0) + 1);
  const values = facetValues(FACETS[k]);
  const set = S.f[mode.facet];
  const ul = $('#legend-items');
  ul.innerHTML = values.map((v) => {
    const label = mode.facet === 'priority' && v !== UNKNOWN ? `${v} — ${priorityLabel(v)}` : cap(v);
    const off = set.size && !set.has(v);
    return `<li><button data-v="${esc(v)}" class="${off ? 'is-off' : ''}" title="Filter to ${esc(label)}">
      <span class="sw" style="background:${mode.color(v)}"></span><span class="lg-l">${esc(label)}</span><span class="lg-c">${fmt(counts.get(v) || 0)}</span></button></li>`;
  }).join('');
}

function setColorBy(mode) {
  if (!COLOR_MODES[mode]) return;
  S.colorBy = mode;
  $$('#colorby button').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('is-active', on); b.setAttribute('aria-checked', on); });
  S.styleKey++;
  updateLegend();
  requestRender();
  if (S.sel) renderDetail();
}

/* ------------------------------------------------------------------ UI: top owners */

function rankEntities() {
  const counts = new Map();
  for (const b of S.B) if (S.pass[b._i] && b._e) counts.set(b._e, (counts.get(b._e) || 0) + 1);
  return [...counts].map(([e, n]) => ({ e, n })).sort((a, b) => b.n - a.n || b.e._homes - a.e._homes || a.e.name.localeCompare(b.e.name));
}

function updateOwners() {
  const ranked = rankEntities().filter((x) => S.ownerKind === 'all' || x.e.kind === S.ownerKind);
  const list = ranked.slice(0, S.ownerLimit);
  const max = list.length ? list[0].n : 1;
  const sel = S.sel && (S.sel.type === 'entity' ? S.sel.e : null);
  $('#owners-note').textContent = ranked.length ? `${fmt(ranked.length)} owners / managers with buildings in view, ranked by building count.` : 'No owners / managers match the current filters.';
  $('#owner-list').innerHTML = list.map(({ e, n }) => {
    const col = kindColor(e.kind);
    const total = e._b.length;
    return `<li class="owner-item"><button data-entity="${esc(e.id)}" class="${sel === e ? 'is-selected' : ''}">
      <span class="rank"></span><span class="o-name" title="${esc(e.name)}">${esc(e.name)}</span><span class="o-count">${fmt(n)}${n !== total ? `<span class="muted small"> / ${fmt(total)}</span>` : ''}</span>
      <span class="o-sub"><span class="kind-dot" style="background:${col}"></span><span>${esc(cap(e.kind))} · ${fmt(e._homes)} sq ft</span></span>
      <span class="o-bar"><i style="width:${(n / max) * 100}%;background:${col}"></i></span>
    </button></li>`;
  }).join('');
  $('#owners-more').hidden = ranked.length <= S.ownerLimit;
}

function buildOwnerKinds() {
  const kinds = [['all', 'All'], ...Object.keys(KIND).map((k) => [k, cap(k) + 's'])];
  const extra = [...new Set(S.E.map((e) => e.kind).filter((k) => k && !KIND[k]))];
  for (const k of extra) kinds.push([k, cap(k)]);
  $('#owner-kinds').innerHTML = kinds.map(([k, l]) => `<button data-kind="${esc(k)}" class="${k === S.ownerKind ? 'is-active' : ''}">${k !== 'all' ? `<span class="kind-dot" style="background:${kindColor(k)}"></span>` : ''}${esc(l)}</button>`).join('');
}

/* ------------------------------------------------------------------ search */

function buildSearchIndex() {
  S.searchB = S.B.map((b) => ({
    b,
    addr: norm(b.address),
    fields: [
      ['Address', b.address], ['Building', b.building_name], ['Owner', b.owner], ['Milwaukee ID', b.id],
    ].filter(([, v]) => v).map(([l, v]) => [l, String(v), norm(v)]),
  }));
  S.searchE = S.E.map((e) => ({
    e,
    fields: [
      ['Name', e.name],
    ].filter(([, v]) => v).map(([l, v]) => [l, String(v), norm(v)]),
  }));
}

function matchFields(fields, toks) {
  const hay = fields.map((f) => f[2]).join(' | ');
  if (!toks.every((t) => hay.includes(t))) return null;
  const hit = fields.find((f) => toks.every((t) => f[2].includes(t))) || fields.find((f) => toks.some((t) => f[2].includes(t)));
  return hit || fields[0];
}

function runSearch(q) {
  const nq = norm(q);
  if (nq.length < 2) return null;
  const toks = nq.split(' ').filter(Boolean);
  const digits = nq.replace(/\D/g, '');
  const bHits = [];
  for (const s of S.searchB) {
    const hit = matchFields(s.fields, toks);
    if (!hit) continue;
    const score = s.addr.startsWith(nq) ? 0 : hit[0] === 'Address' ? 1 : 2;
    bHits.push({ b: s.b, hit, score });
  }
  bHits.sort((a, b) => a.score - b.score || (b.b.floor_area_sqft || 0) - (a.b.floor_area_sqft || 0));
  const eHits = [];
  for (const s of S.searchE) {
    const hit = matchFields(s.fields, toks);
    if (!hit) continue;
    const score = s.e._norm.startsWith(nq) ? 0 : hit[0] === 'Name' ? 1 : 2;
    eHits.push({ e: s.e, hit, score });
  }
  eHits.sort((a, b) => a.score - b.score || b.e._b.length - a.e._b.length);
  return { b: bHits.slice(0, 7), e: eHits.slice(0, 7), bTotal: bHits.length, eTotal: eHits.length };
}

function highlight(text, q) {
  const raw = String(text);
  const f = fold(raw);
  const toks = norm(q).split(' ').filter((t) => t.length > 1);
  if (f.length !== raw.length || !toks.length) return esc(raw);
  const marks = new Array(raw.length).fill(false);
  for (const t of toks) {
    let i = f.indexOf(t);
    while (i >= 0) { for (let j = i; j < i + t.length; j++) marks[j] = true; i = f.indexOf(t, i + t.length); }
  }
  let out = '';
  let open = false;
  for (let i = 0; i < raw.length; i++) {
    if (marks[i] && !open) { out += '<mark>'; open = true; }
    if (!marks[i] && open) { out += '</mark>'; open = false; }
    out += esc(raw[i]);
  }
  return out + (open ? '</mark>' : '');
}

function renderSearch(q) {
  const box = $('#search-results');
  const input = $('#search');
  const res = runSearch(q);
  if (!res) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
  const items = [];
  let html = '';
  if (res.b.length) {
    html += `<div class="dd-group eyebrow">Buildings <span class="muted">${res.bTotal > res.b.length ? `· top ${res.b.length} of ${fmt(res.bTotal)}` : ''}</span></div>`;
    for (const { b, hit } of res.b) {
      const idx = items.push({ type: 'b', obj: b }) - 1;
      const via = hit[0] !== 'Address' ? `${hit[0]}: ${highlight(hit[1], q)}` : `${esc(b.sector || '')} · ${esc(b.building_type || '')}`;
      html += `<button class="dd-item" role="option" data-idx="${idx}"><span class="kind-dot" style="background:${statusColor(b.contact_status)}"></span>
        <span class="dd-text"><div class="dd-main">${highlight(b.address || b.id, q)}</div><div class="dd-sub">${via}</div></span>
        <span class="dd-meta">${b.floor_area_sqft ? fmt(b.floor_area_sqft) + ' sq ft' : ''}</span></button>`;
    }
  }
  if (res.e.length) {
    html += `<div class="dd-group eyebrow">Owners / managers <span class="muted">${res.eTotal > res.e.length ? `· top ${res.e.length} of ${fmt(res.eTotal)}` : ''}</span></div>`;
    for (const { e, hit } of res.e) {
      const idx = items.push({ type: 'e', obj: e }) - 1;
      const via = hit[0] !== 'Name' ? `${hit[0]}: ${highlight(hit[1], q)}` : esc(cap(e.kind));
      html += `<button class="dd-item" role="option" data-idx="${idx}"><span class="kind-dot" style="background:${kindColor(e.kind)}"></span>
        <span class="dd-text"><div class="dd-main">${highlight(e.name, q)}</div><div class="dd-sub">${via}</div></span>
        <span class="dd-meta">${fmt(e._b.length)} bldg${e._b.length === 1 ? '' : 's'}</span></button>`;
    }
  }
  if (!items.length) html = `<div class="dd-empty">No building or owner matches “${esc(q)}”.</div>`;
  box.innerHTML = html;
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  S.searchItems = items;
  S.searchActive = items.length ? 0 : -1;
  paintSearchActive();
}

function paintSearchActive() {
  $$('#search-results .dd-item').forEach((el) => el.classList.toggle('is-active', +el.dataset.idx === S.searchActive));
  const act = $(`#search-results .dd-item[data-idx="${S.searchActive}"]`);
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function pickSearch(idx) {
  const it = S.searchItems && S.searchItems[idx];
  if (!it) return;
  $('#search-results').hidden = true;
  $('#search').blur();
  if (it.type === 'b') selectBuilding(it.obj, { fly: true });
  else selectEntity(it.obj, { fly: true });
}

/* ------------------------------------------------------------------ selection */

function setForced(set) {
  S.forced = set;
  S.styleKey++;
  refreshVisibility();
}

function selectBuilding(b, { fly = true, keepBack = false } = {}) {
  stopOrbit();
  if (!keepBack) S.backTo = null;
  S.sel = { type: 'building', b };
  const members = b._e ? b._e._b.map((x) => x._i) : [b._i];
  setForced(new Set(members));
  renderDetail();
  updateOwners();
  if (fly && b._pos) flyToBuilding(b);
}

function selectEntity(e, { fly = true, duration } = {}) {
  stopOrbit(); // a running orbit would cancel the flight (MapLibre stops animations on setBearing)
  S.backTo = null;
  S.sel = { type: 'entity', e };
  setForced(new Set(e._b.map((x) => x._i)));
  renderDetail();
  updateOwners();
  if (fly) fitEntity(e, { duration });
}

function clearSelection() {
  if (!S.sel) return;
  S.sel = null;
  S.backTo = null;
  stopOrbit();
  setForced(new Set());
  closeDetail();
  updateOwners();
}

/* ------------------------------------------------------------------ camera */

function panelPadding() {
  const left = $('#left').classList.contains('is-collapsed') || window.innerWidth < 760 ? 24 : $('#left').getBoundingClientRect().right + 16;
  const det = $('#detail');
  const right = det.hidden || window.innerWidth < 760 ? 24 : window.innerWidth - det.getBoundingClientRect().left + 16;
  const top = $('#topbar').getBoundingClientRect().bottom + 16;
  return { top, bottom: 48, left, right };
}

function onUserInteraction() {
  stopOrbit();
  if (S.tour) stopTour();
}

function flyTo(opts) {
  const token = ++S.flyToken;
  return new Promise((resolve) => {
    const done = () => resolve(token === S.flyToken);
    if (reducedMotion) { map.jumpTo(opts); done(); return; }
    map.once('moveend', done);
    map.flyTo({ curve: 1.35, easing: easeInOutCubic, essential: true, ...opts });
  });
}

async function flyToBuilding(b) {
  const zoom = clamp(17.35 - Math.log2(Math.max(1, b._h / 30)) * 0.75, 15.4, 17.35);
  const ok = await flyTo({ center: b._pos, zoom, pitch: 60, bearing: map.getBearing(), duration: 2300, padding: panelPadding() });
  if (ok && S.sel && S.sel.type === 'building' && S.sel.b === b && !S.tour) startOrbit(3.2);
}

async function fitEntity(e, { duration = 2400 } = {}) {
  const pts = e._mapped.map((b) => b._pos);
  if (!pts.length) return;
  if (pts.length === 1) {
    return flyTo({ center: pts[0], zoom: 16.2, pitch: 55, bearing: map.getBearing(), duration, padding: panelPadding() });
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  // MapLibre's cameraForBounds adds the map's current padding to the one passed in, so fit with deck's viewport maths.
  const padding = panelPadding();
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const fitPad = {
    left: Math.min(padding.left + 20, w * 0.45), right: Math.min(padding.right + 20, w * 0.45),
    top: Math.min(padding.top + 50, h * 0.45), bottom: Math.min(padding.bottom + 40, h * 0.45),
  };
  let zoom = 13;
  try {
    zoom = new WebMercatorViewport({ width: w, height: h }).fitBounds([[minX, minY], [maxX, maxY]], { padding: fitPad }).zoom;
  } catch { /* degenerate bounds */ }
  zoom = clamp(zoom - 0.25, 10, 16.2);
  const center = [(minX + maxX) / 2, invMercY((mercY(minY) + mercY(maxY)) / 2)];
  return flyTo({ center, zoom, pitch: 50, bearing: map.getBearing(), duration, padding });
}

function startOrbit(speed = 3) {
  stopOrbit();
  if (reducedMotion) return;
  let last = performance.now();
  const step = (t) => {
    const dt = Math.min((t - last) / 1000, 0.1);
    last = t;
    map.setBearing(map.getBearing() + speed * dt);
    S.orbitRaf = requestAnimationFrame(step);
  };
  S.orbitRaf = requestAnimationFrame(step);
}
function stopOrbit() {
  if (S.orbitRaf) cancelAnimationFrame(S.orbitRaf);
  S.orbitRaf = 0;
}

function resetView() {
  onUserInteraction();
  flyTo({ ...CONFIG.home, duration: 2600, padding: panelPadding() });
}

/* ---------- tour ---------- */

async function startTour() {
  if (S.tour) { stopTour(); return; }
  const list = rankEntities().filter((x) => x.e._mapped.length).slice(0, 10).map((x) => x.e);
  if (!list.length) { toast('No owners in view to tour'); return; }
  stopOrbit();
  const token = ++S.tourToken;
  S.tour = { token };
  $('#tour-btn').classList.add('is-active');
  $('#tour-btn span').textContent = 'Stop';
  const cap = $('#tourcap');
  cap.hidden = false;
  const bar = $('#tour-bar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  for (let i = 0; i < list.length; i++) {
    if (S.tourToken !== token) return;
    const e = list[i];
    $('#tour-step').textContent = `Tour · ${i + 1} / ${list.length}`;
    $('#tour-name').textContent = `${e.name} — ${fmt(e._b.length)} buildings · ${fmt(e._homes)} sq ft`;
    void bar.offsetWidth;
    bar.style.transition = 'width 6s linear';
    bar.style.width = `${((i + 1) / list.length) * 100}%`;
    selectEntity(e, { fly: true, duration: 2400 });
    await sleep(reducedMotion ? 3000 : 2500);
    if (S.tourToken !== token) return;
    startOrbit(2.4);
    await sleep(reducedMotion ? 1000 : 3500);
  }
  if (S.tourToken === token) stopTour();
}

function stopTour() {
  if (!S.tour) return;
  S.tourToken++;
  S.tour = null;
  stopOrbit();
  $('#tour-btn').classList.remove('is-active');
  $('#tour-btn span').textContent = 'Tour';
  $('#tourcap').hidden = true;
}

/* ------------------------------------------------------------------ detail panel */

const ICON = {
  mail: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  link: '<svg class="icon" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  linkedin: '<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  globe: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
};

function srcHtml(src) {
  if (!src) return '';
  const u = safeUrl(src);
  if (u) return `<a class="src" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(src)}">source ↗</a>`;
  return `<span class="src" title="${esc(src)}">(${esc(String(src).length > 48 ? String(src).slice(0, 46) + '…' : src)})</span>`;
}
function linkHtml(url, label) {
  const u = safeUrl(url);
  if (!u) return url ? esc(url) : '';
  const text = label || u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;
}
function copyBtn(value, what) {
  return `<button class="copy-btn" data-copy="${esc(value)}" title="Copy ${esc(what)}" aria-label="Copy ${esc(what)}">${ICON.copy}</button>`;
}
function emailLine(email, src) {
  if (!email) return '';
  return `<div class="contact-line">${ICON.mail}<a href="mailto:${esc(email)}">${esc(email)}</a>${copyBtn(email, 'email')}${srcHtml(src)}</div>`;
}
function phoneLine(phone, src) {
  if (!phone) return '';
  const tel = String(phone).replace(/[^\d+]/g, '');
  return `<div class="contact-line">${ICON.phone}<a href="tel:${esc(tel)}">${esc(phone)}</a>${copyBtn(phone, 'phone')}${srcHtml(src)}</div>`;
}
function fact(v, label) {
  return `<div class="fact"><div class="fact-v" title="${esc(v)}">${v == null || v === '' ? '—' : esc(v)}</div><div class="fact-l">${esc(label)}</div></div>`;
}
function kv(label, html) { return html ? `<dt>${esc(label)}</dt><dd>${html}</dd>` : ''; }
function statusPill(s) { return `<span class="pill pill-status" style="${pillStyle(statusColor(s))}"><span class="kind-dot" style="background:${statusColor(s)}"></span>${esc(cap(s || UNKNOWN))}</span>`; }
function kindPill(k) { return `<span class="pill"><span class="kind-dot" style="background:${kindColor(k)}"></span>${esc(cap(k || 'Unknown kind'))}</span>`; }
function researchPill(r) { const c = RESEARCH[r] || NEUTRAL; return r ? `<span class="pill pill-status" style="${pillStyle(c)}">Research: ${esc(r)}</span>` : ''; }

function renderDetail() {
  const panel = $('#detail');
  const body = $('#detail-body');
  if (!S.sel) return;
  if (panel.hidden || panel.classList.contains('is-closing')) {
    panel.classList.remove('is-closing');
    panel.hidden = false;
  }
  const back = $('#detail-back');
  if (S.sel.type === 'building') {
    $('#detail-eyebrow').textContent = 'Building';
    body.innerHTML = buildingHtml(S.sel.b);
  } else {
    $('#detail-eyebrow').textContent = 'Owner / manager';
    body.innerHTML = entityHtml(S.sel.e);
  }
  if (S.backTo) {
    back.hidden = false;
    back.querySelector('span').textContent = S.backTo.name;
  } else back.hidden = true;
  body.scrollTop = 0;
}

function closeDetail() {
  const panel = $('#detail');
  if (panel.hidden) return;
  if (reducedMotion) { panel.hidden = true; return; }
  panel.classList.add('is-closing');
  setTimeout(() => { if (panel.classList.contains('is-closing')) { panel.hidden = true; panel.classList.remove('is-closing'); } }, 240);
}

function buildingHtml(b) {
  const e = b._e;
  const plabel = b.priority ? (S.meta.priority_labels && S.meta.priority_labels[b.priority]) || `Priority ${b.priority}` : '';
  const pcol = COLOR_MODES.priority.color(b.priority || UNKNOWN);
  let html = `<div class="d-title">${esc(b.address || 'Address unknown')}</div>
    <div class="d-sub">${esc([b.building_type, b.sector].filter(Boolean).join(' · '))}</div>
    <div class="d-badges">${statusPill(b.contact_status)}${b.priority ? `<span class="pill" title="${esc(plabel)}"><span class="kind-dot" style="background:${pcol}"></span>Priority ${esc(b.priority)}</span>` : ''}${b.form ? `<span class="pill">${esc(cap(b.form))}</span>` : ''}</div>
    <div class="facts">
      ${fact(b.floor_area_sqft ? fmt(b.floor_area_sqft) + ' sq ft' : '', 'Floor area')}${fact(b.floors ?? '', b.floors ? 'Floors' : 'Floors (est.)')}${fact(b.year_built ?? '', 'Year built')}
      ${fact(b.taxkey || '', 'Taxkey')}${fact(b.sector || '', 'Class / sector')}${fact(b.id, 'Milwaukee ID')}
    </div>`;
  if (plabel) html += `<div class="note">${esc(plabel)}</div>`;

  if (b.owner) {
    html += '<section class="section">';
    html += `<h3>Owner of record</h3><dl class="kv">${kv('Owner', esc(b.owner))}${kv('Source', b.owner_source ? `<span class="muted">${esc(b.owner_source)}</span>` : '')}</dl>`;
    html += '</section>';
  } else if (b.contact_status === 'no owner found') {
    html += '<section class="section"><h3>Owner of record</h3><div class="note">No owner found yet for this building.</div></section>';
  }

  if (e) {
    const bc = bestContact(e);
    html += `<section class="section"><h3>Owner</h3>
      <button class="card entity-card" data-entity="${esc(e.id)}">
        <div class="ec-top"><span class="ec-name">${esc(e.name)}</span>${kindPill(e.kind)}</div>
        <div class="ec-stats"><span><b>${fmt(e._b.length)}</b> buildings</span><span><b>${fmt(e._homes)}</b> sq ft</span><span><b>${fmt(e._named)}</b> named</span></div>
        ${bc ? `<div class="contact-line" style="margin-top:8px">${ICON.pin}<span class="val"><b>${esc(clean(bc.name) || 'Contact')}</b>${bc.title ? ` <span class="muted">· ${esc(bc.title)}</span>` : ''}</span></div>
        ${bc.email ? `<div class="contact-line">${ICON.mail}<span class="val">${esc(bc.email)}</span></div>` : ''}
        ${bc.phone ? `<div class="contact-line">${ICON.phone}<span class="val">${esc(bc.phone)}</span></div>` : ''}` : ''}
        ${e.company_email ? `<div class="contact-line">${ICON.mail}<span class="val muted">${esc(e.company_email)}</span></div>` : ''}
        ${e.company_phone ? `<div class="contact-line">${ICON.phone}<span class="val muted">${esc(e.company_phone)}</span></div>` : ''}
        <div class="ec-cta"><span class="link-btn">Contacts &amp; portfolio →</span></div>
      </button></section>`;
  }
  if (b._posFromLot) html += '<div class="muted small" style="margin-top:12px">Map position taken from the centre of the lot.</div>';
  else if (!b._pos) html += '<div class="muted small" style="margin-top:12px">This building has no coordinates and no lot outline, so it is not on the map.</div>';
  return html;
}

function entityHtml(e) {
  const inView = e._b.filter((b) => S.pass[b._i]).length;
  const contacts = e._contacts || [];
  let html = `<div class="d-title">${esc(e.name)}</div>
    <div class="d-sub">${esc(cap(e.kind || ''))}${e.checked_on ? ` · checked ${esc(e.checked_on)}` : ''}</div>
    <div class="d-badges">${kindPill(e.kind)}${researchPill(e.research_status)}</div>
    <div class="facts">${fact(fmt(e._b.length), 'Buildings')}${fact(fmt(e._homes), 'Sq ft')}${fact(fmt(inView), 'In current view')}</div>`;
  if (e.website || e.contact_page) {
    html += `<dl class="kv">${kv('Website', linkHtml(e.website))}${kv('Contact page', linkHtml(e.contact_page))}</dl>`;
  }

  html += `<section class="section"><h3>Contacts <span class="count">${contacts.length || ''}</span></h3>`;
  if (contacts.length) {
    html += contacts.map((c) => `<div class="card contact">
      <div class="contact-name">${esc(clean(c.name) || 'Unnamed contact')}</div>
      ${c.title ? `<div class="contact-title">${esc(c.title)}</div>` : ''}
      ${emailLine(c.email, c.email_source)}${phoneLine(c.phone, c.phone_source)}
      ${safeUrl(c.linkedin) ? `<div class="contact-line">${ICON.linkedin}${linkHtml(c.linkedin, 'LinkedIn profile')}</div>` : ''}
    </div>`).join('');
  } else {
    html += '<div class="note">No named contact on file yet.</div>';
  }
  html += '</section>';

  if (e.company_email || e.company_phone || e.property_manager || e.manager_website) {
    html += `<section class="section"><h3>Company</h3><div class="card contact">
      ${emailLine(e.company_email, e.company_email_source)}${phoneLine(e.company_phone, e.company_phone_source)}
      ${e.property_manager ? `<div class="contact-line">${ICON.globe}<span class="val">Property manager: <b>${esc(e.property_manager)}</b></span></div>` : ''}
      ${e.manager_website ? `<div class="contact-line">${ICON.link}${linkHtml(e.manager_website)}</div>` : ''}
    </div></section>`;
  }

  if (e.mailing_address) {
    html += `<section class="section"><h3>Mailing address</h3><dl class="kv">
      ${kv('Address', esc(e.mailing_address || ''))}
    </dl></section>`;
  }
  if (e.notes) html += `<section class="section"><h3>Notes</h3><div class="note">${esc(e.notes)}</div></section>`;

  const blist = [...e._b].sort((a, b) => (b.floor_area_sqft || 0) - (a.floor_area_sqft || 0) || String(a.address).localeCompare(b.address));
  html += `<section class="section"><h3>Buildings <span class="count">${fmt(blist.length)}</span></h3><ul class="blist">
    ${blist.map((b) => `<li class="${S.pass[b._i] ? '' : 'is-hidden-by-filter'}"><button data-building="${esc(b.id)}" title="${b._pos ? 'Fly to this building' : 'Not on the map'}">
      <span class="b-dot" style="background:${statusColor(b.contact_status)}"></span>
      <span class="b-addr">${esc(b.address || b.id)}</span>
      <span class="b-units">${b.floor_area_sqft ? fmt(b.floor_area_sqft) + ' sq ft' : ''}</span>
      <span class="b-sub">${esc([b.building_type, b.sector].filter(Boolean).join(' · '))}${b._pos ? '' : ' · not on map'}</span>
    </button></li>`).join('')}
  </ul></section>`;
  return html;
}

/* ------------------------------------------------------------------ tooltip */

function onHoverObject(info) {
  const obj = info && info.object;
  const b = obj ? obj.b || obj : null;
  if (b !== S.hover) {
    S.hover = b;
    requestRender();
  }
  const tip = $('#tooltip');
  map.getCanvas().style.cursor = b ? 'pointer' : '';
  if (!b) { tip.hidden = true; return; }
  const owner = b._e ? b._e.name : b.owner || '';
  tip.innerHTML = `<div class="tt-addr">${esc(b.address || b.id)}</div>
    <div class="tt-sub">${esc([b.building_type, b.sector].filter(Boolean).join(' · '))}</div>
    ${owner ? `<div class="tt-owner">${b._e ? `<span class="kind-dot" style="background:${kindColor(b._e.kind)}"></span> ` : ''}${esc(owner)}${b._e && b._e._b.length > 1 ? ` <span class="muted">· ${fmt(b._e._b.length)} bldgs</span>` : ''}</div>` : ''}
    <div class="tt-row">${statusPill(b.contact_status)}<span class="muted small">${b.floor_area_sqft ? fmt(b.floor_area_sqft) + ' sq ft' : '—'}${b.floors ? ` · ${b.floors} floors` : ''}</span></div>`;
  tip.hidden = false;
  const rect = map.getCanvas().getBoundingClientRect();
  const x = rect.left + info.x;
  const y = rect.top + info.y;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  tip.style.left = `${Math.min(x, window.innerWidth - w - 30)}px`;
  tip.style.top = `${Math.min(y, window.innerHeight - h - 30)}px`;
}

function onClickObject(info) {
  const obj = info && info.object;
  const b = obj ? obj.b || obj : null;
  if (!b) return false;
  onUserInteraction();
  selectBuilding(b, { fly: true });
  return true;
}

/* ------------------------------------------------------------------ CSV export */

function csvCell(v) {
  if (v == null) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\r\n;]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(name, header, rows) {
  const text = '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PRIORITY_RANK = (p) => { const i = Object.keys(S.meta.priority_labels || PRIORITY).indexOf(p); return i < 0 ? 99 : i; };

function exportBuildings() {
  const rows = S.B.filter((b) => S.pass[b._i]).sort((a, b) => PRIORITY_RANK(a.priority) - PRIORITY_RANK(b.priority) || (b.floor_area_sqft || 0) - (a.floor_area_sqft || 0));
  const header = [
    'Milwaukee ID', 'Address', 'Building name', 'Taxkey', 'Form', 'Class / sector', 'Building type', 'Priority', 'Priority label',
    'Floor area (sq ft)', 'Floors', 'Year built',
    'Owner (City list)', 'Owner source', 'Owner ID', 'Owner kind', 'Research status', 'Portfolio size (buildings)',
    'Contact status', 'Property manager', 'Best contact name', 'Best contact title', 'Best contact email', 'Best contact phone', 'Best contact source',
    'Company email', 'Company phone', 'Company website', 'Mailing address', 'Latitude', 'Longitude',
  ];
  const data = rows.map((b) => {
    const e = b._e;
    const c = bestContact(e) || {};
    return [
      b.id, b.address, b.building_name, b.taxkey, b.form, b.sector, b.building_type, b.priority, S.meta.priority_labels ? S.meta.priority_labels[b.priority] : '',
      b.floor_area_sqft, b.floors, b.year_built,
      b.owner, b.owner_source, e && e.id, e && e.kind, e && e.research_status, e && e._b.length,
      b.contact_status, e && e.property_manager, clean(c.name), c.title, c.email, c.phone, c.email_source,
      e && e.company_email, e && e.company_phone, e && e.company_website, e && e.mailing_address,
      b._pos ? b._pos[1].toFixed(6) : '', b._pos ? b._pos[0].toFixed(6) : '',
    ];
  });
  downloadCSV(`milwaukee-buildings-${today()}.csv`, header, data);
  toast(`Exported ${fmt(rows.length)} buildings`);
}

function exportOwners() {
  const ranked = rankEntities();
  const header = [
    'Owner ID', 'Name', 'Kind', 'Research status', 'Buildings in view', 'Buildings total', 'Sq ft total', 'Property manager',
    'Best contact name', 'Best contact title', 'Best contact email', 'Best contact phone', 'Best contact source', 'All contacts',
    'Company email', 'Company phone', 'Company website', 'Mailing address', 'Notes',
  ];
  const data = ranked.map(({ e, n }) => {
    const c = bestContact(e) || {};
    const all = (e._contacts || []).map((x) => [clean(x.name), x.title, x.email, x.phone].filter(Boolean).join(' — ')).join(' | ');
    return [
      e.id, e.name, e.kind, e.research_status, n, e._b.length, e._homes, e.property_manager,
      clean(c.name), c.title, c.email, c.phone, c.email_source, all,
      e.company_email, e.company_phone, e.company_website, e.mailing_address, e.notes,
    ];
  });
  downloadCSV(`milwaukee-owners-${today()}.csv`, header, data);
  toast(`Exported ${fmt(data.length)} owners`);
}

/* ------------------------------------------------------------------ export lock */

// On the hosted site, CSV exports need a second code. The server checks it (middleware.js) and sets an
// 8-hour unlock cookie, so the code never appears in this file. Running locally there is no server gate
// (whoever runs it locally already has the data files), so exports stay open.
const HOSTED = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let exportPending = null;

async function exportStatus() {
  if (!HOSTED) return { unlocked: true };
  try {
    const r = await fetch('/__export-status', { cache: 'no-store', credentials: 'same-origin' });
    return r.ok ? await r.json() : { unlocked: false, expired: r.status === 401 };
  } catch {
    return { unlocked: false };
  }
}

function paintExportLock(locked) {
  $$('.export-btn').forEach((b) => {
    b.classList.toggle('is-locked', locked);
    b.title = locked ? 'Locked: the export code is required' : '';
  });
}

async function refreshExportLock() {
  if (HOSTED) paintExportLock(!(await exportStatus()).unlocked);
}

function showExportError(msg) {
  const el = $('#export-error');
  el.textContent = msg;
  el.hidden = !msg;
}

async function guardedExport(run, btn) {
  btn.classList.add('is-busy');
  const status = await exportStatus();
  btn.classList.remove('is-busy');
  if (status.unlocked) { paintExportLock(false); run(); return; }
  paintExportLock(true);
  exportPending = run;
  $('#export-code').value = '';
  showExportError(status.expired ? 'Your session has expired. Reload the page and sign in again.'
    : status.configured === false ? 'Exports are not configured on this deployment yet.' : '');
  $('#export-dialog').showModal();
  $('#export-code').focus();
}

async function submitExportCode(ev) {
  ev.preventDefault();
  const code = $('#export-code').value.trim();
  if (!code) { showExportError('Enter the export code.'); return; }
  const btn = $('#export-submit');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    const r = await fetch('/__export-unlock', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.unlocked) {
      const run = exportPending;
      exportPending = null;
      $('#export-dialog').close();
      paintExportLock(false);
      if (run) run();
    } else {
      showExportError(j.error || (r.status === 401 ? 'Your session has expired. Reload the page and sign in again.' : 'Could not unlock the exports.'));
      $('#export-code').select();
    }
  } catch {
    showExportError('Network error. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Unlock and download';
  }
}

async function lockExports() {
  try { await fetch('/__export-lock', { method: 'POST', credentials: 'same-origin', cache: 'no-store' }); } catch { /* offline */ }
  paintExportLock(true);
  toast('Exports locked');
}

/* ------------------------------------------------------------------ popovers & toast */

let toastTimer = 0;
function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function togglePopover(id, builder) {
  const el = $(id);
  const open = el.hidden;
  $$('.popover').forEach((p) => { p.hidden = true; });
  if (open) { el.innerHTML = builder(); el.hidden = false; }
}

function aboutHtml() {
  const m = S.meta;
  const kinds = {};
  for (const e of S.E) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  const named = S.E.reduce((s, e) => s + e._named, 0);
  const withLot = S.B.filter((b) => S.lotById.has(b.id)).length;
  const caveats = arr(m.caveats);
  return `<button class="icon-btn pop-close" data-close aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <h2>About this data</h2>
    <div class="muted">${esc(m.project || 'Milwaukee Covered Buildings')}</div>
    <div class="muted small">Data generated ${esc(m.generated || 'unknown')}</div>
    ${m.private ? `<div class="private-box">${esc(m.private)}</div>` : ''}
    ${caveats.length ? `<h3>Caveats</h3><ul>${caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <h3>In these files</h3>
    <div class="stat-grid">
      <div><span>Buildings</span><b>${fmt(S.B.length)}</b></div>
      <div><span>On the map</span><b>${fmt(S.mapped.length)}</b></div>
      <div><span>With a lot outline</span><b>${fmt(withLot)}</b></div>
      <div><span>Owners / managers</span><b>${fmt(S.E.length)}</b></div>
      ${Object.entries(kinds).map(([k, n]) => `<div><span>${esc(cap(k))}</span><b>${fmt(n)}</b></div>`).join('')}
      <div><span>Named contacts</span><b>${fmt(named)}</b></div>
    </div>
    <h3>Reading the map</h3>
    <ul>
      <li>Each glass volume is the building footprint from Microsoft Building Footprints, raised to floors × 3.5 m + 6 m. When floors are unknown, a default by building type is used.</li>
      <li>Zoomed out, a light beam marks each building. Its height grows with floor area.</li>
      <li>Arcs link buildings of the same owner, starting from its largest building.</li>
      <li>The white city is OpenStreetMap building data. Shadows follow the real sun over Milwaukee on October 15.</li>
    </ul>
    <h3>Sources &amp; privacy</h3>
    <ul>
      <li>Basemap and 3D buildings: OpenFreeMap, © OpenStreetMap contributors (OpenMapTiles schema).</li>
      <li>Relief: AWS Terrain Tiles (Mapzen, Terrarium).</li>
      <li>Building list: City of Milwaukee covered-buildings list. Footprints: Microsoft Building Footprints. Geocoding: Nominatim / OpenStreetMap.</li>
      <li>Libraries: MapLibre GL JS 5.24.0, deck.gl 9.4.0.</li>
      <li>No analytics or trackers. The building data stays in this browser; the only network calls are the map libraries and tiles.</li>
    </ul>
    ${HOSTED ? '<h3>Session</h3><div class="muted small">Signed in with the team access code on this browser for 7 days. <a href="/__logout">Sign out</a><br>CSV exports need the export code and stay unlocked for 8 hours. <button class="link-btn" data-lock-exports>Lock exports now</button></div>' : ''}
    <h3>Shortcuts</h3>
    <div class="muted small"><b>/</b> search · <b>Esc</b> close / deselect · <b>Shift</b>, <b>Option</b> or <b>Ctrl</b> + drag (or right-drag) to orbit and tilt</div>`;
}

function notOnMapHtml() {
  const list = S.notOnMap;
  return `<button class="icon-btn pop-close" data-close aria-label="Close"><svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <h2>Not on the map</h2>
    <div class="muted small">Buildings with neither coordinates nor a lot outline in the current files.</div>
    ${list.length ? `<ul class="blist" style="margin-top:12px">${list.map((b) => `<li><button data-building="${esc(b.id)}">
      <span class="b-dot" style="background:${statusColor(b.contact_status)}"></span><span class="b-addr">${esc(b.address || b.id)}</span>
      <span class="b-units">${b.floor_area_sqft ? fmt(b.floor_area_sqft) + ' sq ft' : ''}</span><span class="b-sub">${esc([b.building_type, b.sector].filter(Boolean).join(' · '))}</span></button></li>`).join('')}</ul>`
      : '<div class="note" style="margin-top:12px">Every building in the current files can be placed on the map.</div>'}`;
}

/* ------------------------------------------------------------------ wiring */

function wireUI() {
  // tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => { const on = x === t; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on); });
    $('#tab-filters').hidden = t.dataset.tab !== 'filters';
    $('#tab-owners').hidden = t.dataset.tab !== 'owners';
  }));
  $('#left-collapse').addEventListener('click', () => { $('#left').classList.add('is-collapsed'); $('#left-open').hidden = false; });
  $('#left-open').addEventListener('click', () => { $('#left').classList.remove('is-collapsed'); $('#left-open').hidden = true; });
  $('#filters-reset').addEventListener('click', resetFilters);

  // owners
  $('#owner-kinds').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-kind]');
    if (!b) return;
    S.ownerKind = b.dataset.kind;
    S.ownerLimit = 60;
    buildOwnerKinds();
    updateOwners();
  });
  $('#owners-more').addEventListener('click', () => { S.ownerLimit += 60; updateOwners(); });

  // delegated selection clicks (owners list, detail panel, popovers)
  document.addEventListener('click', (ev) => {
    const ent = ev.target.closest('[data-entity]');
    const bld = ev.target.closest('[data-building]');
    const copy = ev.target.closest('[data-copy]');
    const close = ev.target.closest('[data-close]');
    if (copy) {
      ev.preventDefault();
      ev.stopPropagation();
      navigator.clipboard.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast('Copy failed'));
      return;
    }
    if (close) { close.closest('.popover').hidden = true; return; }
    if (ev.target.closest('[data-lock-exports]')) { lockExports(); return; }
    if (ent) {
      const e = S.eById.get(ent.dataset.entity);
      if (e) { onUserInteraction(); selectEntity(e, { fly: true }); }
      return;
    }
    if (bld) {
      const b = S.bById.get(bld.dataset.building);
      if (!b) return;
      const fromEntity = S.sel && S.sel.type === 'entity' ? S.sel.e : null;
      onUserInteraction();
      selectBuilding(b, { fly: !!b._pos, keepBack: !!fromEntity });
      if (fromEntity) { S.backTo = fromEntity; renderDetail(); }
      if (bld.closest('.popover')) bld.closest('.popover').hidden = true;
    }
  });
  $('#detail-back').addEventListener('click', () => { if (S.backTo) selectEntity(S.backTo, { fly: true }); });
  $('#detail-close').addEventListener('click', clearSelection);

  // legend
  $('#colorby').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-mode]'); if (b) setColorBy(b.dataset.mode); });
  $('#legend-items').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-v]');
    if (!b) return;
    const set = S.f[COLOR_MODES[S.colorBy].facet];
    const v = b.dataset.v;
    if (set.has(v)) set.delete(v); else set.add(v);
    applyFilters();
  });
  $('#all-links').addEventListener('change', (ev) => { S.showAll = ev.target.checked; S.arcKey = ''; requestRender(); });

  // exports
  $('#export-buildings').addEventListener('click', (ev) => guardedExport(exportBuildings, ev.currentTarget));
  $('#export-owners').addEventListener('click', (ev) => guardedExport(exportOwners, ev.currentTarget));
  $('#export-form').addEventListener('submit', submitExportCode);
  $('#export-cancel').addEventListener('click', () => $('#export-dialog').close());
  $('#export-dialog').addEventListener('close', () => { exportPending = null; });

  // camera
  $('#view-reset').addEventListener('click', resetView);
  $('#view-2d').addEventListener('click', () => { onUserInteraction(); map.easeTo({ pitch: 0, bearing: 0, duration: 1400, easing: easeInOutCubic }); });
  $('#view-3d').addEventListener('click', () => { onUserInteraction(); map.easeTo({ pitch: 55, bearing: -20, duration: 1400, easing: easeInOutCubic }); });
  $('#compass').addEventListener('click', () => { onUserInteraction(); map.easeTo({ bearing: 0, duration: 900 }); });
  $('#tour-btn').addEventListener('click', startTour);
  $('#tour-stop').addEventListener('click', stopTour);

  // sun
  $('#time-slider').addEventListener('input', (ev) => applySun(+ev.target.value));
  $('#time-presets').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-t]'); if (b) applySun(+b.dataset.t); });
  $('#date-label').textContent = new Date(Date.UTC(2000, CONFIG.sun.month, CONFIG.sun.day)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  // popovers
  $('#btn-about').addEventListener('click', (ev) => { ev.stopPropagation(); togglePopover('#about', aboutHtml); });
  $('#btn-notonmap').addEventListener('click', (ev) => { ev.stopPropagation(); togglePopover('#notonmap', notOnMapHtml); });
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('.popover') && !ev.target.closest('#btn-about') && !ev.target.closest('#btn-notonmap')) $$('.popover').forEach((p) => { p.hidden = true; });
    if (!ev.target.closest('#search-wrap')) $('#search-results').hidden = true;
  });

  // search
  const input = $('#search');
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => renderSearch(input.value), 70); });
  input.addEventListener('focus', () => { if (input.value) renderSearch(input.value); });
  input.addEventListener('keydown', (ev) => {
    const n = (S.searchItems || []).length;
    if (ev.key === 'ArrowDown' && n) { ev.preventDefault(); S.searchActive = (S.searchActive + 1) % n; paintSearchActive(); }
    else if (ev.key === 'ArrowUp' && n) { ev.preventDefault(); S.searchActive = (S.searchActive - 1 + n) % n; paintSearchActive(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (S.searchActive >= 0) pickSearch(S.searchActive); }
    else if (ev.key === 'Escape') { $('#search-results').hidden = true; input.blur(); }
  });
  $('#search-results').addEventListener('mousedown', (ev) => {
    const it = ev.target.closest('.dd-item');
    if (it) { ev.preventDefault(); pickSearch(+it.dataset.idx); }
  });

  // keyboard
  document.addEventListener('keydown', (ev) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    if (ev.key === '/' && !typing) { ev.preventDefault(); input.focus(); input.select(); return; }
    if (document.querySelector('dialog[open]')) return; // the dialog handles its own keys
    if (ev.key === 'Escape' && !typing) {
      const open = $$('.popover').find((p) => !p.hidden);
      if (open) { open.hidden = true; return; }
      if (S.tour) { stopTour(); return; }
      clearSelection();
    }
  });

  // keep panels out of each other's way
  const ro = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--legend-h', `${$('#legend').offsetHeight}px`);
    const br = $('#br');
    $('#detail').style.bottom = `${window.innerHeight - br.getBoundingClientRect().top + 12}px`;
  });
  ro.observe($('#legend'));
  ro.observe($('#br'));
  window.addEventListener('resize', () => { $('#detail').style.bottom = `${window.innerHeight - $('#br').getBoundingClientRect().top + 12}px`; });

  // interaction stops the idle orbit and the tour
  const canvas = map.getCanvasContainer();
  ['pointerdown', 'wheel', 'touchstart'].forEach((t) => canvas.addEventListener(t, onUserInteraction, { passive: true }));
  map.on('movestart', (ev) => { if (ev.originalEvent) onUserInteraction(); });
  map.on('move', () => {
    const z = map.getZoom();
    $('#compass-needle').style.transform = `rotate(${-map.getBearing()}deg)`;
    if (Math.abs(z - S.zoom) > 0.01) { S.zoom = z; requestRender(); }
    if (S.sel) scheduleCull();
  });
  map.on('moveend', cullLabels);
  map.on('mouseout', () => { $('#tooltip').hidden = true; });
  map.on('movestart', () => { $('#tooltip').hidden = true; });
}

/* ------------------------------------------------------------------ pixel ratio & orbit controls */

// Browser zoom (Cmd +/−) or moving the window to another screen changes devicePixelRatio. MapLibre can keep its
// canvas at the old resolution while deck.gl draws at the new one, which shrinks every 3D layer toward the
// bottom-left corner. Resize the canvas whenever the two disagree.
function syncPixelRatio() {
  if (!map) return;
  const dpr = window.devicePixelRatio || 1;
  const canvas = map.getCanvas();
  const expected = Math.round(canvas.clientWidth * dpr);
  if (Math.abs(map.getPixelRatio() - dpr) > 1e-3 || Math.abs(canvas.width - expected) > 1) {
    map.setPixelRatio(dpr);
    map.resize();
    requestRender();
  }
  syncDeckFramebuffer();
}
// deck.gl draws into MapLibre's own canvas (interleaved mode), but luma.gl keeps its own record of that canvas:
// a default-framebuffer object sized once at start-up, and a pixel size from a ResizeObserver. When the window,
// panel or browser zoom changes the canvas size, deck flips Y with the stale height and every 3D layer slides
// vertically off the basemap (worse when zoomed out). Keep both records equal to the real canvas.
let deckDevice = null;
function pinDevicePixelSize(device) {
  const cc = device && device.canvasContext;
  if (!cc) return;
  deckDevice = device;
  if (!cc.__pinned) {
    cc.getDevicePixelSize = () => [cc.canvas.width, cc.canvas.height];
    cc.__pinned = true;
  }
  syncDeckFramebuffer();
}
function syncDeckFramebuffer() {
  const cc = deckDevice && deckDevice.canvasContext;
  if (!cc || !map) return;
  const { width, height } = map.getCanvas();
  if (typeof cc.setDrawingBufferSize === 'function') cc.setDrawingBufferSize(width, height);
  const fb = cc._framebuffer;
  if (fb && (fb.width !== width || fb.height !== height)) {
    try { fb.resize([width, height]); } catch { /* fall through */ }
    fb.width = width;
    fb.height = height;
  }
}
function watchPixelRatio() {
  map.on('resize', () => { syncDeckFramebuffer(); requestRender(); });
  const settle = () => { requestAnimationFrame(syncPixelRatio); setTimeout(syncPixelRatio, 300); };
  window.addEventListener('resize', settle);
  const listen = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { settle(); listen(); }, { once: true });
  };
  listen();
}

// Orbit and tilt with Shift- or Option-drag (Ctrl-drag and right-drag are MapLibre's own).
function enableModifierOrbit() {
  const el = map.getContainer();
  const isOrbitKey = (e) => e.shiftKey || e.altKey;
  let drag = null;
  let justDragged = false;
  map.boxZoom.disable(); // Shift-drag used to draw a zoom box
  const start = (e) => {
    if (e.button !== 0 || !isOrbitKey(e) || e.target.closest('.maplibregl-ctrl')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'mousedown' || drag) return; // pointerdown starts the drag; the mousedown is only swallowed
    onUserInteraction();
    drag = { x: e.clientX, y: e.clientY, bearing: map.getBearing(), pitch: map.getPitch(), moved: false };
    el.classList.add('is-orbiting');
    $('#tooltip').hidden = true;
  };
  el.addEventListener('pointerdown', start, { capture: true });
  el.addEventListener('mousedown', start, { capture: true });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    map.jumpTo({ bearing: drag.bearing + dx * 0.5, pitch: clamp(drag.pitch - dy * 0.4, 0, map.getMaxPitch()) });
  });
  const end = () => {
    if (!drag) return;
    justDragged = drag.moved;
    drag = null;
    el.classList.remove('is-orbiting');
    setTimeout(() => { justDragged = false; }, 0);
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  // The click that ends an orbit drag must not select or deselect anything.
  el.addEventListener('click', (e) => { if (justDragged) { e.stopPropagation(); e.preventDefault(); } }, { capture: true });
  // Show the orbit cursor while the modifier is held.
  const setReady = (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
    el.classList.toggle('orbit-ready', !typing && (e.shiftKey || e.altKey));
  };
  window.addEventListener('keydown', setReady);
  window.addEventListener('keyup', setReady);
  window.addEventListener('blur', () => el.classList.remove('orbit-ready'));
}

function showOrbitHint() {
  let seen = false;
  try { seen = localStorage.getItem('mkw.orbitHint') === '1'; } catch { /* storage unavailable */ }
  if (seen) return;
  setTimeout(() => {
    toast('Tip: hold Shift (or Option) and drag to orbit and tilt the camera', 6000);
    try { localStorage.setItem('mkw.orbitHint', '1'); } catch { /* storage unavailable */ }
  }, 4800);
}

/* ------------------------------------------------------------------ boot */

function setLoader(p, text) {
  $('#loader-bar').style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
  if (text) $('#loader-status').textContent = text;
}
function loaderError(msg) {
  const el = $('#loader-status');
  el.classList.add('loader-error');
  el.textContent = msg;
  $('#loader-bar').style.background = '#EF4444';
}

async function main() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) { loaderError('This browser has no WebGL2. Use a recent Chrome, Edge, Safari or Firefox.'); return; }

  const prog = { data: 0, lots: 0 };
  const onProg = () => setLoader(0.04 + 0.66 * (prog.data * 0.48 + prog.lots * 0.52));
  setLoader(0.03, 'Loading buildings and lot outlines…');

  let data; let lots; let style;
  try {
    [data, lots, style] = await Promise.all([
      fetchJSON(CONFIG.dataUrl, (p) => { prog.data = p; onProg(); }),
      fetchJSON(CONFIG.lotsUrl, (p) => { prog.lots = p; onProg(); }),
      fetch(CONFIG.styleUrl).then((r) => { if (!r.ok) throw new Error(`Map style returned HTTP ${r.status}`); return r.json(); }),
    ]);
  } catch (err) {
    console.error(err);
    loaderError(err.message || String(err));
    return;
  }

  setLoader(0.74, `Preparing ${fmt(arr(data && data.buildings).length)} buildings…`);
  await sleep(16);
  try {
    prepare(data, lots);
  } catch (err) {
    console.error(err);
    loaderError(`Could not read the data files: ${err.message}`);
    return;
  }
  $('#private-note').textContent = S.meta.private ? clean(S.meta.private) : '';
  $('#brand-sub').textContent = `Azzera · ${fmt(S.B.length)} covered buildings`;
  $('#notonmap-count').textContent = fmt(S.notOnMap.length);

  setLoader(0.8, 'Loading the map…');
  restyleBasemap(style);
  map = new maplibregl.Map({
    container: 'map',
    style,
    ...(reducedMotion ? CONFIG.home : CONFIG.intro),
    minZoom: 9.5,
    maxZoom: 19,
    maxPitch: 76,
    maxBounds: [[-88.3, 42.8], [-87.5, 43.3]],
    attributionControl: false,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' },
    fadeDuration: 150,
  });
  map.addControl(new maplibregl.AttributionControl({
    compact: false,
    customAttribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
  }), 'bottom-right');

  overlay = new MapboxOverlay({ interleaved: true, effects: [lighting], layers: [], pickingRadius: 4,
    onDeviceInitialized: pinDevicePixelSize,
    onClick: (info) => { if (!info.object && S.sel && !S.tour) clearSelection(); } });
  map.addControl(overlay);

  await new Promise((resolve) => (map.loaded() ? resolve() : map.once('load', resolve)));
  setLoader(0.92, 'Lighting the city…');

  wireUI();
  refreshExportLock();
  pinDevicePixelSize(overlay._deck && overlay._deck.device);
  watchPixelRatio();
  enableModifierOrbit();
  buildFacetsUI();
  buildOwnerKinds();
  applySun(CONFIG.defaultMinutes);
  applyFilters({ animate: false });
  ['buildings', 'entities', 'named', 'area', 'pct'].forEach((k) => { $(`[data-kpi="${k}"]`).dataset.v = 0; });
  try { await Promise.race([document.fonts.load(`600 12px ${FONT}`), sleep(1500)]); } catch { /* font is optional */ }
  S.zoom = map.getZoom();
  requestRender();

  await new Promise((resolve) => { map.once('idle', resolve); setTimeout(resolve, 2500); });
  setLoader(1, 'Ready');
  await sleep(250);
  $('#loader').classList.add('is-done');
  updateKPIs(true);
  if (!reducedMotion) {
    await sleep(350);
    flyTo({ ...CONFIG.home, duration: 4200, curve: 1.15, padding: panelPadding() });
  }
  showOrbitHint();
}

main();

// Opt-in console hook for troubleshooting: open the page with ?debug to expose the state as window.__mkw.
if (new URLSearchParams(location.search).has('debug')) {
  window.__mkw = { S, get map() { return map; }, get overlay() { return overlay; }, selectBuilding, selectEntity, clearSelection, applySun };
}
