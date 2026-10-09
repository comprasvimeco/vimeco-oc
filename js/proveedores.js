/* VIMECO S.A. — Proveedores: ficha de cada proveedor (datos de la base, editables),
   los artículos que se le compraron con su último precio, la comparación de un
   artículo entre proveedores y la OC armada con los artículos tildados. */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DIA = 86400000;
// Las OC que no fueron compras: no cuentan para precios ni frecuencias.
const ESTADOS_FUERA = new Set(['anulada', 'rechazada', 'cancelada']);
const esPrueba = oc => (oc.proveedor?.nombre || '').trim().toLowerCase() === 'x' ||
                       (oc.obra || '').trim().toLowerCase() === 'x';

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const normDesc = s => norm(s).replace(/[.,;:]+$/, '');
const digitos = s => String(s ?? '').replace(/\D/g, '');
const fmtCuit = d => d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : d;
const pad2 = n => String(n).padStart(2, '0');
const fmtFecha = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fmtCorta = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`; };
const fmtMonto = (n, moneda) => (moneda === 'USD' ? 'US$ ' : '$ ') +
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const diasDesde = ts => Math.max(0, Math.floor((Date.now() - ts) / DIA));

// Unidades escritas de mil formas: se juntan las comunes para comparar precios.
// Una bolsa es una unidad (el cemento x 25 kg se carga como "u" o como "BOL").
function normUnidad(u) {
  const x = norm(u).replace(/\./g, '');
  if (!x || ['u', 'un', 'uni', 'unid', 'unidad', 'unidades', 'ouni', 'c/u', 'cu', 'und',
             'bol', 'bolsa', 'bolsas'].includes(x)) return 'UNI';
  return x.toUpperCase();
}
const nombreUnidad = u => u === 'UNI' ? 'unidad o bolsa' : u;

function tsDe(oc) {
  if (oc.timestamp) return oc.timestamp;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(oc.fecha || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0;
}

function iniciales(nombre) {
  const w = String(nombre || '').replace(/\b(s\.?\s?a\.?\s?s?|s\.?\s?r\.?\s?l|s\.?\s?a\.?\s?i\.?\s?c|e hijos?)\b\.?/gi, ' ')
    .split(/\s+/).filter(x => /[a-z0-9]/i.test(x));
  return w.slice(0, 2).map(x => x.replace(/[^a-z0-9ñ]/gi, '')[0] || '').join('').toUpperCase() || '?';
}
function tonoDe(key) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 'a' + (h % 6);
}

// ─── Estado ─────────────────────────────────────────────
const S = {
  code: '', nombre: '', veTodo: false,
  hist: [], base: [],
  provs: new Map(),          // key → proveedor
  quien: 'mios', orden: 'frec',
  limite: 60,
  abierto: null,             // key del proveedor en la ficha
  artOrden: null, artQ: '', grupoAbierto: null,
  per: '90',
  sel: { key: null, items: new Map() },   // artículos tildados (de un solo proveedor)
  empujado: false,           // la ficha del teléfono sumó una entrada al historial del navegador
};

const prefKey = () => 'vimeco_prov_pref_' + S.code;
function guardarPref() {
  try { localStorage.setItem(prefKey(), JSON.stringify({ quien: S.quien, orden: S.orden })); } catch (_) {}
}

// ─── Modelo: proveedores con sus compras, agrupadas por artículo ─────────
function construir() {
  const map = new Map();
  const alias = new Map();     // key vieja (CUIT cambiado, nombre sin CUIT) → key de la base
  const porNombre = new Map(); // nombre normalizado → key de la base (OC sin CUIT)
  const nuevo = key => ({ key, base: null, ocs: [], items: [], n: 0, mias: 0, ult: 0, ultMia: 0 });

  S.base.forEach(b => {
    const d = digitos(b._key);
    const key = d.length >= 10 ? 'cuit_' + d : (b._key || 'nom_' + norm(b.nombre));
    const p = nuevo(key);
    p.base = b;
    map.set(key, p);
    Object.keys(b.alias || {}).forEach(k => alias.set(k, key));
    if (!porNombre.has(norm(b.nombre))) porNombre.set(norm(b.nombre), key);
  });

  S.hist.forEach(oc => {
    if (!oc || !oc.nroOC || ESTADOS_FUERA.has(oc.estado) || esPrueba(oc)) return;
    const pr = oc.proveedor || {};
    if (!String(pr.nombre || '').trim()) return;
    const d = digitos(pr.cuit);
    let key = d.length >= 10 ? 'cuit_' + d : 'nom_' + norm(pr.nombre);
    if (alias.has(key)) key = alias.get(key);
    else if (!map.has(key) && !d && porNombre.has(norm(pr.nombre))) key = porNombre.get(norm(pr.nombre));
    if (!map.has(key)) map.set(key, nuevo(key));
    map.get(key).ocs.push(oc);
  });

  map.forEach(p => {
    if (!p.ocs.length) return;
    p.ocs.sort((a, b) => tsDe(b) - tsDe(a));
    p.n = p.ocs.length;
    p.ult = tsDe(p.ocs[0]);
    const mias = p.ocs.filter(oc => oc.responsable?.codigo === S.code);
    p.mias = mias.length;
    p.ultMia = mias.length ? tsDe(mias[0]) : 0;

    const grupos = new Map();
    p.ocs.forEach(oc => {
      const ts = tsDe(oc), mia = oc.responsable?.codigo === S.code;
      const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
      (oc.items || []).forEach(it => {
        const desc = String(it.desc ?? it.descripcion ?? '').trim();
        const precio = parseFloat(it.unitario ?? it.precio_unitario);
        if (!desc || !(precio > 0)) return;
        const nd = normDesc(desc);
        const gk = nd + '|' + moneda;
        let g = grupos.get(gk);
        if (!g) {   // la OC más nueva va primero: su texto y su unidad quedan
          g = { id: p.key + '|' + gk, nd, desc, unidad: String(it.unidad || 'u').trim(), moneda, compras: [] };
          grupos.set(gk, g);
        }
        g.compras.push({ ts, cant: parseFloat(it.cant ?? it.cantidad) || 0, precio, obra: oc.obra || '', nroOC: oc.nroOC, mia });
      });
    });
    p.items = [...grupos.values()].map(g => {
      const ult = g.compras[0];
      const prev = g.compras.find(c => c.nroOC !== ult.nroOC);
      const ocs = new Set(g.compras.map(c => c.nroOC));
      const ocsMias = new Set(g.compras.filter(c => c.mia).map(c => c.nroOC));
      return Object.assign(g, {
        precio: ult.precio, ts: ult.ts, dias: diasDesde(ult.ts),
        var: prev ? (ult.precio - prev.precio) / prev.precio * 100 : null,
        n: ocs.size, mias: ocsMias.size, u: normUnidad(g.unidad),
        cantMia: (g.compras.find(c => c.mia) || {}).cant || 0,
      });
    });
  });
  S.provs = map;
}

// Datos a mostrar: los de la base y, si falta alguno, los de la última OC.
function datosDe(p) {
  const b = p.base || {}, o = p.ocs[0]?.proveedor || {};
  const v = (k, ko = k) => String(b[k] || o[ko] || '').trim();
  return {
    nombre: v('nombre'), cuit: v('cuit'), codigoInterno: v('codigoInterno'),
    condicionIVA: v('condicionIVA'), domicilio: v('domicilio'), localidad: String(b.localidad || '').trim(),
    provincia: String(b.provincia || '').trim(), cp: String(b.cp || '').trim(), telefonos: v('telefonos'),
    email: String(b.email || '').trim(), nombre_contacto: String(b.nombre_contacto || o.nombre_contacto || '').trim(),
    condicionPago: String(b.condicionPago || p.ocs.find(oc => String(oc.condicionPago || '').trim())?.condicionPago || '').trim(),
  };
}

// ─── Lista de proveedores ───────────────────────────────
function ordenar(lista) {
  const mios = S.quien === 'mios';
  const cnt = p => mios ? p.mias : p.n;
  const ult = p => mios ? p.ultMia : p.ult;
  return lista.sort(S.orden === 'frec'
    ? (a, b) => cnt(b) - cnt(a) || ult(b) - ult(a)
    : (a, b) => ult(b) - ult(a) || cnt(b) - cnt(a));
}

function filaProv(p) {
  const d = datosDe(p);
  const mios = S.quien === 'mios';
  let der = '';
  if (p.n) {
    const cnt = mios ? `${p.mias} ${p.mias === 1 ? 'tuya' : 'tuyas'}` : `${p.n} OC`;
    const f = fmtCorta(mios ? p.ultMia : p.ult);
    der = S.orden === 'frec' ? `<b>${cnt}</b><small>últ. ${f}</small>` : `<b>${f}</b><small>${cnt}</small>`;
  } else {
    der = '<small>Sin compras</small>';
  }
  const sub = [d.cuit || '', d.localidad || ''].filter(Boolean).join(' · ');
  return `<button type="button" class="pv-row${S.abierto === p.key ? ' on' : ''}" data-key="${esc(p.key)}">
    <span class="pv-av ${tonoDe(p.key)}">${esc(iniciales(d.nombre))}</span>
    <span style="min-width:0"><span class="pv-n" style="display:block">${esc(d.nombre)}</span>
      <span class="pv-s" style="display:block">${d.cuit ? esc(sub) : `<span class="mini mini--warn">Sin CUIT</span> ${esc(d.localidad)}`}</span></span>
    <span class="pv-r">${der}</span></button>`;
}

function pintarLista() {
  const todos = [...S.provs.values()];
  const conCompras = todos.filter(p => p.n);
  $('n-mios').textContent = conCompras.filter(p => p.mias).length;
  $('n-todos').textContent = conCompras.length;
  $('f-mios').setAttribute('aria-pressed', S.quien === 'mios');
  $('f-todos').setAttribute('aria-pressed', S.quien === 'todos');
  $('f-orden').innerHTML = icSvg('clock') + (S.orden === 'frec' ? 'Más frecuentes' : 'Más recientes');
  $('f-orden').title = 'Cambiar a ' + (S.orden === 'frec' ? 'más recientes' : 'más frecuentes');
  $('pv-cuenta').textContent = `${conCompras.length} con compras`;
  $('pv-cuenta').classList.remove('hidden');

  const q = norm($('q-prov').value);
  let html = '';
  if (q) {
    // Buscando: se busca en toda la base. Primero los que tienen compras.
    const toks = q.split(' ');
    const hay = p => {
      const d = datosDe(p);
      const txt = norm(d.nombre) + ' ' + digitos(d.cuit) + ' ' + norm(d.codigoInterno);
      return toks.every(t => txt.includes(t) || (digitos(t) && digitos(d.cuit).includes(digitos(t))));
    };
    const res = todos.filter(p => (p.n || !p.base?.inactivo) && hay(p));
    const con = ordenar(res.filter(p => p.n)), sin = res.filter(p => !p.n)
      .sort((a, b) => datosDe(a).nombre.localeCompare(datosDe(b).nombre));
    if (!res.length) html = '<div class="pv-vacio">No hay proveedores con ese nombre, CUIT o código.</div>';
    if (con.length) html += `<div class="pv-sep">Con compras · ${con.length}</div>` + con.slice(0, S.limite).map(filaProv).join('');
    if (sin.length) html += `<div class="pv-sep">En la base, sin compras · ${sin.length}</div>` + sin.slice(0, S.limite).map(filaProv).join('');
    if (con.length > S.limite || sin.length > S.limite) html += '<button type="button" class="pv-mas" id="ver-mas">Mostrar más</button>';
  } else {
    const lista = ordenar(conCompras.filter(p => S.quien === 'todos' || p.mias));
    if (!lista.length) {
      html = `<div class="pv-vacio">${S.quien === 'mios' ? 'Todavía no emitiste OC. En "De todos" están los proveedores de toda la empresa.' : 'Todavía no hay OC.'}</div>`;
    } else {
      html = lista.slice(0, S.limite).map(filaProv).join('');
      if (lista.length > S.limite) html += '<button type="button" class="pv-mas" id="ver-mas">Mostrar más</button>';
    }
    html += `<div class="pv-hint">${icSvg('info')}<span>${S.quien === 'mios'
      ? 'Los de las OC que emitiste vos. El buscador busca en toda la base.'
      : `Los de las OC de toda la empresa. El buscador también encuentra los ${(todos.length - conCompras.length).toLocaleString('es-AR')} de la base sin compras.`}</span></div>`;
  }
  $('lista').innerHTML = html;
}

// ─── Ficha ──────────────────────────────────────────────
function trendHtml(g) {
  if (g.var == null) return '';
  const v = Math.round(g.var * 10) / 10;
  if (Math.abs(v) < 0.5) return '<span class="pv-trend eq">= igual</span>';
  const t = Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + '%';
  return v > 0
    ? `<span class="pv-trend up" title="Contra la compra anterior"><svg class="icon" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>${t}</span>`
    : `<span class="pv-trend dn" title="Contra la compra anterior">${icSvg('chevron')}${t}</span>`;
}
const viejoHtml = g => g.dias > 30 ? `<span class="mini mini--amb">hace ${g.dias} días</span>` : '';

function ordenItems(p, items) {
  const o = S.artOrden;
  return items.slice().sort(
    o === 'mios' ? (a, b) => b.mias - a.mias || b.ts - a.ts
    : o === 'frec' ? (a, b) => b.n - a.n || b.ts - a.ts
    : (a, b) => b.ts - a.ts || b.n - a.n);
}

function filaItem(p, g) {
  const sel = S.sel.items.has(g.id);
  const abierto = S.grupoAbierto === g.id;
  const veCant = c => c.mia || S.veTodo;
  const hist = abierto ? `<div class="pv-hist">${g.compras.map(c => `<div><span>${fmtFecha(c.ts)}</span>
      <span>${veCant(c) ? esc(`${c.cant.toLocaleString('es-AR')} ${g.unidad}${c.obra ? ' · ' + c.obra : ''}`) : ''}${c.mia ? ' <span class="mini mini--ind">vos</span>' : ''}</span>
      <b>${fmtMonto(c.precio, g.moneda)}</b></div>`).join('')}</div>` : '';
  return `<div class="pv-it${sel ? ' sel' : ''}" data-g="${esc(g.id)}" tabindex="0" aria-expanded="${abierto}">
    <button type="button" class="pv-ck" data-ck="${esc(g.id)}" aria-pressed="${sel}" aria-label="Tildar ${esc(g.desc)}">${icSvg('checkSm')}</button>
    <div style="min-width:0"><div class="pv-it-d">${esc(g.desc)}</div>
      <div class="pv-it-s"><span>${esc(g.unidad)}</span><span>· ${g.n} ${g.n === 1 ? 'compra' : 'compras'}${g.mias ? ` (${g.mias} ${g.mias === 1 ? 'tuya' : 'tuyas'})` : ''}</span><span>· ${fmtCorta(g.ts)}</span>${trendHtml(g)}${viejoHtml(g)}</div></div>
    <div class="pv-it-p"><b>${fmtMonto(g.precio, g.moneda)}</b><small>por ${esc(g.unidad)} s/IVA</small></div>
    ${hist}</div>`;
}

function pintarItems(p) {
  const box = $('f-items');
  if (!box) return;
  const q = norm($('q-items')?.value || '');
  const toks = q ? q.split(' ') : [];
  const lista = ordenItems(p, p.items.filter(g => toks.every(t => g.nd.includes(t))));
  box.innerHTML = lista.length ? lista.map(g => filaItem(p, g)).join('')
    : `<div class="pv-vacio">${p.items.length ? 'Ningún artículo con ese texto.' : 'Todavía no hay compras a este proveedor en la app.'}</div>`;
  document.querySelectorAll('#f-orden-items button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === S.artOrden));
}

function pintarFicha() {
  const col = $('ficha-col');
  const p = S.provs.get(S.abierto);
  if (!p) {
    col.innerHTML = '<div class="pv-card pv-vacio">Elegí un proveedor de la lista para ver sus datos y lo que se le compró.</div>';
    return;
  }
  const d = datosDe(p);
  const pills = [
    p.base ? `<span class="mini mini--ind">En la base${d.codigoInterno ? ' · ' + esc(d.codigoInterno) : ''}</span>` : '<span class="mini mini--amb">No está en la base</span>',
    d.cuit ? '' : '<span class="mini mini--warn">Sin CUIT</span>',
    p.n ? `<span class="mini">${p.n} OC${p.mias ? ` · ${p.mias} ${p.mias === 1 ? 'tuya' : 'tuyas'}` : ''}</span>` : '<span class="mini">Sin compras</span>',
    p.n ? `<span class="mini">Última ${fmtFecha(p.ult)}</span>` : '',
  ].join('');
  const dd = (icon, label, val) => `<dt>${icSvg(icon)}${label}</dt><dd class="${val ? '' : 'vac'}">${val ? esc(val) : 'Sin cargar'}</dd>`;
  const dom = [d.domicilio, [d.localidad, d.cp && `(${d.cp})`].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const ed = p.base?.editadoEn ? `<div class="pv-edit-meta">Última edición: ${esc(p.base.editadoPor?.nombre || '—')}, ${fmtFecha(p.base.editadoEn)}</div>` : '';

  if (!S.artOrden) S.artOrden = p.mias ? 'mios' : 'rec';
  col.innerHTML = `<div class="pv-ficha">
    <button type="button" class="pv-back" id="ficha-volver">${icSvg('chevL')}Proveedores</button>
    <div class="pv-card">
      <div class="pv-fh"><span class="pv-av ${tonoDe(p.key)}">${esc(iniciales(d.nombre))}</span>
        <div class="pv-fh-t"><div class="pv-fh-n">${esc(d.nombre)}</div><div class="pv-fh-p">${pills}</div></div></div>
      <div class="pv-acts">
        <button type="button" class="pv-btn pv-btn--clear" id="f-editar">${icSvg('edit')}${d.cuit ? 'Editar datos' : 'Completar datos'}</button>
        <button type="button" class="pv-btn" id="f-nueva">${icSvg('plus')}OC sin artículos</button>
      </div>
    </div>
    <div class="pv-card">
      <div class="pv-side-t"><span>Datos</span></div>
      <dl class="pv-dat">
        ${dd('copy', 'CUIT', d.cuit)}${dd('tag', 'Cód. interno', d.codigoInterno)}${dd('file', 'IVA', d.condicionIVA)}
        ${dd('building', 'Domicilio', dom)}${dd('phone', 'Teléfonos', d.telefonos)}${dd('mail', 'Email', d.email)}
        ${dd('user', 'Contacto', d.nombre_contacto)}${dd('clock', 'Pago habitual', d.condicionPago)}
      </dl>${ed}
    </div>
    <div class="pv-panel">
      <div class="pv-phead"><b>Artículos comprados · ${p.items.length}</b></div>
      ${p.items.length ? `<div class="pv-tools">
        <div class="pv-search">${icSvg('search')}<input type="search" id="q-items" placeholder="Buscar artículo" autocomplete="off"></div>
        <div class="pv-seg" id="f-orden-items">${p.mias ? '<button type="button" data-o="mios">Mis más comprados</button>' : ''}<button type="button" data-o="rec">Recientes</button><button type="button" data-o="frec">Más comprados</button></div>
      </div>` : ''}
      <div id="f-items"></div>
    </div>
  </div>`;
  pintarItems(p);
}

function abrirFicha(key, { push = true } = {}) {
  if (S.abierto !== key) { S.grupoAbierto = null; S.artOrden = null; }
  S.abierto = key;
  pintarFicha();
  pintarLista();
  const chico = innerWidth < 1000;
  $('pv-main').classList.add('ver-ficha');
  const url = '?p=' + encodeURIComponent(key);
  if (push && chico && !S.empujado) { history.pushState({ p: key }, '', url); S.empujado = true; }
  else history.replaceState({ p: key }, '', url);
  if (chico) scrollTo(0, 0);
}

// Volver a la lista en el teléfono: si la ficha se abrió desde la lista, con el
// "atrás" del navegador (así también funciona el botón de Android).
function volverALista() {
  if (S.empujado) history.back();
  else { history.replaceState(null, '', location.pathname); cerrarFicha(); }
}

function cerrarFicha() {
  S.empujado = false;
  $('pv-main').classList.remove('ver-ficha');
  if (innerWidth < 1000) { S.abierto = null; pintarLista(); }
}

// ─── Comparar por artículo ──────────────────────────────
function pintarArticulos() {
  const box = $('art-res');
  const q = norm($('q-art').value);
  document.querySelectorAll('[data-per]').forEach(b => b.setAttribute('aria-pressed', b.dataset.per === S.per));
  if (q.length < 2) {
    box.innerHTML = '<div class="pv-card pv-vacio">Escribí lo que buscás y se comparan los precios de todos los proveedores que lo vendieron.</div>';
    return;
  }
  const toks = q.split(' ');
  const rows = [];
  S.provs.forEach(p => p.items.forEach(g => {
    if (!toks.every(t => g.nd.includes(t))) return;
    if (S.per === '90' && g.dias > 90) return;
    if (S.per === 'mias' && !g.mias) return;
    rows.push({ p, g });
  }));
  if (!rows.length) {
    box.innerHTML = `<div class="pv-card pv-vacio">No hay compras de "${esc($('q-art').value.trim())}"${S.per === '90' ? ' en los últimos 90 días. Probá con "Todo".' : '.'}</div>`;
    return;
  }
  // Se compara dentro de la misma unidad y moneda; el más barato reciente se marca.
  const grupos = new Map();
  rows.forEach(r => {
    const k = r.g.u + '|' + r.g.moneda;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  });
  const MAX = 150;
  let mostrados = 0;
  const html = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, rs]) => {
    rs.sort((a, b) => a.g.precio - b.g.precio);
    const recientes = rs.filter(r => r.g.dias <= 90);
    const best = new Set(recientes.map(r => r.p.key)).size > 1 ? recientes[0] : null;
    const [u, mon] = k.split('|');
    const vis = rs.slice(0, Math.max(0, MAX - mostrados));
    mostrados += vis.length;
    if (!vis.length) return '';
    return `<div class="pv-panel" style="margin-bottom:.75rem">
      <div class="pv-grp-h">${icSvg('box')}Por ${esc(nombreUnidad(u))}${mon === 'USD' ? ' · en dólares' : ''} · ${rs.length} ${rs.length === 1 ? 'resultado' : 'resultados'}</div>
      ${vis.map(r => {
        const sel = S.sel.items.has(r.g.id);
        const dim = S.sel.items.size && S.sel.key !== r.p.key;
        const d = datosDe(r.p);
        return `<div class="pv-cmp${sel ? ' sel' : ''}${dim ? ' dim' : ''}" data-cg="${esc(r.g.id)}" data-pk="${esc(r.p.key)}" tabindex="0">
          <button type="button" class="pv-ck" data-ck="${esc(r.g.id)}" data-pk="${esc(r.p.key)}" aria-pressed="${sel}" aria-label="Tildar">${icSvg('checkSm')}</button>
          <div style="min-width:0"><button type="button" class="pv-cmp-p" data-abrir="${esc(r.p.key)}">${esc(d.nombre)}</button>
            <div class="pv-cmp-d">${esc(r.g.desc)}</div>
            <div class="pv-it-s"><span>${fmtFecha(r.g.ts)}</span><span>· ${r.g.n} ${r.g.n === 1 ? 'compra' : 'compras'}</span>${r === best ? '<span class="pv-best">Más barato reciente</span>' : ''}${viejoHtml(r.g)}</div></div>
          <div class="pv-it-p"><b>${fmtMonto(r.g.precio, r.g.moneda)}</b><small>por ${esc(r.g.unidad)} s/IVA</small></div></div>`;
      }).join('')}</div>`;
  }).join('');
  box.innerHTML = html + (rows.length > MAX ? `<div class="pv-hint" style="border-radius:12px">${icSvg('info')}Se muestran ${MAX} de ${rows.length}: sumá otra palabra para afinar.</div>` : '');
}

// ─── Selección de artículos ─────────────────────────────
function buscarGrupo(pk, gid) {
  const p = S.provs.get(pk);
  return p ? p.items.find(g => g.id === gid) : null;
}

async function tildar(pk, gid) {
  if (S.sel.items.has(gid)) {
    S.sel.items.delete(gid);
    if (!S.sel.items.size) S.sel.key = null;
  } else {
    if (S.sel.items.size && S.sel.key !== pk) {
      const otro = datosDe(S.provs.get(S.sel.key)).nombre;
      const n = S.sel.items.size;
      const ok = await showConfirm('Una OC es para un solo proveedor',
        `Tenés ${n} ${n === 1 ? 'artículo tildado' : 'artículos tildados'} de ${otro}. Si tildás este, se quitan.`,
        { boton: 'Tildar este', tono: 'warn', icono: 'alert', cancelar: 'Dejarlo' });
      if (!ok) return;
      S.sel.items.clear();
    }
    const g = buscarGrupo(pk, gid);
    if (!g) return;
    S.sel.key = pk;
    S.sel.items.set(gid, g);
  }
  repintarSeleccion();
}

function repintarSeleccion() {
  const n = S.sel.items.size;
  $('selbar').classList.toggle('hidden', !n);
  if (n) {
    $('sel-n').textContent = `${n} ${n === 1 ? 'artículo' : 'artículos'}`;
    $('sel-s').textContent = datosDe(S.provs.get(S.sel.key)).nombre;
  }
  if (S.abierto) { const p = S.provs.get(S.abierto); if (p) pintarItems(p); }
  if (!$('vista-art').classList.contains('hidden')) pintarArticulos();
}

// ─── Armar la OC ────────────────────────────────────────
let _oc = null;   // { p, filas: [{ g, cant }] }

function abrirArmarOC() {
  const p = S.provs.get(S.sel.key);
  if (!p) return;
  _oc = { p, filas: [...S.sel.items.values()].map(g => ({ g, cant: g.cantMia || (S.veTodo ? g.compras[0].cant : 0) || 1 })) };
  pintarArmarOC();
  $('modal-oc').classList.remove('hidden');
}

function pintarArmarOC() {
  const { p, filas } = _oc;
  const d = datosDe(p);
  $('oc-title').textContent = 'Nueva OC a ' + d.nombre;
  $('oc-sub').textContent = `${filas.length} ${filas.length === 1 ? 'artículo' : 'artículos'} · con el último precio`;
  $('oc-items').innerHTML = filas.map((f, i) => `<div class="pv-ao">
    <div style="min-width:0"><div class="pv-ao-d">${esc(f.g.desc)}</div>
      <div class="pv-ao-s"><span>${fmtMonto(f.g.precio, f.g.moneda)} / ${esc(f.g.unidad)}</span><span>· ${fmtFecha(f.g.ts)}</span>${viejoHtml(f.g)}</div></div>
    <div class="pv-ao-t" data-tot="${i}">${fmtMonto(Math.round(f.g.precio * f.cant * 100) / 100, f.g.moneda)}</div>
    <div class="pv-ao-q"><span class="pv-step"><button type="button" data-menos="${i}" aria-label="Menos">−</button>
      <input type="text" inputmode="decimal" data-cant="${i}" value="${String(f.cant).replace('.', ',')}" aria-label="Cantidad">
      <button type="button" data-mas="${i}" aria-label="Más">+</button></span><small>${esc(f.g.unidad)}</small></div>
  </div>`).join('');
  pintarTotalOC();
}

function pintarTotalOC() {
  const { p, filas } = _oc;
  const monedas = new Set(filas.map(f => f.g.moneda));
  const tot = filas.reduce((s, f) => s + f.g.precio * f.cant, 0);
  $('oc-tot').innerHTML = monedas.size === 1
    ? `<span>Aproximado sin IVA</span><b>${fmtMonto(Math.round(tot * 100) / 100, [...monedas][0])}</b>` : '';
  filas.forEach((f, i) => {
    const el = document.querySelector(`[data-tot="${i}"]`);
    if (el) el.textContent = fmtMonto(Math.round(f.g.precio * f.cant * 100) / 100, f.g.moneda);
  });
  const viejos = filas.filter(f => f.g.dias > 30).length;
  const cp = datosDe(p).condicionPago;
  const avisos = [];
  if (monedas.size > 1) avisos.push(`<div class="pv-aviso pv-aviso--del">${icSvg('alert')}<span>Hay artículos en pesos y en dólares: una OC va en una sola moneda. Quitá los de una de las dos.</span></div>`);
  if (viejos) avisos.push(`<div class="pv-aviso pv-aviso--amb">${icSvg('alert')}<span>${viejos === 1 ? 'Un precio tiene' : viejos + ' precios tienen'} más de 30 días. Quedan cargados como referencia: confirmalos con el proveedor.</span></div>`);
  avisos.push(`<div class="pv-aviso pv-aviso--ind">${icSvg('info')}<span>Se abre la Orden de Compra con el proveedor, sus datos${cp ? ` y la condición de pago habitual (${esc(cp)})` : ''}. Ahí elegís la obra, y los precios y las cantidades se pueden cambiar.</span></div>`);
  $('oc-avisos').innerHTML = avisos.join('');
  $('oc-abrir').disabled = monedas.size > 1 || filas.some(f => !(f.cant > 0));
}

// Mismo camino que "Usar como base" del Historial: la OC lo toma al arrancar.
function irALaOC(p, filas) {
  const d = datosDe(p);
  const ultOC = p.ocs[0];
  const impuestos = (ultOC?.impuestosExtra || [])
    .filter(i => i && i.nombre && i.pct != null)
    .map(i => ({ nombre: i.nombre, pct: i.pct, monto: 0 }));
  const moneda = filas.length ? filas[0].g.moneda : (ultOC?.moneda === 'USD' ? 'USD' : 'ARS');
  const payload = {
    ts: Date.now(),
    proveedor: {
      nombre: d.nombre, cuit: d.cuit, codigoInterno: d.codigoInterno, domicilio: d.domicilio,
      telefonos: d.telefonos, condicionIVA: d.condicionIVA, nombre_contacto: d.nombre_contacto,
      enBase: p.base ? p.base._key : null,
    },
    condicionPago: d.condicionPago,
    moneda,
    impuestos,
    items: filas.map(f => ({ descripcion: f.g.desc, unidad: f.g.unidad, cantidad: f.cant, precio_unitario: f.g.precio })),
  };
  try { sessionStorage.setItem('oc_desde_proveedor', JSON.stringify(payload)); }
  catch (_) { toast('No se pudo preparar la OC.', 'error'); return; }
  S.sel.items.clear(); S.sel.key = null;
  window.location.href = 'app.html';
}

// ─── Editar / agregar proveedor ─────────────────────────
let _ed = null;   // { p (null si es nuevo), orig: {campo: valor} }
const CAMPOS = () => [...document.querySelectorAll('#edit-form [data-f]')];

function abrirEdicion(p) {
  const d = p ? datosDe(p) : {};
  const orig = {};
  CAMPOS().forEach(el => { orig[el.dataset.f] = String(d[el.dataset.f] || ''); el.value = orig[el.dataset.f]; el.classList.remove('cambio', 'is-falta'); });
  _ed = { p, orig };
  $('edit-title').textContent = p ? 'Datos del proveedor' : 'Proveedor nuevo';
  $('edit-sub').textContent = p ? (p.base ? 'En la base de proveedores' : 'Todavía no está en la base: al guardar se agrega') : 'Se agrega a la base de proveedores';
  $('edit-aviso').classList.toggle('hidden', !p);
  marcarCambios();
  $('modal-edit').classList.remove('hidden');
  setTimeout(() => (p ? (d.cuit ? $('e-tel') : $('e-cuit')) : $('e-nombre')).focus(), 50);
}

function cambiosEdicion() {
  return CAMPOS().filter(el => el.value.trim() !== _ed.orig[el.dataset.f]);
}
function marcarCambios() {
  const c = cambiosEdicion();
  CAMPOS().forEach(el => el.classList.toggle('cambio', !!_ed.p && c.includes(el)));
  $('edit-st').textContent = !_ed.p ? '' : c.length ? `${c.length} ${c.length === 1 ? 'cambio' : 'cambios'} sin guardar` : 'Sin cambios';
  $('edit-save').disabled = !!_ed.p && !c.length;
}

async function cerrarEdicion() {
  if (_ed && cambiosEdicion().length && (_ed.p || CAMPOS().some(el => el.value.trim()))) {
    const ok = await showConfirm('Descartar los cambios', 'Lo que cambiaste en los datos del proveedor no se guarda.',
      { boton: 'Descartar', tono: 'del', icono: 'trash', cancelar: 'Seguir editando' });
    if (!ok) return;
  }
  $('modal-edit').classList.add('hidden');
  _ed = null;
}

async function guardarEdicion() {
  const val = f => (document.querySelector(`#edit-form [data-f="${f}"]`).value || '').trim();
  const nombre = val('nombre');
  const dig = digitos(val('cuit'));
  if (!nombre) { $('e-nombre').classList.add('is-falta'); $('e-nombre').focus(); toast('Falta la razón social.', 'error'); return; }
  if (dig.length !== 11) { $('e-cuit').classList.add('is-falta'); $('e-cuit').focus(); toast('El CUIT tiene que tener 11 números.', 'error'); return; }

  const p = _ed.p;
  const newKey = 'cuit_' + dig;
  const oldKey = p?.base?._key || null;
  const existe = await getProveedorBaseByCuit(dig).catch(() => null);

  if (!p && existe) {
    const ok = await showConfirm('Ya está en la base', `El CUIT ${fmtCuit(dig)} es de "${existe.nombre}".`,
      { boton: 'Ver su ficha', tono: 'info', icono: 'info', cancelar: 'Volver' });
    if (ok) { $('modal-edit').classList.add('hidden'); _ed = null; abrirFicha(newKey); }
    return;
  }
  if (p && existe && newKey !== oldKey && newKey !== p.key) {
    const ok = await showConfirm('Ese CUIT ya está en la base',
      `${fmtCuit(dig)} es de "${existe.nombre}". Si guardás, sus datos se reemplazan por estos.`,
      { boton: 'Reemplazar', tono: 'warn', icono: 'alert' });
    if (!ok) return;
  } else if (oldKey && oldKey !== newKey) {
    const ok = await showConfirm('Cambiar el CUIT',
      `Se mueve "${nombre}" de ${fmtCuit(digitos(oldKey))} a ${fmtCuit(dig)} en la base de proveedores.`,
      { boton: 'Guardar', tono: 'ok', icono: 'checkSm' });
    if (!ok) return;
  }

  // Se conservan los campos que este formulario no edita (provincia, inactivo, ref…).
  const prev = (p?.base) || (existe || {});
  const record = { ...prev };
  delete record._key;
  CAMPOS().forEach(el => {
    const v = el.value.trim();
    if (v) record[el.dataset.f] = v; else delete record[el.dataset.f];
  });
  record.nombre = nombre;
  record.cuit = fmtCuit(dig);
  record.editadoPor = { codigo: S.code, nombre: S.nombre };
  record.editadoEn = Date.now();
  // Las OC viejas siguen con el CUIT (o el nombre) de antes: se recuerda para no partir al proveedor.
  if (p && p.key !== newKey) record.alias = { ...(record.alias || {}), [p.key]: true };
  if (oldKey && oldKey !== newKey) record.alias = { ...(record.alias || {}), [oldKey]: true };

  $('edit-save').disabled = true;
  try {
    await saveProveedorBase(newKey, record);
    if (oldKey && oldKey !== newKey) {
      try { await deleteProveedorBase(oldKey); } catch (_) {}
      try { await deleteProveedorSeen(oldKey); } catch (_) {}
    }
    S.base = S.base.filter(b => b._key !== oldKey && b._key !== newKey).concat({ ...record, _key: newKey });
    sessionStorage.removeItem('proveedores_cache');   // la OC la vuelve a armar con lo nuevo
    construir();
    $('modal-edit').classList.add('hidden');
    _ed = null;
    toast(p ? 'Datos guardados en la base.' : 'Proveedor agregado a la base.', 'success');
    S.sel.items.clear(); S.sel.key = null;
    repintarSeleccion();
    abrirFicha(newKey, { push: false });
  } catch (e) {
    console.warn('guardarEdicion:', e);
    toast('No se pudo guardar. Revisá la conexión y reintentá.', 'error');
  } finally {
    $('edit-save').disabled = false;
  }
}

// ─── Pestañas ───────────────────────────────────────────
function verPestana(art) {
  $('tab-prov').setAttribute('aria-selected', !art);
  $('tab-art').setAttribute('aria-selected', art);
  $('vista-prov').classList.toggle('hidden', art);
  $('vista-art').classList.toggle('hidden', !art);
  if (art) { pintarArticulos(); $('q-art').focus(); }
}

// ─── Arranque ───────────────────────────────────────────
function enlazar() {
  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icSvg(el.dataset.ic); });
  $('btn-back').addEventListener('click', () => {
    if ($('pv-main').classList.contains('ver-ficha') && innerWidth < 1000) volverALista();
    else window.location.href = 'menu.html';
  });
  window.addEventListener('popstate', e => {
    if (e.state?.p && S.provs.has(e.state.p)) abrirFicha(e.state.p, { push: false });
    else { cerrarFicha(); scrollTo(0, 0); }
  });

  $('tab-prov').addEventListener('click', () => verPestana(false));
  $('tab-art').addEventListener('click', () => verPestana(true));
  $('btn-nuevo').addEventListener('click', () => abrirEdicion(null));

  $('q-prov').addEventListener('input', () => { S.limite = 60; pintarLista(); });
  $('f-mios').addEventListener('click', () => { S.quien = 'mios'; S.limite = 60; guardarPref(); pintarLista(); });
  $('f-todos').addEventListener('click', () => { S.quien = 'todos'; S.limite = 60; guardarPref(); pintarLista(); });
  $('f-orden').addEventListener('click', () => { S.orden = S.orden === 'frec' ? 'rec' : 'frec'; guardarPref(); pintarLista(); });
  $('lista').addEventListener('click', e => {
    if (e.target.closest('#ver-mas')) { S.limite += 120; pintarLista(); return; }
    const r = e.target.closest('.pv-row');
    if (r) abrirFicha(r.dataset.key);
  });

  $('ficha-col').addEventListener('click', e => {
    const p = S.provs.get(S.abierto);
    if (!p) return;
    if (e.target.closest('#ficha-volver')) { volverALista(); return; }
    if (e.target.closest('#f-editar')) { abrirEdicion(p); return; }
    if (e.target.closest('#f-nueva')) { irALaOC(p, []); return; }
    const o = e.target.closest('#f-orden-items button');
    if (o) { S.artOrden = o.dataset.o; pintarItems(p); return; }
    const ck = e.target.closest('[data-ck]');
    if (ck) { tildar(p.key, ck.dataset.ck); return; }
    if (e.target.closest('.pv-hist')) return;
    const it = e.target.closest('.pv-it');
    if (it) { S.grupoAbierto = S.grupoAbierto === it.dataset.g ? null : it.dataset.g; pintarItems(p); }
  });
  $('ficha-col').addEventListener('input', e => {
    if (e.target.id === 'q-items') pintarItems(S.provs.get(S.abierto));
  });
  $('ficha-col').addEventListener('keydown', e => {
    const it = e.target.closest?.('.pv-it');
    if (it && e.target === it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); it.click(); }
  });

  $('q-art').addEventListener('input', pintarArticulos);
  document.querySelectorAll('[data-per]').forEach(b => b.addEventListener('click', () => { S.per = b.dataset.per; pintarArticulos(); }));
  $('art-res').addEventListener('click', e => {
    const ab = e.target.closest('[data-abrir]');
    if (ab) { verPestana(false); abrirFicha(ab.dataset.abrir); return; }
    const r = e.target.closest('[data-cg]');
    if (r) tildar(r.dataset.pk, r.dataset.cg);
  });
  $('art-res').addEventListener('keydown', e => {
    const r = e.target.closest?.('.pv-cmp');
    if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tildar(r.dataset.pk, r.dataset.cg); }
  });

  $('sel-limpiar').addEventListener('click', () => { S.sel.items.clear(); S.sel.key = null; repintarSeleccion(); });
  $('sel-oc').addEventListener('click', abrirArmarOC);

  const cerrarOC = () => $('modal-oc').classList.add('hidden');
  $('oc-close').addEventListener('click', cerrarOC);
  $('oc-cancel').addEventListener('click', cerrarOC);
  $('oc-abrir').addEventListener('click', () => irALaOC(_oc.p, _oc.filas));
  $('oc-items').addEventListener('click', e => {
    const m = e.target.closest('[data-menos],[data-mas]');
    if (!m) return;
    const i = +(m.dataset.menos ?? m.dataset.mas);
    const f = _oc.filas[i];
    f.cant = Math.max(0, Math.round(((f.cant || 0) + (m.dataset.mas != null ? 1 : -1)) * 100) / 100);
    document.querySelector(`[data-cant="${i}"]`).value = String(f.cant).replace('.', ',');
    pintarTotalOC();
  });
  $('oc-items').addEventListener('input', e => {
    const i = e.target.dataset.cant;
    if (i == null) return;
    _oc.filas[+i].cant = parseFloat(e.target.value.replace(/\./g, '').replace(',', '.')) || 0;
    pintarTotalOC();
  });

  $('edit-close').addEventListener('click', cerrarEdicion);
  $('edit-cancel').addEventListener('click', cerrarEdicion);
  $('edit-save').addEventListener('click', guardarEdicion);
  $('edit-form').addEventListener('input', e => { e.target.classList.remove('is-falta'); marcarCambios(); });
  $('edit-form').addEventListener('submit', e => { e.preventDefault(); guardarEdicion(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('modal-edit').classList.contains('hidden')) cerrarEdicion();
    else if (!$('modal-oc').classList.contains('hidden')) cerrarOC();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  S.code = _s.codigo;
  S.nombre = _s.nombre || '';
  $('hdr-name').textContent = _s.nombre;
  enlazar();

  let pref = null;
  try { pref = JSON.parse(localStorage.getItem(prefKey())); } catch (_) {}

  try {
    const [hist, base, alc] = await Promise.all([
      getHistorial('0000'),
      getProveedoresBase(),
      alcanceOC(S.code).catch(() => ({ isAdmin: false })),
    ]);
    S.hist = hist;
    S.base = base;
    S.veTodo = !!alc.isAdmin;   // los admins ven también cantidades y obras de las compras de otros
  } catch (e) {
    console.warn('proveedores:', e);
    $('lista').innerHTML = '<div class="pv-vacio">No se pudieron cargar los proveedores. <button type="button" class="pv-btn" onclick="location.reload()">Reintentar</button></div>';
    return;
  }
  construir();
  const hayMios = [...S.provs.values()].some(p => p.mias);
  S.quien = pref?.quien || (hayMios ? 'mios' : 'todos');
  S.orden = pref?.orden || 'frec';
  if (S.quien === 'mios' && !hayMios) S.quien = 'todos';
  pintarLista();

  const pk = new URLSearchParams(location.search).get('p');
  if (pk && S.provs.has(pk)) abrirFicha(pk, { push: false });
  else history.replaceState(null, '', location.pathname);
});
