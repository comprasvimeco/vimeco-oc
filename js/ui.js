/* VIMECO S.A. — UI helpers compartidos (Fase 3 consolidación) */

/* Escape HTML para interpolar texto dinámico de forma segura. */
window.escHtml = function (str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

/*
 * Nombre con el que se archiva un adjunto en Drive. En la carpeta de una compra
 * conviven la OC, el presupuesto, la factura y los remitos: el prefijo es lo
 * único que los distingue de un "IMG_20260727.jpg".
 *
 *   nombreArchivoDrive('Factura', 'IMG_0042.jpg')        → 'Factura - IMG_0042.jpg'
 *   nombreArchivoDrive('Remito', 'foto.jpg', '0001-12')  → 'Remito 0001-12 - foto.jpg'
 *
 * Idempotente: si el nombre ya viene prefijado (resubida de la cola offline) no
 * lo prefija de nuevo.
 */
window.nombreArchivoDrive = function (prefijo, nombreOriginal, detalle) {
  const limpio = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  const cabeza = detalle ? `${limpio(prefijo)} ${limpio(detalle)}` : limpio(prefijo);
  const orig   = String(nombreOriginal || 'archivo').trim();
  return orig.startsWith(cabeza + ' - ') ? orig : `${cabeza} - ${orig}`;
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
 * Confirmación única para toda la app (reemplaza los `modal-confirm` por página y
 * los `confirm()` nativos). Devuelve una promesa con true/false. El modal se arma
 * solo la primera vez: las páginas no necesitan HTML propio.
 *
 *   await showConfirm('Borrar remito', msg, { boton: 'Borrar', tono: 'del', icono: 'trash' })
 *
 * `tono`: 'ok' (verde) | 'del' (rojo) | 'warn' (ámbar) | 'info' (azul). El botón
 * de acción siempre dice qué hace: nada de "Aceptar"/"Confirmar" genéricos.
 * `cancelar` cambia el texto del otro botón (p. ej. cuando la acción ya es "Cancelar …").
 * Escape o tocar afuera = cancelar. Los "\n" del mensaje se respetan.
 */
window.showConfirm = function (title, msg, { boton = 'Confirmar', tono = 'ok', icono = 'check', cancelar = 'Cancelar' } = {}) {
  let modal = document.getElementById('modal-confirm');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay hidden';
    modal.id = 'modal-confirm';
    modal.innerHTML =
      '<div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">' +
        '<span class="confirm-ic"></span>' +
        '<div class="confirm-title" id="confirm-title"></div>' +
        '<p class="confirm-msg"></p>' +
        '<div class="confirm-btns">' +
          '<button type="button" class="foc-btn foc-btn--clear confirm-no"></button>' +
          '<button type="button" class="foc-btn confirm-yes"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }
  const q = sel => modal.querySelector(sel);
  const btnTono = { ok: 'gen', del: 'del', warn: 'warn', info: 'edit' }[tono] || 'gen';
  q('.confirm-box').className = 'confirm-box confirm-box--' + tono;
  q('.confirm-ic').innerHTML  = icSvg(icono);
  q('.confirm-title').textContent = title;
  q('.confirm-msg').textContent   = msg;
  q('.confirm-no').textContent    = cancelar;
  const yes = q('.confirm-yes');
  yes.className = 'foc-btn confirm-yes foc-btn--' + btnTono;
  yes.innerHTML = icSvg(icono) + escHtml(boton);

  return new Promise(resolve => {
    const close = val => {
      modal.classList.add('hidden');
      modal.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    modal.onclick = e => {
      if (e.target === modal || e.target.closest('.confirm-no')) close(false);
      else if (e.target.closest('.confirm-yes')) close(true);
    };
    document.addEventListener('keydown', onKey, true);
    modal.classList.remove('hidden');
    q('.confirm-box').focus();
  });
};

/*
 * Visor de foto a pantalla completa (las miniaturas de comprobante en Remitos,
 * Facturas y Caja). Se arma solo la primera vez. Tocar la foto alterna entre
 * "entera" y ampliada (2,5×, centrada donde se tocó, se recorre arrastrando);
 * tocar el fondo, la X o Escape cierra.
 *
 *   verImagen(objectUrl)
 */
window.verImagen = function (src) {
  if (!src) return;
  let lb = document.getElementById('img-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'img-lightbox';
    lb.className = 'img-lightbox hidden';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.innerHTML =
      '<button type="button" class="img-lightbox-close" aria-label="Cerrar">' + icSvg('x') + '</button>' +
      '<img alt="Comprobante">';
    document.body.appendChild(lb);
    const img = lb.querySelector('img');
    const cerrar = () => {
      lb.classList.add('hidden');
      lb.classList.remove('zoom');
      img.removeAttribute('src');
      document.removeEventListener('keydown', lb._onKey, true);
    };
    lb._onKey = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); cerrar(); } };
    lb.addEventListener('click', e => {
      if (e.target !== img) return cerrar();
      // Ampliar centrado en el punto tocado (proporción dentro de la foto).
      const r = img.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const zoom = lb.classList.toggle('zoom');
      if (zoom) {
        lb.scrollLeft = fx * img.offsetWidth  - lb.clientWidth  / 2;
        lb.scrollTop  = fy * img.offsetHeight - lb.clientHeight / 2;
      }
    });
  }
  lb.classList.remove('zoom');
  lb.querySelector('img').src = src;
  lb.classList.remove('hidden');
  document.addEventListener('keydown', lb._onKey, true);
};

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
