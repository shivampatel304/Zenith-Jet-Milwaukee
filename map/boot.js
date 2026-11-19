/* Region selector. One deployment serves Milwaukee + several Québec regions; the
 * ?city= query param picks which dataset + bundle + map view to load. Default is
 * Milwaukee (the original link stays unchanged). The header toggle reloads with the
 * chosen region. Loaded as an external file because the page CSP forbids inline
 * scripts. The Québec regions all share one bundle (app-quebec.js); view config
 * (data file, map center/bounds/sun) is passed through window.__CITYCFG__. */
(function () {
  var CITIES = {
    milwaukee: { title: 'Milwaukee Covered Buildings', sub: 'Azzera · 826 buildings', bundle: 'app.js' },
    quebec: {
      title: 'Québec City Covered Buildings', sub: 'Azzera · 1,587 covered buildings',
      bundle: 'app-quebec.js', data: 'data/quebec_data.json', lots: 'data/quebec_lots.geojson',
      intro: [-71.30, 46.80, 10.4], home: [-71.214, 46.8139, 12.8],
      sun: [46.814, -71.208], bounds: [[-71.75, 46.55], [-70.85, 47.10]],
    },
    westisland: {
      title: 'West Island — Covered Buildings', sub: 'Azzera · 695 covered buildings',
      bundle: 'app-quebec.js', data: 'data/quebec_wi_data.json', lots: 'data/quebec_wi_lots.geojson',
      intro: [-73.86, 45.46, 10.6], home: [-73.80, 45.47, 11.6],
      sun: [45.46, -73.86], bounds: [[-74.10, 45.38], [-73.68, 45.56]],
    },
    northshore: {
      title: 'North Shore — Covered Buildings', sub: 'Azzera · 1,317 covered buildings',
      bundle: 'app-quebec.js', data: 'data/quebec_ns_data.json', lots: 'data/quebec_ns_lots.geojson',
      intro: [-73.75, 45.62, 10.2], home: [-73.75, 45.57, 11.4],
      sun: [45.62, -73.75], bounds: [[-74.20, 45.42], [-73.35, 45.85]],
    },
    southshore: {
      title: 'South Shore — Covered Buildings', sub: 'Azzera · 1,209 covered buildings',
      bundle: 'app-quebec.js', data: 'data/quebec_ss_data.json', lots: 'data/quebec_ss_lots.geojson',
      intro: [-73.44, 45.47, 10.4], home: [-73.47, 45.52, 12.0],
      sun: [45.47, -73.44], bounds: [[-73.75, 45.25], [-73.05, 45.72]],
    },
  };
  var param = new URLSearchParams(location.search).get('city');
  var city = CITIES[param] ? param : 'milwaukee';
  var CFG = CITIES[city];
  window.__CITYCFG__ = CFG;

  document.title = CFG.title;

  function apply() {
    var set = function (sel, text) { var el = document.querySelector(sel); if (el) el.textContent = text; };
    set('.loader-title', CFG.title);
    set('.loader-sub', CFG.sub);
    set('.brand-text h1', CFG.title);
    document.querySelectorAll('[data-city]').forEach(function (btn) {
      if (btn.getAttribute('data-city') === city) btn.classList.add('active');
      btn.addEventListener('click', function () {
        var c = btn.getAttribute('data-city');
        if (c === city) return;
        var u = new URL(location.href);
        if (c === 'milwaukee') u.searchParams.delete('city'); else u.searchParams.set('city', c);
        location.href = u.toString();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  var s = document.createElement('script');
  s.type = 'module';
  s.src = CFG.bundle;
  document.head.appendChild(s);
})();
