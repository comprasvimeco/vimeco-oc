/* ===================================================
   VIMECO S.A. — Panel de Reportes (Fase A)
   reportes.js

   Lee /historial completo (solo admin) y muestra el gasto por obra,
   equipo, proveedor, responsable y mes. Reexpresa cada OC en ARS o USD
   usando la cotización guardada en la propia OC (cotizacion), con
   fallback al dólar del día para OC históricas sin snapshot.
   =================================================== */

let ALL = [];   // todas las OC (admin)

const $ = id => document.getElementById(id);

const state = {
  desde:  '',
  hasta:  '',
  moneda: 'ARS',       // moneda de visualización
  rate:   'oficial',   // 'oficial' | 'blue' — qué cotización usar para convertir
  incluirNoEmitidas: false, // incluir pendientes/rechazadas
};

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtMoney(n, cur) {
  const v = (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (cur === 'USD' ? 'US$ ' : '$ ') + v;
}

// ---- Conversión de moneda por OC ----
// Usa la cotización guardada en la OC; si no la tiene (OC histórica), cae al
// dólar del día cacheado. Devuelve la cotización de venta o null si no hay dato.
function rateFor(oc) {
  const snap = oc.cotizacion || (typeof getDolarCached === 'function' ? getDolarCached() : null);
  if (!snap) return null;
  const r = snap[state.rate];
  if (!r) return null;
  return r.venta || r.compra || null;
}

// Monto de la OC expresado en la moneda pedida. null si hace falta convertir
// y no hay ninguna cotización disponible.
function amountIn(oc, cur) {
  const total  = Number(oc.total) || 0;
  const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
  if (moneda === cur) return total;
  const rate = rateFor(oc);
  if (!rate) return null;
  return cur === 'ARS' ? total * rate : total / rate;
}

// ¿Se convirtió esta OC con el dólar de hoy (por no tener snapshot propio)?
function usedFallback(oc) {
  const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
  return moneda !== state.moneda && !oc.cotizacion;
}

// ---- Filtro ----
function getFiltered() {
  return ALL.filter(oc => {
    if (!state.incluirNoEmitidas) {
      const e = oc.estado || 'emitida';
      if (e === 'pendiente' || e === 'rechazada') return false;
    }
    const ts = oc.timestamp || 0;
    if (state.desde && ts < new Date(state.desde + 'T00:00:00').getTime()) return false;
    if (state.hasta && ts > new Date(state.hasta + 'T23:59:59').getTime()) return false;
    return true;
  });
}

// ---- Agrupación ----
function groupSum(list, keyFn, labelFn) {
  const map = new Map();
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) return;
    const k = keyFn(oc);
    const row = map.get(k) || { label: labelFn(oc), total: 0, count: 0 };
    row.total += amt;
    row.count += 1;
    map.set(k, row);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function monthKey(ts) {
  const d = new Date(ts || 0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthLabel(k) {
  const [y, m] = k.split('-');
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[Number(m) - 1] || m} ${y}`;
}

// ---- Render ----
function renderBars(containerId, rows, opts = {}) {
  const el = $(containerId);
  if (!rows.length) {
    el.innerHTML = `<div class="rep-empty">${opts.emptyMsg || 'Sin datos en el rango seleccionado.'}</div>`;
    return;
  }
  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
  const max   = Math.max(...shown.map(r => r.total)) || 1;
  el.innerHTML = shown.map(r => {
    const pct = Math.max(3, Math.round((r.total / max) * 100));
    return `
      <div class="rep-bar-row">
        <div class="rep-bar-head">
          <span class="rep-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="rep-bar-val">${fmtMoney(r.total, state.moneda)}</span>
        </div>
        <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${pct}%"></div></div>
        <div class="rep-bar-sub">${r.count} OC · ${Math.round((r.total / (opts.grandTotal || max)) * 100)}%</div>
      </div>`;
  }).join('');
}

function render() {
  const list = getFiltered();

  // KPIs
  let total = 0, count = 0, noConv = 0, fallback = 0;
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) { noConv++; return; }
    total += amt; count++;
    if (usedFallback(oc)) fallback++;
  });

  $('kpi-total').textContent = fmtMoney(total, state.moneda);
  $('kpi-count').textContent = count;
  $('kpi-avg').textContent   = fmtMoney(count ? total / count : 0, state.moneda);

  // Nota de conversión aproximada / no convertibles
  const notes = [];
  if (fallback) notes.push(`${fallback} OC sin cotización propia — convertidas al dólar de hoy.`);
  if (noConv)   notes.push(`${noConv} OC no se pudieron convertir (sin cotización disponible).`);
  const noteEl = $('rep-note');
  if (notes.length) { noteEl.innerHTML = notes.map(esc).join('<br>'); noteEl.classList.remove('hidden'); }
  else noteEl.classList.add('hidden');

  // Rankings
  const grand = total || 1;
  renderBars('rep-obras', groupSum(list, oc => oc.obra || '—', oc => oc.obra || 'Sin obra'),
    { grandTotal: grand, emptyMsg: 'No hay OC con obra en el rango.' });

  renderBars('rep-equipos', groupSum(list,
      oc => oc.equipo?.codigo || 'sin',
      oc => oc.equipo ? `${oc.equipo.codigo}${oc.equipo.tipo ? ' — ' + oc.equipo.tipo : ''}` : 'Sin equipo'),
    { grandTotal: grand, emptyMsg: 'No hay OC con equipo asignado.' });

  renderBars('rep-proveedores', groupSum(list,
      oc => oc.proveedor?.nombre || '—',
      oc => oc.proveedor?.nombre || 'Sin proveedor'),
    { grandTotal: grand, limit: 10, emptyMsg: 'Sin proveedores en el rango.' });

  renderBars('rep-responsables', groupSum(list,
      oc => oc.responsable?.codigo || '—',
      oc => oc.responsable?.nombre || '—'),
    { grandTotal: grand, emptyMsg: 'Sin responsables en el rango.' });

  // Evolución mensual (cronológico ascendente)
  const meses = groupSum(list, oc => monthKey(oc.timestamp), oc => monthKey(oc.timestamp))
    .map(r => ({ ...r, label: monthLabel(r.label), _k: r.label }))
    .sort((a, b) => a._k.localeCompare(b._k));
  renderBars('rep-meses', meses, { grandTotal: grand, emptyMsg: 'Sin movimientos.' });
}

// ---- Cotización del día (encabezado informativo) ----
function renderDolarHoy() {
  const snap = typeof getDolarCached === 'function' ? getDolarCached() : null;
  const el = $('rep-dolar-hoy');
  if (!snap) { el.textContent = 'Cotización del día no disponible.'; return; }
  const o = snap.oficial?.venta, b = snap.blue?.venta;
  el.innerHTML = `Dólar hoy — Oficial <strong>$ ${o ? fmtMoney(o, 'ARS').replace('$ ', '') : '—'}</strong> · Blue <strong>$ ${b ? fmtMoney(b, 'ARS').replace('$ ', '') : '—'}</strong>`;
}

// ---- Controles ----
function setupSegmented(groupId, key, onChange) {
  const grp = $(groupId);
  grp.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    state[key] = btn.dataset.val;
    [...grp.querySelectorAll('[data-val]')].forEach(b => b.classList.toggle('active', b === btn));
    onChange && onChange();
    render();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const code = sessionStorage.getItem('responsable_code') || localStorage.getItem('responsable_code');
  const name = sessionStorage.getItem('responsable_name') || localStorage.getItem('responsable_name');
  if (!code || !name) { window.location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', code);
  sessionStorage.setItem('responsable_name', name);
  $('hdr-name').textContent = name;

  $('btn-back').addEventListener('click', () => { window.location.href = 'administracion.html'; });

  // Gate admin
  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!isAdmin) { window.location.href = 'menu.html'; return; }

  // Controles
  setupSegmented('seg-moneda', 'moneda');
  setupSegmented('seg-rate',   'rate');
  $('rep-desde').addEventListener('change', () => { state.desde = $('rep-desde').value; render(); });
  $('rep-hasta').addEventListener('change', () => { state.hasta = $('rep-hasta').value; render(); });
  $('chk-no-emitidas').addEventListener('change', e => { state.incluirNoEmitidas = e.target.checked; render(); });
  $('btn-clear-dates').addEventListener('click', () => {
    state.desde = ''; state.hasta = '';
    $('rep-desde').value = ''; $('rep-hasta').value = '';
    render();
  });

  renderDolarHoy();
  // Refresca la cotización del día en cuanto llega (dolar.js hace warm en background)
  if (typeof getDolarSnapshot === 'function') getDolarSnapshot().then(renderDolarHoy).catch(() => {});

  // Datos
  try {
    ALL = await getHistorial(code, true);
    $('rep-loading').classList.add('hidden');
    $('rep-content').classList.remove('hidden');
    render();
  } catch (e) {
    console.error('getHistorial:', e);
    $('rep-loading').innerHTML = 'No se pudieron cargar las órdenes. Revisá tu conexión y recargá.';
  }
});
