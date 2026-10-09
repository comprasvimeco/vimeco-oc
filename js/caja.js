/* global getCajaMovimientos, saveCajaMovimiento, deleteCajaMovimiento,
          patchCajaMovimiento, getCategoriasCaja, saveCategoriasCaja,
          getAllUsuarios, getUsuario, getObrasActivas, uploadToCajaDrive,
          getTodasLasCajas, extractFromTicket */

document.addEventListener('DOMContentLoaded', async () => {

  const $ = id => document.getElementById(id);
  const esc = s => escHtml(s == null ? '' : String(s));

  // ─── Auth ────────────────────────────────────────────
  const session = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch(_) { return null; } })();
  if (!session?.codigo) { window.location.href = 'index.html'; return; }

  const userCodigo = session.codigo;
  const userNombre = session.nombre;
  let   isAdmin    = userCodigo === '0000';

  // El super-admin (0000) siempre entra. Los demás: con permiso `admin` entran
  // como admin; con permiso `caja` entran a su propia caja; sin ninguno, fuera.
  if (!isAdmin) {
    try {
      const u = await getUsuario(userCodigo);
      if (u && u.admin) isAdmin = true;
      if (!isAdmin && !(u && u.caja)) { window.location.href = 'menu.html'; return; }
    } catch (_) { window.location.href = 'menu.html'; return; }
  }

  let targetCodigo = userCodigo;
  let targetNombre = userNombre;
  let movimientos  = [];
  let categorias   = [];
  let obras        = [];   // nombres de /obras activas, para imputar cada egreso
  let personas     = [];   // administración: quienes tienen caja { codigo, nombre }
  let cajasTodas   = {};   // administración: { codigo: [movimientos] }
  let vista        = isAdmin ? 'todas' : 'caja';
  let mesSel       = '';
  let tab          = 'todos';
  let busqueda     = [];
  let empujado     = false;   // se abrió una caja desde el tablero con pushState

  // showToast: provisto globalmente por js/ui.js

  // ─── Formatos ────────────────────────────────────────
  // Fecha LOCAL en ISO: con toISOString (UTC) después de las 21 h ya era "mañana"
  // y el último día del mes a esa hora la pantalla abría en el mes siguiente.
  function isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const hoyISO = () => isoLocal(new Date());
  const mesHoy = () => hoyISO().substring(0, 7);

  const MESES_LBL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS      = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const nombreMes = mes => { const [y, m] = mes.split('-'); return `${MESES_LBL[parseInt(m, 10)]} ${y}`; };

  // Magnitud, sin signo: quien muestra +/- según el tipo de movimiento lo antepone.
  function fmtMonto(n) {
    const s = Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return '$ ' + s;
  }

  // Firmado, para los totales que sí pueden dar negativo: saldo y excedente anterior.
  // El rojo solo no alcanza —"-$ 5.000" y "$ 5.000" se ven idénticos sin el signo, y
  // el color se pierde en una captura, impreso o con daltonismo—.
  function fmtSaldo(n) {
    // El signo se decide sobre el valor YA redondeado: -0,004 no debe salir "-$ 0,00".
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return (v < 0 ? '-' : '') + fmtMonto(v);
  }

  function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function fechaLarga(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return `${DIAS[d.getDay()]} ${fmtFecha(iso)}`;
  }

  function etiquetaDia(iso) {
    if (!iso) return 'Sin fecha';
    const d = new Date(iso + 'T12:00:00');
    const base = `${DIAS[d.getDay()]} ${d.getDate()}`;
    if (iso === hoyISO()) return `Hoy · ${base}`;
    if (iso === isoLocal(new Date(Date.now() - 86400000))) return `Ayer · ${base}`;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function parseMonto(str) {
    if (!str) return 0;
    const n = parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  const montoInput = n => n ? String(n).replace('.', ',') : '';
  const sinTildes  = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const neto       = m => m.tipo === 'ingreso' ? (m.monto || 0) : -(m.monto || 0);
  const esEgreso   = m => m.tipo === 'gasto';

  // Ícono por categoría (las que no están en la lista usan la etiqueta)
  const CAT_IC = { viaticos: 'coffee', peajes: 'road', combustibles: 'fuel', repuestos: 'settings', oficina: 'briefcase',
                   herramientas: 'tool', pasajes: 'truck', inspeccion: 'eye', equipos: 'box' };
  const icCat = c => CAT_IC[sinTildes(c)] || 'tag';

  // Registra un movimiento de caja en el feed de Novedades (best-effort).
  function logCajaActivity(mov, fileId) {
    if (typeof logActivity !== 'function') return;
    const label  = mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso';
    const cuenta = targetCodigo !== userCodigo ? ` (caja de ${targetNombre})` : '';
    logActivity({
      tipo:    'caja',
      usuario: { codigo: userCodigo, nombre: userNombre },
      titulo:   `${label} de caja — ${fmtMonto(mov.monto || 0)}${cuenta}`,
      detalle:  [mov.obra, mov.categoria, mov.descripcion].filter(Boolean).join(' · ') || '—',
      driveUrl: fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''
    });
  }

  // Anima un número desde su valor actual hasta `to` (con formato de monto firmado:
  // los tableros de arriba son los únicos que muestran totales que pueden dar negativo)
  const _countTimers = new WeakMap();
  // Achica la fuente del saldo si el número (con separadores) no entra en una sola línea.
  function fitSaldoFont(el) {
    el.style.fontSize = '';
    const avail = el.clientWidth;
    if (!avail) return;
    const ratio = avail / el.scrollWidth;
    if (ratio < 1) {
      const natural = parseFloat(getComputedStyle(el).fontSize);
      const min = 22; // px, piso legible
      el.style.fontSize = Math.max(min, Math.floor(natural * ratio * 0.97)) + 'px';
    }
  }

  function countUp(el, to, fit) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = el._cuVal || 0;
    if (reduce || from === to) {
      el.textContent = fmtSaldo(to); el._cuVal = to;
      if (fit) fitSaldoFont(el);
      return;
    }
    if (_countTimers.has(el)) cancelAnimationFrame(_countTimers.get(el));
    const dur = 650, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      el.textContent = fmtSaldo(from + (to - from) * eased);
      if (p < 1) { _countTimers.set(el, requestAnimationFrame(step)); }
      else { el.textContent = fmtSaldo(to); el._cuVal = to; if (fit) fitSaldoFont(el); }
    };
    _countTimers.set(el, requestAnimationFrame(step));
  }

  // ─── Header ──────────────────────────────────────────
  $('hdr-name').textContent = userNombre;

  $('btn-menu').addEventListener('click', e => {
    e.stopPropagation();
    $('hdr-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', () => $('hdr-dropdown').classList.add('hidden'));

  if (isAdmin) {
    $('btn-categorias').classList.remove('hidden');
    $('btn-categorias').addEventListener('click', openCategoriasModal);
  }

  // Volver: desde la caja de alguien, quien administra vuelve al tablero de cajas.
  $('btn-volver').addEventListener('click', () => {
    if (isAdmin && vista === 'caja') {
      if (empujado) history.back();
      else { history.replaceState(null, '', location.pathname); mostrarTodas(); }
      return;
    }
    window.location.href = 'menu.html';
  });
  window.addEventListener('popstate', ev => {
    if (!isAdmin) return;
    const cod = ev.state?.cj;
    if (cod) abrirCaja(cod);
    else { empujado = false; mostrarTodas(); }
  });

  // ─── Load categories ─────────────────────────────────
  async function loadCategorias() {
    try {
      categorias = await getCategoriasCaja();
    } catch (_) { categorias = []; }

    if (!categorias.length) {
      categorias = ['Viaticos', 'Peajes', 'Combustibles', 'Repuestos', 'Oficina', 'Herramientas', 'Pasajes', 'Inspección', 'Equipos', 'Otras'];
      try { await saveCategoriasCaja(categorias); } catch (_) {}
    }
  }

  // ─── Load obras ──────────────────────────────────────
  // Cada egreso se imputa a una obra. La lista es la misma de /obras que usa la OC
  // (lista cerrada desde v139), y ya incluye los centros de costo que no son obra de
  // construcción —Taller, Oficina Técnica, Administración - RRHH—, así que un gasto
  // de oficina también tiene dónde ir y no hace falta una opción "General".
  async function loadObras() {
    try {
      obras = (await getObrasActivas()).map(o => o.nombre);
    } catch (_) { obras = []; }
  }

  function fillObraSelect(extra) {
    const sel = $('gasto-obra');
    const lista = extra && !obras.includes(extra) ? [...obras, extra] : obras;
    sel.innerHTML = '<option value="">Elegí la obra</option>' +
      lista.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }

  // ─── Desplegables-pastilla (mes y caja) ──────────────
  const CHEV = () => icSvg('chevron', 'act-chev');

  function cerrarMenus() {
    ['mes', 'quien'].forEach(k => {
      $(`cj-${k}-menu`).classList.add('hidden');
      $(`cj-${k}-btn`).setAttribute('aria-expanded', 'false');
    });
  }
  function bindDesplegable(k, alElegir) {
    const btn = $(`cj-${k}-btn`), menu = $(`cj-${k}-menu`);
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const abrir = menu.classList.contains('hidden');
      cerrarMenus();
      if (abrir) { menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    });
    menu.addEventListener('click', ev => {
      const opt = ev.target.closest('.act-opt');
      if (!opt) return;
      cerrarMenus();
      alElegir(opt.dataset.v);
    });
  }
  document.addEventListener('click', ev => { if (!ev.target.closest('.act-dd')) cerrarMenus(); });

  function pintarMeses(movs) {
    const meses = new Set(movs.map(m => m.fecha?.substring(0, 7)).filter(Boolean));
    meses.add(mesHoy());
    if (!mesSel) mesSel = mesHoy();
    meses.add(mesSel);
    const lista = [...meses].sort().reverse();
    $('cj-mes-btn').innerHTML = icSvg('calendar') + esc(nombreMes(mesSel)) + CHEV();
    $('cj-mes-menu').innerHTML = lista.map(m =>
      `<button type="button" class="act-opt" role="option" data-v="${m}" aria-selected="${m === mesSel}">${esc(nombreMes(m))}</button>`).join('');
  }

  function pintarQuien() {
    $('cj-quien-dd').classList.toggle('hidden', !(isAdmin && vista === 'caja'));
    if (!isAdmin) return;
    $('cj-quien-btn').innerHTML = icSvg('user') + esc(targetNombre) + CHEV();
    $('cj-quien-menu').innerHTML =
      `<button type="button" class="act-opt" role="option" data-v="" aria-selected="false"><span class="act-opt-ic act-t-all">${icSvg('users')}</span>Todas las cajas</button>` +
      personas.map(p => `<button type="button" class="act-opt" role="option" data-v="${esc(p.codigo)}" aria-selected="${p.codigo === targetCodigo}">
        <span class="act-opt-ic" style="background:#dff3e5;color:#1a7f3c">${icSvg('user')}</span>${esc(p.nombre)}</button>`).join('');
  }

  bindDesplegable('mes', v => {
    mesSel = v;
    if (vista === 'todas') renderTodas(); else renderMovimientos();
  });
  bindDesplegable('quien', v => {
    if (!v) {
      if (empujado) history.back();
      else { history.replaceState(null, '', location.pathname); mostrarTodas(); }
      return;
    }
    history.replaceState({ cj: v }, '', '?caja=' + encodeURIComponent(v));
    abrirCaja(v);
  });

  // ─── Administración: todas las cajas ─────────────────
  async function cargarPersonas() {
    let usuarios = [];
    try { usuarios = await getAllUsuarios(); } catch (_) {}
    try { cajasTodas = await getTodasLasCajas(); } catch (err) {
      cajasTodas = {};
      showToast('Error al cargar las cajas: ' + (err.message || err), 'error');
    }
    const porCod = {};
    usuarios.forEach(u => {
      const tieneMovs = (cajasTodas[u.codigo] || []).length > 0;
      if (tieneMovs || (u.caja && u.activo !== false) || u.codigo === userCodigo)
        porCod[u.codigo] = { codigo: u.codigo, nombre: u.nombre };
    });
    // Cajas con movimientos de alguien que ya no está en /usuarios
    Object.keys(cajasTodas).forEach(c => {
      if (!porCod[c] && cajasTodas[c].length) porCod[c] = { codigo: c, nombre: c };
    });
    personas = Object.values(porCod).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function mostrarVista() {
    $('cj-cargando').classList.add('hidden');
    $('cj-vista-todas').classList.toggle('hidden', vista !== 'todas');
    $('cj-vista-caja').classList.toggle('hidden', vista !== 'caja');
    $('cj-fab').classList.toggle('on', vista === 'caja');
    $('cj-titulo').textContent = vista === 'todas' ? 'Cajas chicas' : 'Caja chica';
    pintarQuien();
  }

  async function mostrarTodas() {
    vista = 'todas';
    mostrarVista();
    $('cj-grid').innerHTML = '<div class="cj-vacio"><div class="spinner" style="width:24px;height:24px;margin:0 auto .5rem;"></div>Cargando…</div>';
    await cargarPersonas();
    if (vista !== 'todas') return;
    renderTodas();
  }

  function renderTodas() {
    const todos = Object.values(cajasTodas).flat();
    pintarMeses(todos);
    const filas = personas.map(p => {
      const movs  = cajasTodas[p.codigo] || [];
      const delMes = movs.filter(m => m.fecha?.startsWith(mesSel));
      const saldo = movs.filter(m => m.fecha && m.fecha.substring(0, 7) <= mesSel).reduce((s, m) => s + neto(m), 0);
      const ing   = delMes.filter(m => !esEgreso(m)).reduce((s, m) => s + (m.monto || 0), 0);
      const egr   = delMes.filter(esEgreso).reduce((s, m) => s + (m.monto || 0), 0);
      const sin   = delMes.filter(m => esEgreso(m) && !m.driveFileId).length;
      const ult   = delMes.map(m => m.fecha).sort().pop();
      return { ...p, saldo, ing, egr, sin, n: delMes.length, ult };
    });
    const neg   = filas.filter(f => Math.round(f.saldo * 100) < 0);
    const tSal  = filas.reduce((s, f) => s + f.saldo, 0);
    const tEgr  = filas.reduce((s, f) => s + f.egr, 0);
    const tSin  = filas.reduce((s, f) => s + f.sin, 0);

    const pend = $('cj-pend');
    pend.classList.toggle('hidden', !neg.length);
    pend.textContent = neg.length === 1 ? '1 en negativo' : `${neg.length} en negativo`;
    pend.dataset.accion = 'negativo';

    $('cj-tot').innerHTML =
      `<div><span>Saldo de todas</span><b class="${tSal < 0 ? 'neg' : ''}">${fmtSaldo(tSal)}</b></div>
       <div><span>Egresos de ${esc(nombreMes(mesSel).split(' ')[0].toLowerCase())}</span><b>${fmtMonto(tEgr)}</b></div>
       <div class="cj-tot-sin"><span>Egresos sin comprobante</span><b>${tSin}</b></div>`;

    const cuando = iso => iso === hoyISO() ? 'hoy' : iso === isoLocal(new Date(Date.now() - 86400000)) ? 'ayer' : fmtFecha(iso).substring(0, 5);
    const ini = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    $('cj-grid').innerHTML = filas.length ? filas.map(f => {
      const esNeg = Math.round(f.saldo * 100) < 0;
      return `<button type="button" class="cj-box" data-cod="${esc(f.codigo)}">
        <div class="cj-box-top"><span class="cj-av${esNeg ? ' neg' : ''}">${esc(ini(f.nombre))}</span>
          <div><div class="cj-box-n">${esc(f.nombre)}</div>
          <div class="cj-box-s">${f.n ? `${f.n} ${f.n === 1 ? 'movimiento' : 'movimientos'} · último ${cuando(f.ult)}` : 'Sin movimientos en el mes'}</div></div></div>
        <div class="cj-box-sal${esNeg ? ' neg' : ''}"><small>Saldo</small>${fmtSaldo(f.saldo)}</div>
        <div class="cj-box-bot"><span class="cj-mini cj-mini--ing">+${fmtMonto(f.ing)}</span><span class="cj-mini cj-mini--egr">−${fmtMonto(f.egr)}</span>
          ${f.sin ? `<span class="cj-mini cj-mini--sin">${f.sin} sin comprobante</span>` : ''}</div>
      </button>`;
    }).join('') : '<div class="cj-vacio">' + icSvg('briefcase') + 'No hay cajas para mostrar.</div>';
  }

  $('cj-grid').addEventListener('click', e => {
    const box = e.target.closest('.cj-box');
    if (!box) return;
    history.pushState({ cj: box.dataset.cod }, '', '?caja=' + encodeURIComponent(box.dataset.cod));
    empujado = true;
    abrirCaja(box.dataset.cod);
  });

  $('cj-pend').addEventListener('click', () => {
    if (vista === 'todas') {
      const b = document.querySelector('.cj-box .cj-av.neg');
      if (b) { const box = b.closest('.cj-box'); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); box.focus({ preventScroll: true }); }
    } else {
      tab = 'sin';
      renderMovimientos();
    }
  });

  async function abrirCaja(codigo) {
    const p = personas.find(x => x.codigo === codigo);
    targetCodigo = codigo;
    targetNombre = p ? p.nombre : (codigo === userCodigo ? userNombre : codigo);
    vista = 'caja';
    tab = 'todos';
    busqueda = [];
    $('cj-search').value = '';
    mostrarVista();
    await loadMovimientos();
  }

  // ─── Load movements ──────────────────────────────────
  async function loadMovimientos() {
    $('cj-lista').innerHTML = '<div class="cj-vacio"><div class="spinner" style="width:24px;height:24px;margin:0 auto .5rem;"></div>Cargando…</div>';
    const pedido = targetCodigo;
    let movs;
    try {
      movs = await getCajaMovimientos(pedido);
    } catch (err) {
      movs = [];
      showToast('Error al cargar movimientos: ' + (err.message || err), 'error');
    }
    if (pedido !== targetCodigo) return;   // se cambió de caja mientras cargaba
    movimientos = movs;
    if (isAdmin) cajasTodas[targetCodigo] = movs;
    renderMovimientos();
  }

  function delMes() {
    return movimientos.filter(m => m.fecha?.startsWith(mesSel));
  }

  function renderMovimientos() {
    if (vista !== 'caja') return;
    pintarMeses(movimientos);
    pintarQuien();
    const filtered = delMes();

    // Balance del mes seleccionado (con arrastre acumulado)
    const totalIngresos = filtered.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const totalGastos   = filtered.filter(m => m.tipo === 'gasto').reduce((s, m)  => s + (m.monto || 0), 0);
    // Excedente anterior = neto de TODOS los movimientos de meses previos al seleccionado
    const excedente = movimientos
      .filter(m => m.fecha && m.fecha.substring(0, 7) < mesSel)
      .reduce((s, m) => s + neto(m), 0);
    const saldo = excedente + totalIngresos - totalGastos;

    $('cj-saldo-k').textContent = 'Saldo de ' + nombreMes(mesSel).split(' ')[0].toLowerCase();
    countUp($('val-excedente'), excedente);
    $('val-excedente').classList.toggle('neg', excedente < 0);
    countUp($('val-ingresos'), totalIngresos);
    countUp($('val-gastos'),   totalGastos);
    const valSaldoEl = $('val-saldo');
    countUp(valSaldoEl, saldo, true);
    valSaldoEl.classList.toggle('neg', Math.round(saldo * 100) < 0);

    // En qué se gastó (lo mismo que va al Excel)
    const barras = (agrupar) => {
      const o = {};
      filtered.filter(esEgreso).forEach(m => { const k = agrupar(m); o[k] = (o[k] || 0) + (m.monto || 0); });
      const filas = Object.entries(o).sort((a, b) => b[1] - a[1]);
      if (!filas.length) return '<div class="cj-vacio-s">Sin egresos en el mes.</div>';
      const max = filas[0][1] || 1;
      return filas.map(([k, v]) => `<div class="cj-bar"><div class="cj-bar-t"><span>${esc(k)}</span><b>${fmtMonto(v)}</b></div>
        <div class="cj-bar-b"><i style="width:${Math.max(2, v / max * 100)}%"></i></div></div>`).join('');
    };
    $('cj-por-obra').innerHTML = barras(m => m.obra || 'Sin obra');
    $('cj-por-cat').innerHTML  = barras(m => m.categoria || 'Sin categoría');

    const nEgr = filtered.filter(esEgreso).length;
    const nSin = filtered.filter(m => esEgreso(m) && !m.driveFileId).length;
    const pend = $('cj-pend');
    pend.classList.toggle('hidden', !nSin);
    pend.textContent = nSin === 1 ? '1 sin comprobante' : `${nSin} sin comprobante`;

    $('cj-tabs').innerHTML = [['todos', 'Todos', filtered.length], ['egr', 'Egresos', nEgr],
      ['ing', 'Ingresos', filtered.length - nEgr], ['sin', 'Sin comprobante', nSin, nSin ? 'red' : '']]
      .map(([v, t, n, c]) => `<button type="button" class="cj-tab ${c || ''} ${tab === v ? 'on' : ''}" data-tab="${v}" role="tab" aria-selected="${tab === v}">${t} <b>${n}</b></button>`).join('');

    renderLista(filtered);
  }

  function coincide(m) {
    if (!busqueda.length) return true;
    const txt = sinTildes([m.descripcion, m.proveedor, m.obra, m.categoria, fmtMonto(m.monto || 0)].join(' '));
    return busqueda.every(t => txt.includes(t));
  }

  function canDelete() {
    return isAdmin || targetCodigo === userCodigo;
  }

  const driveUrl = id => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;

  function renderLista(filtered) {
    const data = filtered.filter(m =>
      (tab === 'todos' || (tab === 'egr' && esEgreso(m)) || (tab === 'ing' && !esEgreso(m)) || (tab === 'sin' && esEgreso(m) && !m.driveFileId))
      && coincide(m));
    const cont = $('cj-lista');
    if (!data.length) {
      const msg = busqueda.length ? 'No hay movimientos que coincidan con la búsqueda.'
        : tab === 'sin' ? 'Todos los egresos del mes tienen comprobante.'
        : `No hay movimientos en ${nombreMes(mesSel).toLowerCase()}.`;
      cont.innerHTML = `<div class="cj-vacio">${icSvg('briefcase')}${esc(msg)}</div>`;
      return;
    }
    let html = '<div class="cj-lh"><span></span><span>Movimiento</span><span>Obra</span><span class="r">Monto</span><span></span></div>';
    let dia = null;
    data.forEach(m => {
      if (m.fecha !== dia) {
        dia = m.fecha;
        const tot = data.filter(x => x.fecha === dia && esEgreso(x)).reduce((s, x) => s + (x.monto || 0), 0);
        html += `<div class="cj-day"><span>${esc(etiquetaDia(dia))}</span>${tot ? `<b>−${fmtMonto(tot)}</b>` : ''}</div>`;
      }
      const ing = !esEgreso(m);
      const marca = ing ? '' : (m.driveFileId ? `<span title="Con comprobante">${icSvg('clip')}</span>` : '<span class="cj-nocomp">sin comprobante</span>');
      const tel  = ing ? ['Ingreso'] : [m.obra || 'Sin obra', m.proveedor].filter(Boolean);
      const desk = ing ? ['Ingreso'] : [m.categoria, m.proveedor].filter(Boolean);
      const sub  = `<span class="cj-solo-tel">${esc(tel.join(' · '))}</span><span class="cj-solo-desk">${esc(desk.join(' · '))}</span>${marca ? ' · ' + marca : ''}`;
      html += `<div class="cj-mv" role="button" tabindex="0" data-key="${esc(m.key)}">
        <span class="cj-sq ${ing ? 'cj-sq--grn' : 'cj-sq--del'}">${icSvg(ing ? 'plus' : icCat(m.categoria))}</span>
        <div style="min-width:0"><div class="cj-mv-d">${esc(m.descripcion || '—')}</div><div class="cj-mv-s">${sub}</div></div>
        <div class="cj-mv-c">${ing ? '—' : esc(m.obra || '—')}</div>
        <div class="cj-mv-m${ing ? ' ing' : ''}">${ing ? '+' : '−'}${fmtMonto(m.monto || 0)}${!ing && m.categoria ? `<small>${esc(m.categoria)}</small>` : ''}</div>
        <div class="cj-mv-x">
          ${m.driveFileId ? `<a class="foc-btn foc-btn--clear cj-ib" href="${driveUrl(m.driveFileId)}" target="_blank" rel="noopener" title="Ver comprobante" aria-label="Ver comprobante">${icSvg('eye')}</a>` : ''}
          ${canDelete() ? `<button type="button" class="foc-btn foc-btn--clear cj-ib cj-mv-edit" title="Editar" aria-label="Editar">${icSvg('edit')}</button>` : ''}
        </div>
      </div>`;
    });
    cont.innerHTML = html;
  }

  $('cj-tabs').addEventListener('click', e => {
    const b = e.target.closest('.cj-tab');
    if (!b) return;
    tab = b.dataset.tab;
    renderMovimientos();
  });
  $('cj-search').addEventListener('input', e => {
    busqueda = sinTildes(e.target.value).split(/\s+/).filter(Boolean);
    renderLista(delMes());
  });
  $('cj-lista').addEventListener('click', e => {
    const row = e.target.closest('.cj-mv');
    if (!row || e.target.closest('a')) return;
    if (e.target.closest('.cj-mv-edit')) { openEdit(row.dataset.key); return; }
    abrirFicha(row.dataset.key);
  });
  $('cj-lista').addEventListener('keydown', e => {
    const row = e.target.closest('.cj-mv');
    if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirFicha(row.dataset.key); }
  });
  window.addEventListener('resize', () => fitSaldoFont($('val-saldo')));

  // ─── Hojas: abrir / cerrar ───────────────────────────
  function abrirHoja(id) {
    $(id).classList.remove('hidden');
    $(id).querySelector('.cj-sheet').focus({ preventScroll: true });
  }
  const HOJAS = ['modal-gasto', 'modal-recarga', 'modal-ficha'];
  document.addEventListener('keydown', e => {
    // El editor de escaneo lo arma scanner.js recién al abrirlo.
    const scan = $('scan-editor');
    if (e.key !== 'Escape' || (scan && !scan.classList.contains('hidden'))) return;
    const abierta = HOJAS.find(h => !$(h).classList.contains('hidden'));
    if (abierta === 'modal-gasto') closeGastoModal();
    else if (abierta === 'modal-recarga') closeRecargaModal();
    else if (abierta === 'modal-ficha') cerrarFicha();
  });

  // "Faltan N datos" con todo junto, como en la OC: tocar uno lleva a completarlo.
  function mostrarFaltantes(faltan, irA) {
    let modal = $('modal-faltan');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-overlay hidden';
      modal.id = 'modal-faltan';
      modal.style.zIndex = '1200';
      modal.innerHTML =
        '<div class="confirm-box confirm-box--warn confirm-box--wide" role="dialog" aria-modal="true" aria-labelledby="faltan-title" tabindex="-1">' +
          `<span class="confirm-ic">${icSvg('alert')}</span>` +
          '<div class="confirm-title" id="faltan-title"></div>' +
          '<p class="confirm-msg">Tocá uno para ir a completarlo.</p>' +
          '<div class="faltan-lista"></div>' +
          '<button type="button" class="foc-btn foc-btn--clear confirm-cancel faltan-cerrar">Seguir cargando</button>' +
        '</div>';
      document.body.appendChild(modal);
    }
    const close = () => {
      modal.classList.add('hidden');
      modal.onclick = null;
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    modal.querySelector('#faltan-title').textContent = faltan.length === 1 ? 'Falta un dato' : `Faltan ${faltan.length} datos`;
    modal.querySelector('.faltan-lista').innerHTML = faltan.map((f, i) => `
      <button type="button" class="faltan-item" data-i="${i}">
        <span class="faltan-dot"></span>
        <span class="faltan-t"><b>${esc(f.txt)}</b><small>${esc(f.sub)}</small></span>
        ${icSvg('chevR')}
      </button>`).join('');
    modal.onclick = e => {
      const it = e.target.closest('.faltan-item');
      if (it) { close(); irA(faltan[+it.dataset.i].id); }
      else if (e.target === modal || e.target.closest('.faltan-cerrar')) close();
    };
    document.addEventListener('keydown', onKey, true);
    modal.classList.remove('hidden');
    modal.querySelector('.confirm-box').focus();
  }

  const unirFaltan = partes => partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes.at(-1) : partes[0];

  // ─── Ficha del movimiento ────────────────────────────
  let fichaKey = null;

  function abrirFicha(key) {
    const m = movimientos.find(x => x.key === key);
    if (!m) return;
    fichaKey = key;
    const ing = !esEgreso(m);
    $('ficha-ic').className = 'cj-sq ' + (ing ? 'cj-sq--grn' : 'cj-sq--del');
    $('ficha-ic').innerHTML = icSvg(ing ? 'plus' : icCat(m.categoria));
    $('ficha-title').textContent = ing ? 'Ingreso' : 'Egreso';
    let html = `<section class="cj-sec"><div class="cj-fi-d">${esc(m.descripcion || '—')}</div>
      <div class="cj-fi-s">${esc(fechaLarga(m.fecha))} · caja de ${esc(targetNombre)}</div>
      <div class="cj-fi-m${ing ? ' ing' : ''}">${ing ? '+' : '−'}${fmtMonto(m.monto || 0)}</div></section>`;
    if (!ing) {
      html += `<section class="cj-sec"><dl class="cj-fi-dl">
        <dt>Obra</dt><dd>${esc(m.obra || 'Sin obra')}</dd>
        <dt>Categoría</dt><dd>${esc(m.categoria || '—')}</dd>
        ${m.proveedor ? `<dt>Proveedor</dt><dd>${esc(m.proveedor)}</dd>` : ''}</dl></section>`;
      html += m.driveFileId
        ? `<section class="cj-sec cj-fi-comp"><span class="cj-sq cj-sq--grn">${icSvg('clip')}</span>
            <div><b>Comprobante</b><small>Guardado en Drive</small></div>
            <a class="foc-btn foc-btn--edit" href="${driveUrl(m.driveFileId)}" target="_blank" rel="noopener">${icSvg('eye')}Ver</a></section>`
        : `<section class="cj-sec cj-fi-comp"><span class="cj-sq cj-sq--del">${icSvg('clip')}</span>
            <div><b>Sin comprobante</b><small>${canDelete() ? 'Se puede agregar con Editar.' : 'No se cargó la foto del ticket.'}</small></div></section>`;
    }
    $('ficha-body').innerHTML = html;
    $('ficha-ft').classList.toggle('hidden', !canDelete());
    abrirHoja('modal-ficha');
  }
  function cerrarFicha() { $('modal-ficha').classList.add('hidden'); fichaKey = null; }
  $('ficha-close').addEventListener('click', cerrarFicha);
  $('modal-ficha').addEventListener('click', e => { if (e.target === e.currentTarget) cerrarFicha(); });
  $('ficha-edit').addEventListener('click', () => { const k = fichaKey; cerrarFicha(); openEdit(k); });
  $('ficha-del').addEventListener('click', async () => {
    const k = fichaKey;
    cerrarFicha();
    await confirmDelete(k);
  });

  function openEdit(key) {
    const m = movimientos.find(x => x.key === key);
    if (!m) return;
    if (m.tipo === 'ingreso') openRecargaModal(m);
    else openGastoModal(m);
  }

  async function confirmDelete(key) {
    if (!await showConfirm('Eliminar movimiento', '¿Eliminar este movimiento? También se borra su comprobante en Drive.',
      { boton: 'Eliminar', tono: 'del', icono: 'trash' })) return;
    const mov    = movimientos.find(m => m.key === key);
    const mesMov = mov?.fecha?.substring(0, 7);
    try {
      await deleteCajaMovimiento(targetCodigo, key);
      // Borrar también el comprobante en Drive (best-effort, no frena el flujo)
      if (mov?.driveFileId && typeof deleteDriveFile === 'function') {
        deleteDriveFile(mov.driveFileId).catch(() => {});
      }
      showToast('Movimiento eliminado', 'success');
      await loadMovimientos();
      sincronizarExcel(mesMov);
    } catch (_) {
      showToast('Error al eliminar', 'error');
    }
  }

  // ─── Egreso ──────────────────────────────────────────
  let gastoFile       = null;
  let editGasto       = null;   // movimiento en edición (o null al crear)
  let rawImage        = null;   // imagen original (para volver a escanear)
  let gastoPreviewUrl = null;   // objectURL del preview actual
  let catSel          = '';
  let fechaTocada     = false;
  const esMovil = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  function renderCats(extra) {
    const lista = extra && !categorias.includes(extra) ? [...categorias, extra] : categorias;
    $('gasto-cats').innerHTML = lista.map(c =>
      `<button type="button" class="cj-chip" data-v="${esc(c)}" aria-pressed="${c === catSel}">${esc(c)}</button>`).join('');
  }

  // Las últimas obras a las que se imputó en esta caja, como atajo.
  function renderObrasRecientes() {
    const rec = [];
    movimientos.filter(esEgreso).forEach(m => {
      if (m.obra && obras.includes(m.obra) && !rec.includes(m.obra) && rec.length < 3) rec.push(m.obra);
    });
    const cont = $('gasto-obras-rec');
    cont.classList.toggle('hidden', !rec.length);
    const sel = $('gasto-obra').value;
    cont.innerHTML = '<span class="cj-chips-hint">Últimas:</span>' + rec.map(o =>
      `<button type="button" class="cj-chip" data-v="${esc(o)}" aria-pressed="${o === sel}">${esc(o)}</button>`).join('');
  }

  function openGastoModal(mov) {
    editGasto = mov || null;
    clearGastoFile();
    catSel = mov?.categoria || '';
    renderCats(catSel);
    // Un egreso viejo puede apuntar a una obra que después se desactivó: se la agrega
    // a la lista para no perder el dato al editar por otra razón.
    fillObraSelect(mov?.obra);
    $('gasto-obra').value        = mov?.obra        || '';
    $('gasto-fecha').value       = mov?.fecha       || hoyISO();
    $('gasto-proveedor').value   = mov?.proveedor   || '';
    $('gasto-descripcion').value = mov?.descripcion || '';
    $('gasto-monto').value       = mov ? montoInput(mov.monto) : '';
    fechaTocada = !!mov;
    renderObrasRecientes();
    $('gasto-error').classList.add('hidden');
    $('gasto-ia-st').classList.add('hidden');
    document.querySelectorAll('#modal-gasto .cj-sec').forEach(s => s.classList.remove('is-falta'));
    $('gasto-ya').classList.toggle('hidden', !mov?.driveFileId);
    if (mov?.driveFileId) $('gasto-ya-link').href = driveUrl(mov.driveFileId);
    $('modal-gasto-title').textContent = mov ? 'Editar egreso' : 'Registrar egreso';
    $('btn-gasto-guardar').querySelector('span').textContent = mov ? 'Guardar cambios' : 'Guardar egreso';
    $('btn-gasto-camera').classList.toggle('hidden', !esMovil);
    $('gasto-body').scrollTop = 0;
    refrescarGasto();
    abrirHoja('modal-gasto');
  }

  function closeGastoModal() {
    $('modal-gasto').classList.add('hidden');
    clearGastoFile();
    editGasto = null;
  }

  const FALTA_SEC = { monto: 'cj-sec-monto', fecha: 'cj-sec-monto', obra: 'cj-sec-obra', cat: 'cj-sec-cat', desc: 'cj-sec-det' };

  function faltantesGasto() {
    const f = [];
    if (!(parseMonto($('gasto-monto').value) > 0)) f.push({ id: 'monto', txt: 'El monto', sub: 'Paso 2 · monto y fecha', corto: 'monto' });
    if (!$('gasto-fecha').value)            f.push({ id: 'fecha', txt: 'La fecha',     sub: 'Paso 2 · monto y fecha', corto: 'fecha' });
    if (!$('gasto-obra').value)             f.push({ id: 'obra',  txt: 'La obra',      sub: 'Paso 3 · a qué obra va', corto: 'obra' });
    if (!catSel)                            f.push({ id: 'cat',   txt: 'La categoría', sub: 'Paso 4 · categoría', corto: 'categoría' });
    if (!$('gasto-descripcion').value.trim()) f.push({ id: 'desc', txt: 'La descripción', sub: 'Paso 5 · qué se compró o pagó', corto: 'descripción' });
    return f;
  }

  function refrescarGasto() {
    const faltan = faltantesGasto();
    const tiene  = id => !faltan.some(f => f.id === id);
    const tilde  = (id, ok, n) => { const el = $(id); el.classList.toggle('ok', ok); el.innerHTML = ok ? icSvg('checkSm') : n; };
    const conComp = !!gastoFile || !!editGasto?.driveFileId;
    tilde('cj-n-comp',  conComp, '1');
    tilde('cj-n-monto', tiene('monto') && tiene('fecha'), '2');
    tilde('cj-n-obra',  tiene('obra'), '3');
    tilde('cj-n-cat',   tiene('cat'), '4');
    tilde('cj-n-det',   tiene('desc'), '5');
    $('cj-opt-comp').classList.toggle('hidden', conComp);
    Object.values(FALTA_SEC).forEach(sec => {
      if (!faltan.some(f => FALTA_SEC[f.id] === sec)) $(sec).classList.remove('is-falta');
    });
    $('gasto-obras-rec').querySelectorAll('.cj-chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.v === $('gasto-obra').value));
    const st = $('gasto-estado');
    if (faltan.length) {
      st.className = 'cj-st cj-st--falta';
      st.textContent = (faltan.length > 1 ? 'Faltan ' : 'Falta ') + unirFaltan(faltan.map(f => f.corto));
    } else {
      st.className = 'cj-st cj-st--ok';
      st.textContent = 'Listo para guardar';
    }
    $('btn-gasto-guardar').classList.toggle('is-incompleto', faltan.length > 0);
  }

  function irAFaltanteGasto(id) {
    const sec = $(FALTA_SEC[id]);
    sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const foco = { monto: 'gasto-monto', fecha: 'gasto-fecha', obra: 'gasto-obra', desc: 'gasto-descripcion' }[id];
    const el = foco ? $(foco) : sec.querySelector('.cj-chip');
    if (el) setTimeout(() => el.focus({ preventScroll: true }), 350);
  }

  $('gasto-estado').addEventListener('click', () => {
    const f = faltantesGasto();
    if (f.length) mostrarFaltantes(f, irAFaltanteGasto);
  });

  ['gasto-monto', 'gasto-descripcion', 'gasto-proveedor'].forEach(id => $(id).addEventListener('input', refrescarGasto));
  $('gasto-fecha').addEventListener('input', () => { fechaTocada = true; refrescarGasto(); });
  $('gasto-obra').addEventListener('change', refrescarGasto);
  $('gasto-cats').addEventListener('click', e => {
    const c = e.target.closest('.cj-chip');
    if (!c) return;
    catSel = c.dataset.v;
    $('gasto-cats').querySelectorAll('.cj-chip').forEach(x => x.setAttribute('aria-pressed', x === c));
    refrescarGasto();
  });
  $('gasto-obras-rec').addEventListener('click', e => {
    const c = e.target.closest('.cj-chip');
    if (!c) return;
    $('gasto-obra').value = c.dataset.v;
    refrescarGasto();
  });

  $('btn-nuevo-gasto').addEventListener('click', () => openGastoModal());
  $('btn-fab-gasto').addEventListener('click', () => openGastoModal());
  $('modal-gasto-close').addEventListener('click', closeGastoModal);
  $('btn-gasto-cancelar').addEventListener('click', closeGastoModal);
  $('modal-gasto').addEventListener('click', e => { if (e.target === e.currentTarget) closeGastoModal(); });

  $('btn-gasto-archivo').addEventListener('click', () => $('gasto-file').click());
  $('btn-gasto-camera').addEventListener('click', () => $('gasto-camera').click());

  function setGastoFile(file) {
    gastoFile = file;
    if (gastoPreviewUrl) { URL.revokeObjectURL(gastoPreviewUrl); gastoPreviewUrl = null; }
    const img = $('gasto-preview-img');
    const thumb = $('gasto-thumb');
    thumb.querySelector('.cj-pdf')?.remove();
    if (file.type.startsWith('image/')) {
      gastoPreviewUrl = URL.createObjectURL(file);
      img.src = gastoPreviewUrl;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
      thumb.insertAdjacentHTML('beforeend', `<span class="cj-pdf">${icSvg('file')}</span>`);
    }
    $('gasto-file-name').textContent = file.name;
    $('gasto-file-size').textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
    $('gasto-drop').classList.add('hidden');
    $('gasto-foto').classList.remove('hidden');
    $('btn-gasto-rescan').classList.toggle('hidden', !(rawImage && typeof openScanner === 'function'));
    $('btn-gasto-ia').classList.toggle('hidden', typeof extractFromTicket !== 'function');
    $('btn-gasto-ia-t').textContent = 'Leer con IA';
    $('gasto-ia-st').classList.add('hidden');
    refrescarGasto();
  }

  function clearGastoFile() {
    gastoFile = null;
    rawImage  = null;
    if (gastoPreviewUrl) { URL.revokeObjectURL(gastoPreviewUrl); gastoPreviewUrl = null; }
    $('gasto-file').value   = '';
    $('gasto-camera').value = '';
    $('gasto-drop').classList.remove('hidden');
    $('gasto-foto').classList.add('hidden');
    $('btn-gasto-ia').classList.add('hidden');
    $('gasto-ia-st').classList.add('hidden');
    if (!$('modal-gasto').classList.contains('hidden')) refrescarGasto();
  }

  // Archivo elegido (galería/PDF) o arrastrado: se usa tal cual, sin escáner.
  function handleFileSelected(file) {
    if (!file) return;
    rawImage = file.type.startsWith('image/') ? file : null;
    setGastoFile(file);
  }

  // Foto de cámara: pasa por el escáner antes de adjuntar.
  async function handleCameraSelected(file) {
    if (!file) return;
    $('gasto-camera').value = '';
    if (file.type.startsWith('image/') && typeof openScanner === 'function') {
      try {
        const scanned = await openScanner(file);
        if (scanned) { rawImage = file; setGastoFile(scanned); }   // null = cancelado: no cambia nada
      } catch (_) {
        // Escáner no disponible (p. ej. sin conexión la 1ª vez): adjuntar foto original.
        rawImage = null;
        setGastoFile(file);
        showToast('Escáner no disponible; se adjuntó la foto original', 'warning');
      }
    } else {
      handleFileSelected(file);
    }
  }

  $('gasto-file').addEventListener('change',   e => handleFileSelected(e.target.files[0]));
  $('gasto-camera').addEventListener('change', e => handleCameraSelected(e.target.files[0]));

  // Arrastrar el ticket a la bandeja (escritorio)
  const drop = $('gasto-drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('drag-over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f && /^(image\/|application\/pdf)/.test(f.type)) handleFileSelected(f);
    else if (f) showToast('Tiene que ser una foto o un PDF', 'warning');
  });

  $('btn-gasto-rescan').addEventListener('click', async () => {
    if (!rawImage || typeof openScanner !== 'function') return;
    const raw = rawImage;
    try {
      const scanned = await openScanner(raw);
      if (scanned) { setGastoFile(scanned); rawImage = raw; $('btn-gasto-rescan').classList.remove('hidden'); }
    } catch (_) {
      showToast('Escáner no disponible', 'warning');
    }
  });
  $('btn-gasto-quitar').addEventListener('click', clearGastoFile);

  // Leer el ticket con IA: completa lo que esté vacío; lo ya cargado no se pisa.
  $('btn-gasto-ia').addEventListener('click', async () => {
    if (!gastoFile || typeof extractFromTicket !== 'function') return;
    const st = $('gasto-ia-st');
    const btn = $('btn-gasto-ia');
    btn.disabled = true;
    st.className = 'cj-ia-st cj-ia-st--loading';
    st.innerHTML = '<div class="spinner"></div><span>Leyendo el ticket…</span>';
    try {
      const r = await extractFromTicket(gastoFile);
      const leido = [];
      if (r.monto_total > 0 && !(parseMonto($('gasto-monto').value) > 0)) {
        $('gasto-monto').value = montoInput(Math.round(r.monto_total * 100) / 100);
        leido.push(fmtMonto(r.monto_total));
      }
      if (r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) && !fechaTocada) {
        $('gasto-fecha').value = r.fecha;
        leido.push(fmtFecha(r.fecha).substring(0, 5));
      }
      if (r.proveedor && !$('gasto-proveedor').value.trim()) { $('gasto-proveedor').value = r.proveedor; leido.push(r.proveedor); }
      if (r.descripcion && !$('gasto-descripcion').value.trim()) $('gasto-descripcion').value = r.descripcion;
      if (r.categoria_sugerida && !catSel) {
        const c = categorias.find(x => sinTildes(x) === sinTildes(r.categoria_sugerida));
        if (c) { catSel = c; renderCats(catSel); }
      }
      refrescarGasto();
      st.className = 'cj-ia-st cj-ia-st--success';
      st.innerHTML = icSvg('sparkles') + `<span>${leido.length ? 'Leído con IA: ' + esc(unirFaltan(leido)) + '.' : 'Leído con IA.'} Revisalo antes de guardar.</span>`;
      $('btn-gasto-ia-t').textContent = 'Leer de nuevo';
    } catch (err) {
      st.className = 'cj-ia-st cj-ia-st--error';
      st.innerHTML = icSvg('alert') + `<span>No se pudo leer: ${esc(err.message || err)}</span>`;
    }
    btn.disabled = false;
  });

  // Tocar la foto la abre en grande (verImagen, ui.js)
  $('gasto-thumb').addEventListener('click', () => { if (gastoPreviewUrl) verImagen(gastoPreviewUrl); });

  $('btn-gasto-guardar').addEventListener('click', async () => {
    const errorEl = $('gasto-error');
    errorEl.classList.add('hidden');

    const faltan = faltantesGasto();
    if (faltan.length) {
      faltan.forEach(f => $(FALTA_SEC[f.id]).classList.add('is-falta'));
      mostrarFaltantes(faltan, irAFaltanteGasto);
      return;
    }

    const categoria   = catSel;
    const obra        = $('gasto-obra').value;
    const fecha       = $('gasto-fecha').value;
    const proveedor   = $('gasto-proveedor').value.trim();
    const descripcion = $('gasto-descripcion').value.trim();
    const monto       = parseMonto($('gasto-monto').value);

    const btn = $('btn-gasto-guardar');
    const btnTxt = btn.querySelector('span');
    const txtAntes = btnTxt.textContent;
    btn.disabled = true;
    btnTxt.textContent = 'Guardando…';

    const mov = { tipo: 'gasto', categoria, obra, proveedor: proveedor || null, descripcion, fecha, monto };

    if (gastoFile && typeof uploadToCajaDrive === 'function') {
      try {
        const ext      = gastoFile.name.includes('.') ? gastoFile.name.split('.').pop().toLowerCase() : 'jpg';
        const safeCat  = (categoria || 'sin-categoria').replace(/[^\wáéíóúÁÉÍÓÚüÜñÑ]/g, '-').replace(/-+/g, '-');
        const safeDesc = (descripcion || '').replace(/[^\wáéíóúÁÉÍÓÚüÜñÑ\s]/g, '').trim().replace(/\s+/g, '-').substring(0, 50);
        const montoStr = monto.toFixed(2).replace('.', ',');
        const photoName = [fecha, safeCat, montoStr, safeDesc].filter(Boolean).join('_') + '.' + ext;
        const uploadFile = new File([gastoFile], photoName, { type: gastoFile.type });
        const res = await uploadToCajaDrive(uploadFile, {
          userId:   targetCodigo,
          userName: targetNombre,
          fecha,
          tipo:     gastoFile.type.startsWith('image/') ? 'foto' : 'archivo'
        });
        if (res?.fileId) mov.driveFileId = res.fileId;
      } catch (_) {
        showToast('El comprobante no se pudo subir a Drive: el egreso queda "sin comprobante"', 'warning');
      }
    }

    try {
      if (editGasto) {
        const prevMes = editGasto.fecha?.substring(0, 7);
        // Si no se cargó comprobante nuevo, conservar el anterior
        if (!mov.driveFileId && editGasto.driveFileId) mov.driveFileId = editGasto.driveFileId;
        await patchCajaMovimiento(targetCodigo, editGasto.key, mov);
        closeGastoModal();
        showToast('Egreso actualizado', 'success');
        await loadMovimientos();
        sincronizarExcel(fecha.substring(0, 7));
        if (prevMes && prevMes !== fecha.substring(0, 7)) sincronizarExcel(prevMes);
      } else {
        await saveCajaMovimiento(targetCodigo, mov);
        logCajaActivity(mov, mov.driveFileId);
        closeGastoModal();
        showToast('Egreso registrado', 'success');
        await loadMovimientos();
        sincronizarExcel(fecha.substring(0, 7));
      }
    } catch (err) {
      errorEl.textContent = 'Error al guardar: ' + (err.message || err);
      errorEl.classList.remove('hidden');
    }

    btn.disabled = false;
    btnTxt.textContent = txtAntes;
  });

  // ─── Ingreso (recarga): disponible para admin y usuarios habilitados ─
  let editIngreso = null;   // movimiento en edición (o null al crear)

  function openRecargaModal(mov) {
    editIngreso = mov || null;
    // Fecha puntual del ingreso. Antes se elegía el mes y se guardaba el día 1; los
    // ingresos anteriores a este cambio tienen todos fecha `-01` y se editan como tales.
    $('recarga-fecha').value = mov?.fecha || hoyISO();
    // Comentario: lo que sigue al "Recarga {Mes} {Año} — " si existe
    let comentario = '';
    if (mov?.descripcion) {
      const parts = mov.descripcion.split(' — ');
      if (parts.length > 1) comentario = parts.slice(1).join(' — ');
    }
    $('recarga-monto').value      = mov ? montoInput(mov.monto) : '';
    $('recarga-comentario').value = comentario;
    $('recarga-error').classList.add('hidden');
    $('modal-recarga-title').textContent = mov ? 'Editar ingreso' : 'Registrar ingreso';
    $('btn-recarga-guardar').querySelector('span').textContent = mov ? 'Guardar cambios' : 'Guardar ingreso';
    refrescarRecarga();
    abrirHoja('modal-recarga');
    if (!mov) setTimeout(() => $('recarga-monto').focus(), 50);
  }

  function closeRecargaModal() {
    $('modal-recarga').classList.add('hidden');
    editIngreso = null;
  }

  function faltantesRecarga() {
    const f = [];
    if (!(parseMonto($('recarga-monto').value) > 0)) f.push({ id: 'monto', txt: 'El monto', sub: 'Cuánto entra a la caja', corto: 'el monto' });
    if (!$('recarga-fecha').value) f.push({ id: 'fecha', txt: 'La fecha', sub: 'El día que entró la plata', corto: 'la fecha' });
    return f;
  }

  // Dice en qué caja cae y cómo queda, para no cargarle a otro por error.
  function refrescarRecarga() {
    const monto  = parseMonto($('recarga-monto').value);
    const actual = movimientos.reduce((s, m) => s + neto(m), 0) - (editIngreso ? (editIngreso.monto || 0) : 0);
    const despues = actual + monto;
    $('recarga-dest').innerHTML = `Va a la caja de <b>${esc(targetNombre)}</b>.` +
      (monto > 0 ? ` Saldo después: <b class="${despues < 0 ? 'neg' : 'ok'}">${fmtSaldo(despues)}</b>` : '');
    const faltan = faltantesRecarga();
    const st = $('recarga-estado');
    if (faltan.length) {
      st.className = 'cj-st cj-st--falta';
      st.textContent = 'Falta ' + unirFaltan(faltan.map(f => f.corto));
    } else {
      st.className = 'cj-st cj-st--ok';
      st.textContent = 'Listo para guardar';
    }
    $('btn-recarga-guardar').classList.toggle('is-incompleto', faltan.length > 0);
  }
  ['recarga-monto', 'recarga-fecha'].forEach(id => $(id).addEventListener('input', refrescarRecarga));
  $('recarga-estado').addEventListener('click', () => {
    const f = faltantesRecarga();
    if (f.length) mostrarFaltantes(f, id => $(id === 'monto' ? 'recarga-monto' : 'recarga-fecha').focus());
  });

  $('btn-nuevo-ingreso').addEventListener('click', () => openRecargaModal());
  $('btn-fab-ingreso').addEventListener('click', () => openRecargaModal());
  $('modal-recarga-close').addEventListener('click', closeRecargaModal);
  $('btn-recarga-cancelar').addEventListener('click', closeRecargaModal);
  $('modal-recarga').addEventListener('click', e => { if (e.target === e.currentTarget) closeRecargaModal(); });

  $('btn-recarga-guardar').addEventListener('click', async () => {
    const errorEl     = $('recarga-error');
    const fechaRec    = $('recarga-fecha').value;
    const comentario  = $('recarga-comentario').value.trim();
    const monto       = parseMonto($('recarga-monto').value);
    errorEl.classList.add('hidden');

    const faltan = faltantesRecarga();
    if (faltan.length) {
      mostrarFaltantes(faltan, id => $(id === 'monto' ? 'recarga-monto' : 'recarga-fecha').focus());
      return;
    }

    // El mes sale de la fecha elegida: es el que manda para el arrastre del saldo
    // y para saber qué planilla resincronizar.
    const mesRecarga  = fechaRec.substring(0, 7);
    const labelMes    = `Recarga ${nombreMes(mesRecarga)}`;
    const descripcion = comentario ? `${labelMes} — ${comentario}` : labelMes;

    const btn = $('btn-recarga-guardar');
    btn.disabled = true;
    const mov = { tipo: 'ingreso', descripcion, fecha: fechaRec, monto };
    try {
      if (editIngreso) {
        const prevMes = editIngreso.fecha?.substring(0, 7);
        await patchCajaMovimiento(targetCodigo, editIngreso.key, mov);
        closeRecargaModal();
        showToast('Ingreso actualizado', 'success');
        await loadMovimientos();
        sincronizarExcel(mesRecarga);
        if (prevMes && prevMes !== mesRecarga) sincronizarExcel(prevMes);
      } else {
        await saveCajaMovimiento(targetCodigo, mov);
        logCajaActivity(mov);
        closeRecargaModal();
        showToast('Ingreso registrado', 'success');
        await loadMovimientos();
        sincronizarExcel(mesRecarga);
      }
    } catch (err) {
      errorEl.textContent = 'Error al guardar: ' + (err.message || err);
      errorEl.classList.remove('hidden');
    }
    btn.disabled = false;
  });

  // ─── Categorías modal (admin) ─────────────────────────
  let categoriasEdit = [];

  function openCategoriasModal() {
    categoriasEdit = [...categorias];
    renderCategoriasEdit();
    $('nueva-categoria').value = '';
    $('modal-categorias').classList.remove('hidden');
  }

  function closeCategoriasModal() {
    $('modal-categorias').classList.add('hidden');
  }

  function renderCategoriasEdit() {
    const list = $('categorias-list');
    list.innerHTML = '';
    categoriasEdit.forEach((c, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:.5rem;';
      row.innerHTML = `
        <span style="flex:1;padding:.4rem .65rem;background:var(--gray-100);border-radius:var(--radius);font-size:.9rem;">${esc(c)}</span>
        <button class="btn btn-xs btn-secondary btn-del-cat" data-idx="${i}" title="Eliminar">
          <svg class="icon" style="width:13px;height:13px;" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      `;
      list.appendChild(row);
    });
    list.querySelectorAll('.btn-del-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        categoriasEdit.splice(parseInt(btn.dataset.idx), 1);
        renderCategoriasEdit();
      });
    });
  }

  if (isAdmin) {
    $('btn-agregar-categoria').addEventListener('click', () => {
      const input = $('nueva-categoria');
      const val   = input.value.trim();
      if (val && !categoriasEdit.includes(val)) {
        categoriasEdit.push(val);
        renderCategoriasEdit();
      }
      input.value = '';
    });
    $('nueva-categoria').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('btn-agregar-categoria').click();
    });

    $('modal-categorias-close').addEventListener('click', closeCategoriasModal);
    $('btn-categorias-cancelar').addEventListener('click', closeCategoriasModal);
    $('modal-categorias').addEventListener('click', e => { if (e.target === e.currentTarget) closeCategoriasModal(); });

    $('btn-categorias-guardar').addEventListener('click', async () => {
      const btn = $('btn-categorias-guardar');
      btn.disabled = true;
      try {
        await saveCategoriasCaja(categoriasEdit);
        categorias = [...categoriasEdit];
        closeCategoriasModal();
        showToast('Categorías guardadas', 'success');
      } catch (_) {
        showToast('Error al guardar categorías', 'error');
      }
      btn.disabled = false;
    });
  }

  // ─── Sincronizar Excel con Drive (se llama automáticamente tras cada movimiento) ──
  async function sincronizarExcel(mes) {
    if (typeof uploadToCajaDrive !== 'function') return;

    if (!window.XLSX) {
      try {
        await new Promise((resolve, reject) => {
          const s   = document.createElement('script');
          // xlsx-js-style: fork de SheetJS Community Edition que sí escribe estilos
          // (fills/fonts/borders) al generar el .xlsx — la edición community pura
          // ignora la propiedad `s` de cada celda al exportar.
          s.src     = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
          s.onload  = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (_) { return; }
    }

    const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const hoy       = new Date();
    const mesActual = mes || mesHoy();
    const [yr, mo]  = mesActual.split('-');
    const periodo   = `${MESES[parseInt(mo, 10)]} ${yr}`;

    const filtered       = movimientos.filter(mv => mv.fecha?.startsWith(mesActual));
    const gastosFilt     = filtered.filter(mv => mv.tipo === 'gasto');
    const porCategoria   = {};
    gastosFilt.forEach(mv => {
      const c = mv.categoria || 'Sin categoría';
      porCategoria[c] = (porCategoria[c] || 0) + (mv.monto || 0);
    });
    const cats    = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    const numCats = cats.length;

    // Gastos por obra. Los egresos anteriores a la obra obligatoria no la tienen:
    // caen en "Sin obra" en vez de desaparecer del corte.
    const porObra = {};
    gastosFilt.forEach(mv => {
      const o = mv.obra || 'Sin obra';
      porObra[o] = (porObra[o] || 0) + (mv.monto || 0);
    });
    const obrasRows = Object.entries(porObra).sort((a, b) => b[1] - a[1]);
    const numObras  = obrasRows.length;

    // ─── Índices de filas (0-based) ─────────────────────
    const R_TITLE    = 0;
    const R_USER     = 1;
    const R_PERIODO  = 2;
    const R_GEN      = 3;
    const R_RESUMEN  = 5;
    const R_EXC      = 6;
    const R_INGR     = 7;
    const R_GAST     = 8;
    const R_SALDO    = 9;
    const R_CAT_TTL  = 11;
    const R_CAT_HDR  = 12;
    const R_CAT_D0   = 13;
    const R_CAT_TOT  = 13 + numCats;
    const R_OBR_TTL  = 15 + numCats;
    const R_OBR_HDR  = 16 + numCats;
    const R_OBR_D0   = 17 + numCats;
    const R_OBR_TOT  = 17 + numCats + numObras;
    const R_DET_TTL  = 19 + numCats + numObras;
    const R_DET_HDR  = 20 + numCats + numObras;
    const R_DET_D0   = 21 + numCats + numObras;

    // Filas Excel 1-based para fórmulas
    const XF = (r) => r + 1;
    const detFirst = XF(R_DET_D0);
    const detLast  = XF(R_DET_D0 + filtered.length - 1);
    const hasData  = filtered.length > 0;

    // Columnas del detalle: A Fecha · B Tipo · C Categoría · D Obra · E Proveedor ·
    // F Descripción · G Monto. Las fórmulas de arriba apuntan acá, así que mover una
    // columna del detalle obliga a mover su letra en los SUMIF.
    const dr = (col) => hasData ? `${col}${detFirst}:${col}${detLast}` : `${col}${detFirst}:${col}${detFirst}`;
    const sumif = (typeVal, col) => hasData
      ? `SUMIF(${dr('B')},"${typeVal}",${dr(col)})`
      : '0';

    const valIngr  = filtered.filter(mv => mv.tipo === 'ingreso').reduce((s, mv) => s + (mv.monto || 0), 0);
    const valGast  = gastosFilt.reduce((s, mv) => s + (mv.monto || 0), 0);
    // Excedente anterior = neto de meses previos al período exportado
    const valExc   = movimientos
      .filter(mv => mv.fecha && mv.fecha.substring(0, 7) < mesActual)
      .reduce((s, mv) => s + (mv.tipo === 'ingreso' ? (mv.monto || 0) : -(mv.monto || 0)), 0);
    const f = (v, formula) => ({ t: 'n', v, f: formula });

    // ─── Filas ──────────────────────────────────────────
    const E = ['', '', '', '', '', '', ''];
    const kv = (label, val) => [label, val, '', '', '', '', ''];
    const rows = [];
    rows[R_TITLE]   = [`VIMECO S.A. — Caja Chica`, ...E.slice(1)];
    rows[R_USER]    = [`Usuario: ${targetNombre}`,  ...E.slice(1)];
    rows[R_PERIODO] = [`Período: ${periodo}`,        ...E.slice(1)];
    rows[R_GEN]     = [`Generado: ${hoy.toLocaleDateString('es-AR')}`, ...E.slice(1)];
    rows[4]         = [...E];
    rows[R_RESUMEN] = [`RESUMEN — ${periodo}`, ...E.slice(1)];
    rows[R_EXC]     = kv('Excedente anterior', valExc);
    rows[R_INGR]    = kv('Ingresos', f(valIngr, sumif('Ingreso', 'G')));
    rows[R_GAST]    = kv('Gastos',   f(valGast,  hasData ? `ABS(${sumif('Gasto','G')})` : '0'));
    rows[R_SALDO]   = kv('Saldo',    f(valExc+valIngr-valGast, `B${XF(R_EXC)}+B${XF(R_INGR)}-B${XF(R_GAST)}`));
    rows[10]        = [...E];
    rows[R_CAT_TTL] = [`GASTOS POR CATEGORÍA`, ...E.slice(1)];
    rows[R_CAT_HDR] = kv('Categoría', 'Monto ($)');
    cats.forEach(([cat, val], i) => {
      const fCat = hasData ? `ABS(SUMIF(${dr('C')},"${cat.replace(/"/g,'""')}",${dr('G')}))` : '0';
      rows[R_CAT_D0 + i] = kv(cat, f(val, fCat));
    });
    const catSumFormula = numCats > 0 ? `SUM(B${XF(R_CAT_D0)}:B${XF(R_CAT_D0 + numCats - 1)})` : '0';
    rows[R_CAT_TOT] = kv('TOTAL GASTOS', f(valGast, catSumFormula));
    rows[14 + numCats] = [...E];
    rows[R_OBR_TTL] = [`GASTOS POR OBRA`, ...E.slice(1)];
    rows[R_OBR_HDR] = kv('Obra', 'Monto ($)');
    obrasRows.forEach(([obr, val], i) => {
      // "Sin obra" no es un valor guardado: es el bucket de los egresos previos a la
      // obra obligatoria. Su celda va sin fórmula (SUMIF por "" no los junta).
      const fObr = hasData && obr !== 'Sin obra'
        ? `ABS(SUMIF(${dr('D')},"${obr.replace(/"/g,'""')}",${dr('G')}))`
        : null;
      rows[R_OBR_D0 + i] = kv(obr, fObr ? f(val, fObr) : val);
    });
    const obrSumFormula = numObras > 0 ? `SUM(B${XF(R_OBR_D0)}:B${XF(R_OBR_D0 + numObras - 1)})` : '0';
    rows[R_OBR_TOT] = kv('TOTAL GASTOS', f(valGast, obrSumFormula));
    rows[18 + numCats + numObras] = [...E];
    rows[R_DET_TTL] = [`DETALLE — ${periodo}`, ...E.slice(1)];
    rows[R_DET_HDR] = ['Fecha', 'Tipo', 'Categoría', 'Obra', 'Proveedor', 'Descripción', 'Monto ($)'];
    filtered.forEach((mv, i) => {
      rows[R_DET_D0 + i] = [
        mv.fecha       || '',
        mv.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        mv.categoria   || '',
        mv.obra        || '',
        mv.proveedor   || '',
        mv.descripcion || '',
        mv.tipo === 'ingreso' ? (mv.monto || 0) : -(mv.monto || 0)
      ];
    });

    // ─── Libro ──────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 26 }, { wch: 36 }, { wch: 14 }];

    ws['!merges'] = [
      R_TITLE, R_USER, R_PERIODO, R_GEN, R_RESUMEN, R_CAT_TTL, R_OBR_TTL, R_DET_TTL
    ].map(r => ({ s: { r, c: 0 }, e: { r, c: 6 } }));

    ws['!rows'] = [];
    ws['!rows'][R_TITLE]   = { hpt: 22 };
    ws['!rows'][R_RESUMEN] = ws['!rows'][R_CAT_TTL] = ws['!rows'][R_OBR_TTL] = ws['!rows'][R_DET_TTL] = { hpt: 18 };

    // ─── Estilos (colores en ARGB de 8 chars requerido por xlsx) ────────────────
    const a    = h => 'FF' + h;
    const BLUE  = a('1A3A5C');
    const MBLUE = a('2D5F8A');
    const LBLUE = a('D6E4F0');
    const TEAL  = a('3A78B5');
    const WHITE = a('FFFFFF');
    const LGRAY = a('F5F7FA');
    const YELW  = a('FFFDE7');
    const GREEN = a('1B5E20');
    const RED   = a('B71C1C');
    const BORD  = a('B0BEC5');

    const solid = (rgb) => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { indexed: 64 } });
    const b     = { style: 'thin', color: { rgb: BORD } };
    const thin  = () => ({ top: b, bottom: b, left: b, right: b });

    function cs(r, c, s) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = s;
    }

    const FMT = '#,##0.00';
    const numStyle = (bg, color, bold = false) => ({
      font: { bold, sz: 10, color: { rgb: color } },
      fill: solid(bg),
      border: thin(),
      numFmt: FMT,
      alignment: { horizontal: 'right' }
    });
    const lblStyle = (bg, bold = false) => ({
      font: { bold, sz: 10, color: { rgb: '333333' } },
      fill: solid(bg),
      border: thin()
    });

    // Título principal
    cs(R_TITLE, 0, { font: { bold: true, sz: 14, color: { rgb: WHITE } }, fill: solid(BLUE), alignment: { horizontal: 'center', vertical: 'center' } });
    // Subheader
    [R_USER, R_PERIODO, R_GEN].forEach(r =>
      cs(r, 0, { font: { sz: 10, color: { rgb: WHITE } }, fill: solid(MBLUE) })
    );
    // Secciones
    [R_RESUMEN, R_CAT_TTL, R_OBR_TTL, R_DET_TTL].forEach(r =>
      cs(r, 0, { font: { bold: true, sz: 11, color: { rgb: WHITE } }, fill: solid(MBLUE) })
    );
    // Resumen
    cs(R_EXC,   0, lblStyle(LGRAY));  cs(R_EXC,   1, numStyle(LGRAY, BLUE));
    cs(R_INGR,  0, lblStyle(LGRAY));  cs(R_INGR,  1, numStyle(LGRAY, GREEN));
    cs(R_GAST,  0, lblStyle(LGRAY));  cs(R_GAST,  1, numStyle(LGRAY, RED));
    cs(R_SALDO, 0, lblStyle(LBLUE, true)); cs(R_SALDO, 1, numStyle(LBLUE, BLUE, true));
    // Cabecera tabla categorías
    [0, 1].forEach(c => cs(R_CAT_HDR, c, { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: solid(TEAL), border: thin(), alignment: { horizontal: c === 1 ? 'right' : 'left' } }));
    // Filas categorías
    cats.forEach((_, i) => {
      const bg = i % 2 === 0 ? WHITE : LGRAY;
      cs(R_CAT_D0 + i, 0, lblStyle(bg));
      cs(R_CAT_D0 + i, 1, numStyle(bg, RED));
    });
    // Total categorías
    cs(R_CAT_TOT, 0, { font: { bold: true, sz: 10, color: { rgb: RED } }, fill: solid(YELW), border: thin() });
    cs(R_CAT_TOT, 1, numStyle(YELW, RED, true));
    // Cabecera tabla obras
    [0, 1].forEach(c => cs(R_OBR_HDR, c, { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: solid(TEAL), border: thin(), alignment: { horizontal: c === 1 ? 'right' : 'left' } }));
    // Filas obras
    obrasRows.forEach((_, i) => {
      const bg = i % 2 === 0 ? WHITE : LGRAY;
      cs(R_OBR_D0 + i, 0, lblStyle(bg));
      cs(R_OBR_D0 + i, 1, numStyle(bg, RED));
    });
    // Total obras
    cs(R_OBR_TOT, 0, { font: { bold: true, sz: 10, color: { rgb: RED } }, fill: solid(YELW), border: thin() });
    cs(R_OBR_TOT, 1, numStyle(YELW, RED, true));
    // Cabecera tabla detalle
    for (let c = 0; c < 7; c++)
      cs(R_DET_HDR, c, { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: solid(TEAL), border: thin(), alignment: { horizontal: c === 6 ? 'right' : 'left' } });
    // Filas detalle
    filtered.forEach((mv, i) => {
      const bg = i % 2 === 0 ? WHITE : LGRAY;
      const isI = mv.tipo === 'ingreso';
      for (let c = 0; c < 7; c++)
        cs(R_DET_D0 + i, c, c === 6
          ? numStyle(bg, isI ? GREEN : RED)
          : { font: { sz: 10, color: { rgb: '333333' } }, fill: solid(bg), border: thin() });
    });

    XLSX.utils.book_append_sheet(wb, ws, periodo.substring(0, 31));

    // ─── Subir a Drive silenciosamente ──────────────────
    try {
      const wbout  = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
      const blob   = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const safe   = targetNombre.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
      const fname  = `Caja_${safe}_${periodo.replace(/\s+/g, '_')}.xlsx`;
      await uploadToCajaDrive(new File([blob], fname, { type: blob.type }), {
        userId: targetCodigo, userName: targetNombre,
        fecha: mesActual + '-01', tipo: 'planilla'   // mesActual ya es el mes correcto
      });
    } catch (_) {}
  }

  // ─── Init ────────────────────────────────────────────
  mesSel = mesHoy();
  await loadCategorias();
  await loadObras();
  if (isAdmin) {
    const pedida = new URLSearchParams(location.search).get('caja');
    if (pedida) {
      await cargarPersonas();
      history.replaceState(null, '', location.pathname);
      await abrirCaja(pedida);
    } else {
      await mostrarTodas();
    }
  } else {
    mostrarVista();
    await loadMovimientos();
  }
});
