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
