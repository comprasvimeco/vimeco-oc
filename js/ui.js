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
