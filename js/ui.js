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
      '<button type="button" class="img-lightbox-close img-lightbox-print" aria-label="Imprimir" title="Imprimir">' + icSvg('print') + '</button>' +
      '<button type="button" class="img-lightbox-close" aria-label="Cerrar">' + icSvg('x') + '</button>' +
      '<img alt="Comprobante">';
    document.body.appendChild(lb);
    const img = lb.querySelector('img');
    lb.querySelector('.img-lightbox-print').addEventListener('click', e => {
      e.stopPropagation();
      imprimirImagenes([img.src], { margen: '10mm' });
    });
    const cerrar = () => {
      lb.classList.add('hidden');
      lb.classList.remove('zoom');
      img.removeAttribute('src');
      document.removeEventListener('keydown', lb._onKey, true);
    };
    lb._onKey = e => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); cerrar(); }
      // Ctrl+P imprime la foto, no la página de atrás.
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault(); e.stopImmediatePropagation();
        imprimirImagenes([img.src], { margen: '10mm' });
      }
    };
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
 * Imprime imágenes, una por hoja y cada una entera en la hoja (una foto, o las
 * páginas de un PDF ya dibujadas por el visor de Archivo). Se arman en un iframe
 * oculto y se imprime ése: un PDF dentro de un iframe no se imprime en Android
 * ni en iOS, una imagen sí. Cada fuente es una URL o un Blob.
 *
 *   await imprimirImagenes([url | blob, …], { margen: '10mm', titulo })
 */
window.imprimirImagenes = async function (fuentes, opts = {}) {
  const viejo = document.getElementById('print-frame');
  if (viejo) viejo.remove();
  const urls = [];
  const fr = document.createElement('iframe');
  fr.id = 'print-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.tabIndex = -1;
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const limpiar = () => { fr.remove(); urls.forEach(u => URL.revokeObjectURL(u)); };

  const d = fr.contentDocument;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title></title><style>'
    + '@page { margin: ' + (opts.margen || '0') + '; }'
    + 'html, body { margin: 0; padding: 0; }'
    + '.h { height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden;'
    + ' break-after: page; page-break-after: always; }'
    + '.h:last-child { break-after: auto; page-break-after: auto; }'
    + 'img { display: block; max-width: 100%; max-height: 100%; }'
    + '</style></head><body></body></html>');
  d.close();
  d.title = opts.titulo || '';
  fuentes.forEach(f => {
    const src = f instanceof Blob ? URL.createObjectURL(f) : f;
    if (f instanceof Blob) urls.push(src);
    const h = d.createElement('div');
    h.className = 'h';
    const img = d.createElement('img');
    img.src = src;
    h.appendChild(img);
    d.body.appendChild(h);
  });
  await Promise.all([...d.images].map(i => i.decode().catch(() => {})));

  const w = fr.contentWindow;
  // En la compu print() espera a que se cierre el diálogo; en el teléfono vuelve
  // enseguida y avisa con afterprint. Si no llega, se limpia en la próxima impresión.
  w.addEventListener('afterprint', () => setTimeout(limpiar, 1000));
  w.focus();
  w.print();
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
function _vimecoSesion() {
  try { return JSON.parse(localStorage.getItem('vimeco_session')) || null; } catch (_) { return null; }
}

// Cierra la sesión de este dispositivo del todo: la guardada, las copias viejas
// (responsable_code/name, que muchas pantallas leen primero), "Seguir como …" y,
// si el aviso push de este equipo era de esa persona, su token.
function cerrarSesionVimeco({ aviso, olvidar } = {}) {
  const s = _vimecoSesion();
  try {
    const p = JSON.parse(localStorage.getItem('vimeco_push_token'));
    if (olvidar && s && p && p.codigo === s.codigo && p.id && typeof FIREBASE_CONFIG !== 'undefined') {
      fetch(FIREBASE_CONFIG.databaseURL + '/usuarios/' + p.codigo + '/pushTokens/' + p.id + '.json',
        { method: 'DELETE', keepalive: true }).catch(() => {});
      localStorage.removeItem('vimeco_push_token');
    }
  } catch (_) {}
  try {
    ['vimeco_session', 'responsable_code', 'responsable_name'].forEach(k => localStorage.removeItem(k));
    if (olvidar) localStorage.removeItem('vimeco_ultimo_ingreso');
    ['responsable_code', 'responsable_name'].forEach(k => sessionStorage.removeItem(k));
    if (aviso) sessionStorage.setItem('vimeco_login_aviso', aviso);
  } catch (_) {}
  location.href = 'index.html';
}

/*
 * vimeco_session es la única fuente de quién está usando la app. Las copias de
 * sessionStorage/localStorage se pisan con ella al abrir cada pantalla: si no, una
 * pestaña o un ingreso viejo podía quedar con el código de otra persona.
 * Después se coteja con /usuarios: el ingreso viejo (antes de v268) leía el código
 * del desplegable y el nombre de otra consulta, y si se cambiaba de persona rápido
 * quedaban mezclados (código de uno, nombre y contraseña de otro) para siempre.
 * Las sesiones de antes de este control (sin `v`) cuyo nombre no coincide con el
 * de su código vuelven a pedir el ingreso; las nuevas sólo toman el nombre al día.
 */
(function () {
  const s = _vimecoSesion();
  if (!s || !s.codigo) return;
  try {
    sessionStorage.setItem('responsable_code', s.codigo);
    sessionStorage.setItem('responsable_name', s.nombre || '');
    localStorage.setItem('responsable_code', s.codigo);
    localStorage.setItem('responsable_name', s.nombre || '');
  } catch (_) {}

  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  window.addEventListener('load', async () => {
    if (typeof FIREBASE_CONFIG === 'undefined') return;
    let u;
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/usuarios/' + s.codigo + '.json', { cache: 'no-store' });
      if (!r.ok) return;
      u = await r.json();
    } catch (_) { return; }   // sin conexión: se sigue con lo guardado
    if (!u || !u.activo) {
      cerrarSesionVimeco({ olvidar: true, aviso: 'Tu usuario no está activo. Avisale a quien administra.' });
      return;
    }
    const igual = norm(u.nombre) === norm(s.nombre);
    if (!s.v && !igual) {
      cerrarSesionVimeco({ olvidar: true, aviso: 'Por seguridad, volvé a elegir tu usuario y poner tu contraseña.' });
      return;
    }
    if (s.v && igual) return;
    const viejo = s.nombre;
    const nueva = { ...s, nombre: u.nombre, v: 2 };
    try {
      localStorage.setItem('vimeco_session', JSON.stringify(nueva));
      sessionStorage.setItem('responsable_name', u.nombre);
      localStorage.setItem('responsable_name', u.nombre);
    } catch (_) {}
    if (viejo !== u.nombre) {
      ['hdr-name', 'menu-nombre', 'pf-nombre'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.textContent.trim() === viejo) el.textContent = u.nombre;
      });
    }
  });
})();
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('hdr-name');
  if (!el) return;
  // Con sesión, la pastilla del nombre abre el Perfil (firma, nombre en las OC, salir).
  const badge = el.closest('.user-badge');
  const s = _vimecoSesion();
  if (badge && s && s.codigo && !document.body.hasAttribute('data-perfil')) {
    badge.classList.add('user-badge--perfil');
    badge.setAttribute('role', 'link');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('title', 'Tu perfil');
    badge.setAttribute('aria-label', 'Tu perfil');
    const ir = () => { location.href = 'perfil.html'; };
    badge.addEventListener('click', ir);
    badge.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
  }
  const sync = () => {
    const t = el.textContent.trim();
    el.setAttribute('data-initials', (t && t !== '—') ? _hdrInitials(t) : '');
  };
  sync();
  new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true });
});
