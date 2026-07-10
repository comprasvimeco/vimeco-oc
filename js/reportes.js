/* ===================================================
   VIMECO S.A. — Panel de Reportes (Fase A)
   reportes.js

   Lee /historial completo (solo admin) y muestra el gasto por obra,
   equipo, proveedor, responsable y mes. Reexpresa cada OC en ARS o USD
   usando la cotización guardada en la propia OC (cotizacion), con
   fallback al dólar del día para OC históricas sin snapshot.

   Las secciones de Obra y Equipo son desplegables: al tocar una fila se
   ven las OC individuales, con un flag "revisar" para montos anómalos.
   =================================================== */

let ALL = [];   // todas las OC (admin)

const $ = id => document.getElementById(id);

const state = {
  desde:  '',
  hasta:  '',
  moneda: 'ARS',       // moneda de visualización
  rate:   'oficial',   // 'oficial' | 'blue' — qué cotización usar para convertir
  incluirNoEmitidas: false,
};

const expanded = new Set(); // claves de filas desplegadas (por sección+key)

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Monto completo con separadores de miles.
function fmtFull(n, cur) {
  const v = (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (cur === 'USD' ? 'US$ ' : '$ ') + v;
}

// Monto compacto para barras: millones / miles.
function fmtCompact(n, cur) {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Number(n) || 0);
  const s = (cur === 'USD' ? 'US$ ' : '$ ') + sign;
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' M';
  if (a >= 1e3) return s + (a / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' mil';
  return s + a.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// ---- Conversión de moneda por OC ----
function rateFor(oc) {
  const snap = oc.cotizacion || (typeof getDolarCached === 'function' ? getDolarCached() : null);
  if (!snap) return null;
  const r = snap[state.rate];
  if (!r) return null;
  return r.venta || r.compra || null;
}

function amountIn(oc, cur) {
  const total  = Number(oc.total) || 0;
  const moneda = oc.moneda === 'USD' ? 'USD' : 'ARS';
  if (moneda === cur) return total;
  const rate = rateFor(oc);
  if (!rate) return null;
  return cur === 'ARS' ? total * rate : total / rate;
}

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

// ---- Agrupación (con detalle de OC para drill-down) ----
function groupAgg(list, keyFn, labelFn) {
  const map = new Map();
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) return;
    const k = keyFn(oc);
    const row = map.get(k) || { key: k, label: labelFn(oc), total: 0, count: 0, ocs: [] };
    row.total += amt;
    row.count += 1;
    row.ocs.push({ oc, amt });
    map.set(k, row);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Marca una OC como "posible error" si su monto supera 10× la mediana de la
// obra/equipo (con al menos 3 OC en el grupo). Detecta los cargados ×1000.
function flagOutliers(row) {
  if (row.count < 3) return;
  const med = median(row.ocs.map(x => x.amt));
  if (med <= 0) return;
  row.ocs.forEach(x => { x.flag = x.amt > med * 10; });
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

function estadoChip(oc) {
  const e = oc.estado || 'emitida';
  const map = {
    emitida:    ['Emitida',    '#e8eef5', '#2b537d'],
    autorizada: ['Autorizada', '#e3f5e8', '#1e7d3a'],
    pendiente:  ['Pendiente',  '#fff4e0', '#9a6a00'],
    rechazada:  ['Rechazada',  '#fde6e6', '#b02a2a'],
  };
  const [txt, bg, fg] = map[e] || map.emitida;
  return `<span class="rep-chip" style="background:${bg};color:${fg}">${txt}</span>`;
}

// ---- Render de barras (con drill-down opcional) ----
function renderBars(containerId, rows, opts = {}) {
  const el = $(containerId);
  if (!rows.length) {
    el.innerHTML = `<div class="rep-empty">${opts.emptyMsg || 'Sin datos en el rango seleccionado.'}</div>`;
    return;
  }
  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
  const max   = Math.max(...shown.map(r => r.total)) || 1;
  const grand = opts.grandTotal || max;

  el.innerHTML = shown.map((r, i) => {
    const pct  = Math.max(2, Math.round((r.total / max) * 100));
    const share = Math.round((r.total / grand) * 100);
    const rowKey = containerId + '|' + r.key;
    const isOpen = opts.drill && expanded.has(rowKey);

    let drillHtml = '';
    if (opts.drill && isOpen) {
      flagOutliers(r);
      const ocs = [...r.ocs].sort((a, b) => b.amt - a.amt);
      drillHtml = `<div class="rep-drill">${ocs.map(({ oc, amt, flag }) => `
        <div class="rep-oc ${flag ? 'rep-oc-flag' : ''}">
          <div class="rep-oc-main">
            <span class="rep-oc-nro">${esc(oc.nroOC)}</span>
            <span class="rep-oc-prov">${esc(oc.proveedor?.nombre || '—')}</span>
          </div>
          <div class="rep-oc-meta">
            <span class="rep-oc-fecha">${esc(oc.fecha || '')}</span>
            ${estadoChip(oc)}
            ${flag ? '<span class="rep-flag" title="Monto muy por encima del resto — posible error de carga">⚠ revisar</span>' : ''}
          </div>
          <span class="rep-oc-total">${fmtFull(amt, state.moneda)}</span>
        </div>`).join('')}</div>`;
    }

    return `
      <div class="rep-bar-row ${opts.drill ? 'rep-clickable' : ''} ${isOpen ? 'rep-open' : ''}" data-rowkey="${esc(rowKey)}">
        <div class="rep-bar-head">
          <span class="rep-bar-rank">${i + 1}</span>
          ${opts.drill ? `<span class="rep-caret">${isOpen ? '▾' : '▸'}</span>` : ''}
          <span class="rep-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="rep-bar-val" title="${esc(fmtFull(r.total, state.moneda))}">${fmtCompact(r.total, state.moneda)}</span>
        </div>
        <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${pct}%"></div></div>
        <div class="rep-bar-sub">${r.count} OC · ${share}%</div>
        ${drillHtml}
      </div>`;
  }).join('');

  if (opts.drill && !el._wired) {
    el._wired = true;
    el.addEventListener('click', e => {
      const row = e.target.closest('.rep-bar-row');
      if (!row) return;
      const k = row.dataset.rowkey;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      render();
    });
  }
}

function render() {
  const list = getFiltered();

  // KPIs
  let total = 0, count = 0, noConv = 0, fallback = 0;
  const amounts = [];
  list.forEach(oc => {
    const amt = amountIn(oc, state.moneda);
    if (amt == null) { noConv++; return; }
    total += amt; count++; amounts.push(amt);
    if (usedFallback(oc)) fallback++;
  });

  $('kpi-total').textContent = fmtFull(total, state.moneda);
  $('kpi-count').textContent = count;
  $('kpi-avg').textContent   = fmtCompact(count ? total / count : 0, state.moneda);
  $('kpi-med').textContent   = fmtCompact(median(amounts), state.moneda);

  const notes = [];
  if (fallback) notes.push(`${fallback} OC sin cotización propia — convertidas al dólar de hoy.`);
  if (noConv)   notes.push(`${noConv} OC no se pudieron convertir (sin cotización disponible).`);
  const noteEl = $('rep-note');
  if (notes.length) { noteEl.innerHTML = notes.map(esc).join('<br>'); noteEl.classList.remove('hidden'); }
  else noteEl.classList.add('hidden');

  const grand = total || 1;

  renderBars('rep-obras', groupAgg(list, oc => oc.obra || '—', oc => oc.obra || 'Sin obra'),
    { grandTotal: grand, drill: true, emptyMsg: 'No hay OC con obra en el rango.' });

  renderBars('rep-equipos', groupAgg(list,
      oc => oc.equipo?.codigo || 'sin',
      oc => oc.equipo ? `${oc.equipo.codigo}${oc.equipo.tipo ? ' — ' + oc.equipo.tipo : ''}` : 'Sin equipo'),
    { grandTotal: grand, drill: true, emptyMsg: 'No hay OC con equipo asignado.' });

  renderBars('rep-proveedores', groupAgg(list,
      oc => oc.proveedor?.nombre || '—',
      oc => oc.proveedor?.nombre || 'Sin proveedor'),
    { grandTotal: grand, limit: 10, emptyMsg: 'Sin proveedores en el rango.' });

  renderBars('rep-responsables', groupAgg(list,
      oc => oc.responsable?.codigo || '—',
      oc => oc.responsable?.nombre || '—'),
    { grandTotal: grand, emptyMsg: 'Sin responsables en el rango.' });

  const meses = groupAgg(list, oc => monthKey(oc.timestamp), oc => monthKey(oc.timestamp))
    .map(r => ({ ...r, label: monthLabel(r.label), key: r.key }))
    .sort((a, b) => a.key.localeCompare(b.key));
  renderBars('rep-meses', meses, { grandTotal: grand, emptyMsg: 'Sin movimientos.' });
}

// ---- Cotización del día ----
function renderDolarHoy() {
  const snap = typeof getDolarCached === 'function' ? getDolarCached() : null;
  const el = $('rep-dolar-hoy');
  if (!snap) { el.textContent = 'Cotización del día no disponible.'; return; }
  const o = snap.oficial?.venta, b = snap.blue?.venta;
  const n = v => v ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—';
  el.innerHTML = `Dólar hoy · Oficial <strong>$${n(o)}</strong> · Blue <strong>$${n(b)}</strong>`;
}

// ---- Controles ----
function setupSegmented(groupId, key) {
  const grp = $(groupId);
  grp.addEventListener('click', e => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    state[key] = btn.dataset.val;
    [...grp.querySelectorAll('[data-val]')].forEach(b => b.classList.toggle('active', b === btn));
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

  let isAdmin = code === '0000';
  if (!isAdmin) {
    try { const u = await getUsuario(code); isAdmin = !!(u && u.admin); } catch (_) {}
  }
  if (!isAdmin) { window.location.href = 'menu.html'; return; }

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
  if (typeof getDolarSnapshot === 'function') getDolarSnapshot().then(renderDolarHoy).catch(() => {});

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
