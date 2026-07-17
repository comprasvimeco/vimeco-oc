/* VIMECO S.A. — UI helpers compartidos (Fase 3 consolidación) */

/* Escape HTML para interpolar texto dinámico de forma segura. */
window.escHtml = function (str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

/*
 * Toast único para toda la app. Reemplaza las copias por página.
 * Requiere `js/icons.js` (icSvg) cargado antes, y un contenedor
 * `#toast-container` en la página.
 *
 * Se exponen dos nombres para preservar los defaults históricos:
 *   window.toast(msg, 'info')      → páginas de Compras/Caja
 *   window.showToast(msg, 'success') → páginas de gestión (Personal, etc.)
 */
function _toast(msg, type) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = {
    success: icSvg('checkSm'),
    error:   icSvg('x'),
    warning: icSvg('alert'),
    info:    icSvg('info'),
  };
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${escHtml(msg)}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

window.toast     = (msg, type = 'info')    => _toast(msg, type);
window.showToast = (msg, type = 'success') => _toast(msg, type);

/*
 * Paginador "Ver más" para las listas que crecen sin techo (Historial, Adjuntar,
 * Novedades). Sin esto cada una pinta el historial entero de una: en jul-2026 son
 * 156 OC y ~26.000 px de scroll, y sólo va para arriba.
 *
 * No pagina por mes a propósito: las tres pantallas ya tienen su propio control de
 * tiempo (rango de fechas en Historial/Adjuntar, chips de rango en Novedades) y
 * serían dos filtros compitiendo. Esto es ortogonal a lo que ya filtra el usuario.
 *
 * Cada lista se identifica con una `key` y recuerda cuántos ítems mostrar. El
 * caller sigue armando sus tarjetas como quiera (DOM o HTML), sólo pide el recorte:
 *
 *   const page = pager.take('hist', ocs);        // primeros N
 *   ...pinta `page`...
 *   pager.footer('hist', listEl, ocs, () => renderCards(ocs));
 *
 * Importante: llamar `pager.reset(key)` cuando cambia el filtro (no cuando se
 * repinta por otra razón, o el usuario pierde el "Ver más" que ya tocó).
 */
window.pager = (function () {
  const STEP = 25;
  const shown = new Map();   // key -> cuántos ítems mostrar

  const count = (key) => shown.get(key) || STEP;

  return {
    STEP,
    reset(key) { shown.delete(key); },

    take(key, items) {
      return items.slice(0, Math.min(count(key), items.length));
    },

    // Agrega el botón al final de la lista si quedan ítems sin mostrar.
    footer(key, listEl, items, rerender) {
      const n = Math.min(count(key), items.length);
      if (n >= items.length) return;
      const restantes = items.length - n;
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline pager-more';
      btn.textContent = `Ver ${Math.min(STEP, restantes)} más (${restantes} sin mostrar)`;
      btn.addEventListener('click', () => {
        shown.set(key, n + STEP);
        rerender();
      });
      listEl.appendChild(btn);
    }
  };
})();

/*
 * Header responsive: mantiene `data-initials` sincronizado con #hdr-name.
 * En mobile el CSS oculta el nombre completo y muestra las iniciales
 * (via ::after content: attr(data-initials)), sin tocar el JS de cada página.
 */
function _hdrInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('hdr-name');
  if (!el) return;
  const sync = () => {
    const t = el.textContent.trim();
    el.setAttribute('data-initials', (t && t !== '—') ? _hdrInitials(t) : '');
  };
  sync();
  new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true });
});
