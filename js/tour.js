/* VIMECO S.A. — Motor de tutoriales (slides en modal).
 *
 * Contenido en js/tutoriales.js (window.TUTORIALES). Este archivo solo renderiza.
 *
 * Uso manual:   window.openTour('compras' | 'caja' | 'personal')
 *
 * Auto-cableado por página (sin tocar el JS de cada módulo), vía atributos en <body>:
 *   data-tour="compras"        → módulo de esta pantalla (auto-abre en el primer uso
 *                                 y cablea el ítem #btn-ayuda del menú ☰).
 *   data-tour-menu="self"      → esta pantalla NO tiene su propio JS de menú ☰;
 *                                 tour.js se encarga de abrir/cerrar #hdr-dropdown.
 *
 * Estado "visto" por usuario en localStorage:
 *   vimeco_tour_visto_{codigo} = { compras: <hash>, caja: <hash>, personal: <hash> }
 *
 * Se guarda un HASH DEL CONTENIDO de los slides, no un número de versión: el tutorial
 * reaparece (con el badge "Nuevo") si y sólo si su texto cambió. Antes dependía de que
 * alguien se acordara de subir `version` a mano en tutoriales.js — y de que nadie la
 * subiera de más por un cambio que no tocaba el tutorial. Ahora no hay número que tocar.
 *
 * `version` en tutoriales.js quedó sólo para migrar el estado viejo (ver debeMostrar);
 * no hace falta subirla más.
 */
(function () {
  'use strict';

  function codigo() {
    try { return (JSON.parse(localStorage.getItem('vimeco_session')) || {}).codigo || 'anon'; }
    catch (_) { return 'anon'; }
  }
  function storeKey() { return 'vimeco_tour_visto_' + codigo(); }
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(storeKey())) || {}; } catch (_) { return {}; }
  }
  function markSeen(mod, version) {
    const s = readSeen();
    s[mod] = version;
    try { localStorage.setItem(storeKey(), JSON.stringify(s)); } catch (_) {}
  }

  // Huella del contenido de un tutorial (djb2 sobre los slides). El prefijo 'h' la
  // hace inconfundible con el número de `version` que guardaba el formato viejo.
  function contentHash(t) {
    const s = JSON.stringify(t.slides || []);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  }

  // ¿Hay que auto-abrirlo? Sólo si su contenido cambió desde la última vez que se cerró.
  function debeMostrar(mod, t) {
    const stored = readSeen()[mod];
    const hash   = contentHash(t);
    if (typeof stored === 'number') {
      // Estado anterior al hash: guardaba el número de versión visto. Si ya vio la
      // última versión manual, entonces vio este mismo texto → se anota su hash y el
      // número no se vuelve a mirar. Si no, el tutorial se muestra y al cerrarlo el
      // hash pisa al número.
      if (stored >= (t.version || 1)) { markSeen(mod, hash); return false; }
      return true;
    }
    return stored !== hash;
  }

  // ---- Estado del carrusel en curso ----
  let _overlay = null, _mod = null, _slides = [], _i = 0, _version = 1, _keyHandler = null;

  function buildOverlay() {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay tour-overlay';
    ov.id = 'tour-overlay';
    ov.innerHTML =
      '<div class="modal modal--tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">' +
        '<div class="modal-header">' +
          '<span class="modal-title" id="tour-title"></span>' +
          '<button class="modal-close" id="tour-close" aria-label="Cerrar">' + icSvg('x') + '</button>' +
        '</div>' +
        '<div class="modal-body tour-body">' +
          '<div class="tour-illustration" id="tour-illu"></div>' +
          '<div class="tour-slide-title" id="tour-slide-title"></div>' +
          '<div class="tour-slide-text" id="tour-slide-text"></div>' +
        '</div>' +
        '<div class="tour-dots" id="tour-dots"></div>' +
        '<div class="modal-footer tour-footer">' +
          '<button class="btn btn-outline btn-sm" id="tour-prev">' + icSvg('chevL') + ' Atrás</button>' +
          '<button class="btn btn-primary btn-sm" id="tour-next">Siguiente ' + icSvg('chevR') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    ov.querySelector('#tour-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#tour-prev').addEventListener('click', () => go(_i - 1));
    ov.querySelector('#tour-next').addEventListener('click', () => {
      if (_i >= _slides.length - 1) close();
      else go(_i + 1);
    });

    // Swipe en mobile
    let x0 = null;
    const body = ov.querySelector('.tour-body');
    body.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    body.addEventListener('touchend', e => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (dx < -40 && _i < _slides.length - 1) go(_i + 1);
      else if (dx > 40 && _i > 0) go(_i - 1);
      x0 = null;
    }, { passive: true });

    return ov;
  }

  function render() {
    const s = _slides[_i];
    _overlay.querySelector('#tour-illu').innerHTML = icSvg(s.icono || 'info');
    _overlay.querySelector('#tour-slide-title').textContent = s.titulo || '';
    _overlay.querySelector('#tour-slide-text').textContent = s.texto || '';

    const dots = _slides.map((_, k) =>
      '<span class="tour-dot' + (k === _i ? ' active' : '') + '"></span>').join('');
    _overlay.querySelector('#tour-dots').innerHTML = dots;

    _overlay.querySelector('#tour-prev').style.visibility = _i === 0 ? 'hidden' : 'visible';
    const next = _overlay.querySelector('#tour-next');
    next.innerHTML = (_i >= _slides.length - 1) ? 'Entendido' : ('Siguiente ' + icSvg('chevR'));
  }

  function go(i) {
    _i = Math.max(0, Math.min(_slides.length - 1, i));
    render();
  }

  function close() {
    if (!_overlay) return;
    markSeen(_mod, _version);
    clearBadge();
    document.removeEventListener('keydown', _keyHandler);
    _overlay.remove();
    _overlay = null; _mod = null; _slides = [];
  }

  window.openTour = function (mod) {
    const t = (window.TUTORIALES || {})[mod];
    if (!t || !t.slides || !t.slides.length) return;
    if (_overlay) close();
    _mod = mod; _slides = t.slides; _version = contentHash(t); _i = 0;
    _overlay = buildOverlay();
    _overlay.querySelector('#tour-title').textContent = t.titulo || 'Tutorial';
    render();
    _keyHandler = e => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && _i < _slides.length - 1) go(_i + 1);
      else if (e.key === 'ArrowLeft' && _i > 0) go(_i - 1);
    };
    document.addEventListener('keydown', _keyHandler);
  };

  // ---- Badge "Nuevo" en el menú ☰ ----
  function showBadge() {
    const wrap = document.querySelector('.hdr-menu-wrap');
    if (wrap && !wrap.querySelector('.hdr-badge')) {
      const dot = document.createElement('span');
      dot.className = 'hdr-badge';
      wrap.appendChild(dot);
    }
    const ayuda = document.getElementById('btn-ayuda');
    if (ayuda && !ayuda.querySelector('.hdr-drop-new')) {
      const tag = document.createElement('span');
      tag.className = 'hdr-drop-new';
      tag.textContent = 'Nuevo';
      ayuda.appendChild(tag);
    }
  }
  function clearBadge() {
    document.querySelectorAll('.hdr-badge, .hdr-drop-new').forEach(el => el.remove());
  }

  // ---- Auto-cableado por página ----
  document.addEventListener('DOMContentLoaded', () => {
    const mod = document.body.getAttribute('data-tour');
    if (!mod || !window.TUTORIALES || !window.TUTORIALES[mod]) return;

    // Menú ☰ propio (pantallas sin JS de dropdown, ej. Personal)
    if (document.body.getAttribute('data-tour-menu') === 'self') {
      const btn = document.getElementById('btn-menu');
      const dd  = document.getElementById('hdr-dropdown');
      if (btn && dd) {
        btn.addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('hidden'); });
        document.addEventListener('click', () => dd.classList.add('hidden'));
        dd.addEventListener('click', e => e.stopPropagation());
      }
    }

    // Ítem "Ayuda" del menú
    const ayuda = document.getElementById('btn-ayuda');
    if (ayuda) ayuda.addEventListener('click', () => {
      const dd = document.getElementById('hdr-dropdown');
      if (dd) dd.classList.add('hidden');
      window.openTour(mod);
    });

    // Badge + auto-abrir en el primer uso, o si el texto del tutorial cambió
    if (debeMostrar(mod, window.TUTORIALES[mod])) {
      showBadge();
      setTimeout(() => window.openTour(mod), 700);
    }
  });
})();
