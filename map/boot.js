/* City selector. One deployment serves both Milwaukee and Québec City; the
 * ?city= query param picks which dataset + bundle to load. Default is Milwaukee
 * (the original link stays unchanged). The header toggle just reloads with the
 * other city — simplest, bullet-proof switch for a static, gated site.
 * Loaded as an external file because the page CSP forbids inline scripts. */
(function () {
  var city = new URLSearchParams(location.search).get('city') === 'quebec'
    ? 'quebec' : 'milwaukee';
  var CFG = {
    milwaukee: { title: 'Milwaukee Covered Buildings', sub: 'Azzera · 826 buildings', bundle: 'app.js' },
    quebec: { title: 'Québec City Covered Buildings', sub: 'Azzera · 1,587 buildings', bundle: 'app-quebec.js' },
  }[city];

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
