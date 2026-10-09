/* VIMECO S.A. — Gestión de Equipos (admin 0000 o Jefe de taller)
   Teléfono: mosaico por familia. Escritorio: lista por familia + ficha al costado. */

const $ = id => document.getElementById(id);

// Lista inicial para importar la primera vez (código, tipo).
const SEED_EQUIPOS = [
  ['AC 86', 'Acoplado'],
  ['AT 286', 'Acoplado Tanque'],
  ['BS 103', 'Barredora Sopladora'],
  ['C 172', 'Camion L111'],
  ['C 23', 'Camión F6000'],
  ['C 301', 'Camion Tractor 1722'],
  ['C 316', 'Camion Tractor 1722'],
  ['C 321', 'Camion Tractor 1933'],
  ['C 340', 'Camion Homigonero 4M3'],
  ['C 362', 'Camion Stralis 440'],
  ['C 378', 'Camion Atego'],
  ['C 50', 'Camión Regador F700'],
  ['C 76', 'Camión Dist. Asfalto F700'],
  ['CB 306', 'Batea'],
  ['CB 319', 'Batea'],
  ['CJ 197', 'Cortadora De Juntas'],
  ['CPT 297', 'Compactador Pison Tremix'],
  ['CVA 332', 'Compactador Vibrador Ammann'],
  ['D 210', 'Desmalezadora'],
  ['D 380', 'Desmalezadora De Tiro'],
  ['DA 90', 'Distribuidora De Piedra'],
  ['GE 279', 'Grupo Electrógeno'],
  ['GE 294', 'Grupo Electrógeno'],
  ['GE 400', 'Grupo Electrog. Portatil 3Hp'],
  ['LAB 394', 'Laboratorio'],
  ['MB 270', 'Motobomba Bounus'],
  ['MB 271', 'Motobomba Bounus'],
  ['MC 16', 'Motocompactador'],
  ['MCASE 406', 'Martillo P/Case'],
  ['MG 356', 'Motoguadaña 280'],
  ['MG 384', 'Motoguadaña Sthil 291'],
  ['MN 291', 'Motoniveladora 140 H'],
  ['MN 358', 'Motoniveladora'],
  ['MN 72', 'Motoniveladora 14E'],
  ['MPC 4', 'Comp. Gig.,Terraco 1'],
  ['MS 386', 'Motosierra Stihl 250'],
  ['MS 392', 'Motosierra Stihl 250'],
  ['MTX 318', 'Bobcat'],
  ['MTX 328', 'Bobcat'],
  ['MTX 376', 'Bobcat'],
  ['MTXB 398', 'Barredora Angular'],
  ['MTXC 326', 'Comp. Rodillo P/Bobcat'],
  ['MTXF 382', 'Fresadora P/Bobcat'],
  ['MTXM 329', 'Martillo P/Bobcat'],
  ['MTXM 330', 'Martillo P/Bobcat'],
  ['MTXP 408', 'Paletizador P/Bobcat'],
  ['MTXT 331', 'Trailer Para Bobcat'],
  ['MTXZ 327', 'Zanjadora P/Bobcat'],
  ['P 288', 'Pick Up Ranger'],
  ['P 296', 'Pick Up S-10'],
  ['P 312', 'Pick Up Hilux'],
  ['P 313', 'Pick Up Hilux'],
  ['P 314', 'Pick Up Hilux'],
  ['P 317', 'Pick Up Ranger 4X4 Xlt'],
  ['P 319', 'Pick Up Saveiro'],
  ['P 320', 'Pick Up Hilux'],
  ['P 322', 'Ranger Xls'],
  ['P 350', 'Pick Up'],
  ['P 352', 'Pick Up'],
  ['P 366', 'Pick Up Alaskan 2,3 Tdi 4X4'],
  ['P 374', 'Pick Up Ranger 2,2 4X2'],
  ['P 412', 'Pick Up Hilux'],
  ['P 413', 'Pick Up Hilux'],
  ['P 414', 'Pick Up Hilux'],
  ['PA 290', 'Planta De Asfalto'],
  ['PA 311', 'Auto'],
  ['PA 354', 'Auto Versa'],
  ['PA 360', 'Auto Taos Suv'],
  ['PC 104', 'Pta.Clasif.De Aridos'],
  ['PH 238', 'Pala Hidráulica tiro'],
  ['PT 231', 'Planta De Trituración'],
  ['PTC 325', 'Trituradora Cono 2 Pies'],
  ['PU 368', 'Kangoo'],
  ['PU 370', 'Kangoo'],
  ['RD 177', 'Rastra A Discos'],
  ['RD 189', 'Rastra A Discos'],
  ['RE 305', 'Retroexc. Cat 320'],
  ['RE 388', 'Retroexcavadora Sany 215'],
  ['REC 310', 'Retropala Case 580 4Wd'],
  ['REC 315', 'Retropala Case 580 4Wd'],
  ['RLV 281', 'Comp. Rodillo Liso Vibrante'],
  ['RLV 299', 'Compactador'],
  ['RLV 364', 'Compactador'],
  ['RLV 78', 'Comp.Rodillo Liso Vibrante RVT100'],
  ['RNA 17', 'Comp. Rodillo Neum.Autoprop.'],
  ['RNV 342', 'Comp. Neum. Vibrante'],
  ['RPC 180', 'Comp. Rodillo Pata De Cabra'],
  ['RPP 410', 'Paletizador P/Case'],
  ['S 390', 'Semirremolque'],
  ['S 57', 'Semirremolque'],
  ['SC 58', 'Semirremolque Carreton'],
  ['TA 304', 'Terminadora Asfalto'],
  ['TO 102', 'Tractor Oruga D7 F'],
  ['TR 187', 'Tractor 727'],
  ['TR 188', 'Tractor 727'],
  ['TR 8', 'Tractor 780 R'],
  ['TR 94', 'Tractor 780 R'],
  ['TX 252', 'Cargador Frontal 930'],
  ['TX 268', 'Cargador Frontal 930'],
  ['TX 307', 'Cargadora Frontal'],
  ['TX 321', 'Cargadora Frontal'],
  ['TXM 372', 'Manitou'],
  ['VQ 217', 'Volqueta'],
  ['VQ 218', 'Volqueta']
];

// Patentes / dominios por código de equipo, para la importación inicial.
// Los equipos ya cargados tienen la patente en su ficha: esta tabla sólo
// aplica si alguna vez se vuelve a sembrar la lista desde cero.
const SEED_PATENTES = {
  'AC 86':     'D 006622',
  'C 172':     'VMH-951',
  'C 23':      'F 010331',
  'C 301':     'FVG466',
  'C 316':     'NRX240',
  'C 323':     'AA088DH',
  'C 362':     'AF440LL',
  'C 378':     'AH033UP',
  'C 50':      'D 010753',
  'C 76':      'D 002475',
  'CB 306':    'FXQ815',
  'CB 324':    'PHK729',
  'MN 358':    'ELE 29',
  'MTX 318':   'AA088DH',
  'MTXT 331':  '101LHL342',
  'P 296':     'FMN202',
  'P 312':     'KZB380',
  'P 313':     'LHL342',
  'P 314':     'LVX297',
  'P 317':     'NYQ004',
  'P 319':     'NRL824',
  'P 320':     'OYI625',
  'P 322':     'AA383RS',
  'P 350':     'AB513SR',
  'P 352':     'AD352JR',
  'P 366':     'AF440LH',
  'P 374':     'AF802FA',
  'PA 311':    'LGL360',
  'PA 354':    'AD226EA',
  'PA 360':    'AF241TT',
  'PH 238':    'X 574327',
  'PU 368':    'AF882SN',
  'PU 370':    'AG200KI',
  'REC 310':   'CSH61',
  'REC 315':   'NRX240',
  'RLV 364':   'ERK 37',
  'S 390':     'AH538BF',
  'S 57':      'D 001588',
  'SC 58':     'D 001816',
  'TXM 372':   'EVJ02'
};

// esc, equipoKey, familias, ubicPill, fotos y compras: equiposComun.js

let allEquipos = [];
let obrasMap   = {};          // key de obra → nombre (para mostrar la ubicación)
let conFoto    = new Set();   // keys con foto en /equipos_fotos
let verReportes = false;

// Filtros y equipo elegido. Se recuerdan en la pestaña: al volver de una ficha
// la lista queda como estaba.
const FKEY = 'vimeco_equipos_filtros';
const st = (() => {
  const d = { ubic: '', fam: '', estado: 'act', q: '', sel: null, periodo: '12m' };
  try { return { ...d, ...JSON.parse(sessionStorage.getItem(FKEY) || '{}') }; } catch (_) { return d; }
})();
function guardarFiltros() {
  try { sessionStorage.setItem(FKEY, JSON.stringify(st)); } catch (_) {}
}

const mqDesk = window.matchMedia('(min-width: 1000px)');

// ---- Filtros ----
function nombreUbic(e) { return e.ubicacion ? (obrasMap[e.ubicacion] || 'Obra dada de baja') : ''; }

function haystack(e) {
  return normTxt([e.codigo, e.tipo, e.patente, e.responsable, familiaDe(e).n, nombreUbic(e)].join(' '));
}

function filtrar({ sinUbic = false, sinFam = false } = {}) {
  const terms = terminosBusqueda(st.q);
  return allEquipos.filter(e => {
    if (st.estado === 'act' && e.activo === false) return false;
    if (st.estado === 'inact' && e.activo !== false) return false;
    if (!sinUbic && st.ubic === '__none' && e.ubicacion) return false;
    if (!sinUbic && st.ubic && st.ubic !== '__none' && e.ubicacion !== st.ubic) return false;
    if (!sinFam && st.fam && familiaDe(e).k !== st.fam) return false;
    if (terms.length) { const h = haystack(e); if (!terms.every(t => h.includes(t))) return false; }
    return true;
  });
}

const CHEV = () => icSvg('chevron', 'act-chev');
function opt(v, label, n, sel, icono) {
  return `<button type="button" class="act-opt" role="option" data-v="${esc(v)}" aria-selected="${sel}">` +
    (icono ? `<span class="act-opt-ic eq-sq">${icSvg(icono)}</span>` : '') +
    `<span>${esc(label)}</span><span class="act-opt-n">${n}</span></button>`;
}

function pintarFiltros() {
  // Ubicación: sólo las obras que tienen algún equipo (contando con los demás filtros).
  const base = filtrar({ sinUbic: true });
  const porUbic = {};
  base.forEach(e => { const k = e.ubicacion || '__none'; porUbic[k] = (porUbic[k] || 0) + 1; });
  const obrasUsadas = Object.keys(porUbic).filter(k => k !== '__none')
    .sort((a, b) => (obrasMap[a] || '').localeCompare(obrasMap[b] || ''));
  if (st.ubic && !porUbic[st.ubic] && st.ubic !== '__none' && !obrasMap[st.ubic]) st.ubic = '';
  $('menu-ubic').innerHTML =
    opt('', 'Todas las ubicaciones', base.length, !st.ubic) +
    obrasUsadas.map(k => opt(k, obrasMap[k] || 'Obra dada de baja', porUbic[k], st.ubic === k, esTaller(obrasMap[k]) ? 'tool' : 'pin')).join('') +
    (porUbic.__none ? opt('__none', 'Sin ubicación', porUbic.__none, st.ubic === '__none') : '');
  const ubicLbl = !st.ubic ? 'Todas las ubicaciones' : st.ubic === '__none' ? 'Sin ubicación' : (obrasMap[st.ubic] || 'Obra dada de baja');
  document.querySelector('[data-dd="ubic"]').innerHTML = icSvg('pin') + `<span>${esc(ubicLbl)}</span>` + CHEV();

  const baseF = filtrar({ sinFam: true });
  const porFam = {};
  baseF.forEach(e => { const k = familiaDe(e).k; porFam[k] = (porFam[k] || 0) + 1; });
  $('menu-fam').innerHTML = opt('', 'Todas las familias', baseF.length, !st.fam) +
    FAMILIAS.filter(f => porFam[f.k]).map(f => opt(f.k, f.n, porFam[f.k], st.fam === f.k, f.i)).join('');
  const famLbl = st.fam ? FAM_BY_KEY[st.fam].n : 'Todas las familias';
  document.querySelector('[data-dd="fam"]').innerHTML = icSvg('layers') + `<span>${esc(famLbl)}</span>` + CHEV();

  document.querySelectorAll('#seg-estado button').forEach(b => b.setAttribute('aria-pressed', b.dataset.e === st.estado));
}

function pintarContadores() {
  const activos = allEquipos.filter(e => e.activo !== false);
  const enObra  = activos.filter(e => e.ubicacion && !esTaller(obrasMap[e.ubicacion])).length;
  const inact   = allEquipos.length - activos.length;
  const set = (id, html, show) => { $(id).innerHTML = html; $(id).classList.toggle('hidden', !show); };
  set('cnt-total', `<b>${allEquipos.length}</b> equipos`, allEquipos.length > 0);
  set('cnt-obra', `<b>${enObra}</b> en obra`, allEquipos.length > 0);
  set('cnt-inact', `<b>${inact}</b> inactivo${inact === 1 ? '' : 's'}`, inact > 0);
}

// ---- Lista ----
function hl(txt) {
  const terms = terminosBusqueda(st.q);
  return terms.length ? resaltarTxt(txt, terms, esc) : esc(txt);
}

function porFamilia(list) {
  return FAMILIAS.map(f => ({ f, items: list.filter(e => familiaDe(e).k === f.k) })).filter(g => g.items.length);
}

function tileHTML(e) {
  const f = familiaDe(e);
  return `<button type="button" class="eq-tile${e.activo === false ? ' inact' : ''}" data-key="${esc(e.key)}" title="Abrir ficha">
      <span class="ph">${icSvg(f.i)}${ubicPill(e, obrasMap)}</span>
      <span class="tx"><span class="cod">${hl(e.codigo)}${e.patente ? `<span class="eq-pat">${hl(e.patente)}</span>` : ''}</span>
      <span class="tp" title="${esc(e.tipo || '')}">${hl(e.tipo || '—')}</span></span>
    </button>`;
}

function rowHTML(e) {
  const f = familiaDe(e);
  const resp = e.responsable ? ` · ${icSvg('user')} ${hl(e.responsable)}` : '';
  return `<button type="button" class="eq-r${e.activo === false ? ' inact' : ''}${st.sel === e.key ? ' sel' : ''}" data-key="${esc(e.key)}">
      <span class="eq-sq">${icSvg(f.i)}</span>
      <span class="mid"><span class="l1"><span class="cod">${hl(e.codigo)}</span>${e.patente ? `<span class="eq-pat">${hl(e.patente)}</span>` : ''}</span>
      <span class="l2">${hl(e.tipo || '—')}${resp}</span></span>
      ${ubicPill(e, obrasMap)}
    </button>`;
}

function renderLista() {
  const container = $('equipos-list');
  const seedBtn   = $('btn-seed');
  pintarContadores();
  pintarFiltros();
  if (!allEquipos.length) {
    container.innerHTML = '<div class="eq-card eq-vacio">No hay equipos cargados.</div>';
    seedBtn.classList.remove('hidden');
    return;
  }
  seedBtn.classList.add('hidden');
  const list = filtrar();
  if (!list.length) {
    container.innerHTML = '<div class="eq-card eq-vacio">No se encontraron equipos con estos filtros.</div>';
    return;
  }
  const grupos = porFamilia(list);
  const fam = g => `<div class="eq-fam">${esc(g.f.n)}<span class="n">${g.items.length}</span></div>`;

  if (mqDesk.matches) {
    if (!list.some(e => e.key === st.sel)) st.sel = grupos[0].items[0].key;
    container.innerHTML = `<div class="eq-split">
        <div>${grupos.map(g => fam(g) + `<div class="eq-rows">${g.items.map(rowHTML).join('')}</div>`).join('')}</div>
        <aside class="eq-split-side" id="eq-side"></aside>
      </div>`;
    renderSide();
  } else {
    container.innerHTML = grupos.map(g => fam(g) + `<div class="eq-mos">${g.items.map(tileHTML).join('')}</div>`).join('');
    observarFotos();
  }
}

// Fotos del mosaico: sólo las de los equipos que tienen y a medida que aparecen.
let fotoObs = null;
function ponerFoto(ph, key) {
  fotoDe(key).then(src => {
    if (!src || !ph.isConnected || ph.querySelector('img')) return;
    const img = new Image();
    img.alt = '';
    img.src = src;
    ph.prepend(img);
  });
}
function observarFotos() {
  if (fotoObs) fotoObs.disconnect();
  const tiles = [...document.querySelectorAll('.eq-tile')].filter(t => conFoto.has(t.dataset.key));
  if (!tiles.length) return;
  if (!('IntersectionObserver' in window)) { tiles.forEach(t => ponerFoto(t.querySelector('.ph'), t.dataset.key)); return; }
  fotoObs = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    fotoObs.unobserve(en.target);
    ponerFoto(en.target.querySelector('.ph'), en.target.dataset.key);
  }), { rootMargin: '200px' });
  tiles.forEach(t => fotoObs.observe(t));
}

// ---- Ficha al costado (escritorio) ----
function renderSide() {
  const side = $('eq-side');
  if (!side) return;
  const e = allEquipos.find(x => x.key === st.sel);
  if (!e) {
    side.innerHTML = `<div class="eq-card eq-side-vacio"><span class="eq-sq">${icSvg('truck')}</span>Elegí un equipo de la lista.</div>`;
    return;
  }
  const f = familiaDe(e);
  const activo = e.activo !== false;
  side.innerHTML = `
    <div class="eq-card">
      <div class="eq-hero">
        <div class="ph" id="side-foto">${icSvg(f.i)}</div>
        <div class="info">
          <div class="cod">${esc(e.codigo)}</div>
          <div class="tp">${esc(e.tipo || '—')} · ${esc(f.n)}</div>
          <div class="eq-chips">
            ${e.patente ? `<span class="eq-pat">${esc(e.patente)}</span>` : ''}
            <span class="eq-st ${activo ? 'eq-st--ok' : 'eq-st--off'}">${icSvg(activo ? 'checkSm' : 'power')}${activo ? 'Activo' : 'Inactivo'}</span>
            ${ubicPill(e, obrasMap, { sinEstado: true })}
          </div>
          <div class="eq-kv" style="margin-top:.3rem"><span>Responsable</span><b>${esc(e.responsable || '—')}</b></div>
        </div>
      </div>
      <div class="eq-side-acts">
        <button type="button" class="foc-btn foc-btn--tea" id="side-abrir">${icSvg('edit')}Abrir la ficha completa</button>
      </div>
    </div>
    <div class="eq-card">
      <div class="eq-sec-h"><span class="eq-sq eq-sq--blue">${icSvg('cart')}</span><h2>Compras del equipo</h2>
        <span class="eq-push">${periodoDdHTML('periodo', st.periodo)}</span></div>
      <div id="side-compras"><div class="eq-vacio">Buscando las OC del equipo…</div></div>
    </div>`;
  $('side-abrir').addEventListener('click', () => openFicha(e.key));
  if (conFoto.has(e.key)) ponerFoto($('side-foto'), e.key);
  pintarCompras(e);
}

function pintarCompras(e) {
  ocsConEquipo().then(ocs => {
    const box = $('side-compras');
    if (!box || st.sel !== e.key) return;
    box.innerHTML = comprasHTML(resumenCompras(ocs, e.codigo, st.periodo),
      { max: 5, linkReportes: verReportes ? linkReportesEquipo(e.codigo) : '' });
  }).catch(() => {
    const box = $('side-compras');
    if (box) box.innerHTML = '<div class="eq-vacio">No se pudieron leer las compras.</div>';
  });
}

function elegir(key) {
  st.sel = key;
  guardarFiltros();
  document.querySelectorAll('.eq-r').forEach(r => r.classList.toggle('sel', r.dataset.key === key));
  renderSide();
}

function openFicha(key) {
  st.sel = key;
  guardarFiltros();
  window.location.href = 'equipo.html?key=' + encodeURIComponent(key);
}

async function loadEquipos() {
  try {
    const [equipos, obras, fotos] = await Promise.all([
      getAllEquipos(),
      getAllObras().catch(() => []),
      getEquiposConFoto().catch(() => new Set())
    ]);
    allEquipos = equipos;
    conFoto = fotos;
    obrasMap = {};
    obras.forEach(o => { obrasMap[o.key] = o.nombre; });
    renderLista();
  } catch (_) {
    $('equipos-list').innerHTML = '<div class="eq-card eq-vacio">Error al cargar equipos.</div>';
  }
}

// ---- Alta ----
let famAlta = null;      // familia elegida a mano (null = la del código)

function pintarFamAlta() {
  const auto = familiaPorCodigo($('equipo-codigo').value);
  const sel  = famAlta || auto.k;
  $('equipo-familia').innerHTML = FAMILIAS.map(f =>
    `<button type="button" data-fam="${f.k}" aria-pressed="${f.k === sel}">${esc(f.n)}</button>`).join('');
  const pre = ($('equipo-codigo').value.trim().toUpperCase().match(/^[A-Z]+/) || [''])[0];
  $('equipo-familia-hint').textContent = famAlta
    ? 'Elegida a mano.'
    : pre && auto.k !== 'otro' ? `Elegida sola por el código "${pre}"; se puede cambiar.` : 'Se elige sola por el código; se puede cambiar.';
}

function openAddModal() {
  $('modal-equipo-error').classList.add('hidden');
  ['equipo-codigo', 'equipo-tipo', 'equipo-patente', 'equipo-responsable'].forEach(id => { $(id).value = ''; });
  famAlta = null;
  pintarFamAlta();
  $('modal-equipo').classList.remove('hidden');
  setTimeout(() => $('equipo-codigo').focus(), 50);
}

function cerrarAlta() { $('modal-equipo').classList.add('hidden'); }

// Alta rápida (código + tipo + patente + familia + responsable).
// La foto y los repuestos se cargan luego en la ficha.
async function saveEquipoModal() {
  const codigo      = $('equipo-codigo').value.trim();
  const tipo        = $('equipo-tipo').value.trim();
  const patente     = $('equipo-patente').value.trim().toUpperCase();
  const responsable = $('equipo-responsable').value.trim();
  const errEl       = $('modal-equipo-error');

  if (!codigo) {
    errEl.textContent = 'El código es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const key = equipoKey(codigo);
  if (allEquipos.some(e => e.key === key)) {
    errEl.textContent = 'Ya existe un equipo con ese código.';
    errEl.classList.remove('hidden');
    return;
  }

  const saveBtn = $('modal-equipo-save');
  const lbl = saveBtn.querySelector('span');
  saveBtn.disabled = true;
  lbl.textContent = 'Guardando…';

  const data = { codigo, tipo, patente, responsable, activo: true, creadoEn: Date.now() };
  // Sólo se guarda si difiere de la que sale del código.
  if (famAlta && famAlta !== familiaPorCodigo(codigo).k) data.familia = famAlta;
  try {
    await saveEquipo(key, data);
    cerrarAlta();
    showToast('Equipo creado.');
    openFicha(key);
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    lbl.textContent = 'Crear y abrir la ficha';
  }
}

async function seedEquipos() {
  const ok = await showConfirm(
    'Importar lista inicial',
    `Se cargarán ${SEED_EQUIPOS.length} equipos. Los equipos con el mismo código se sobrescribirán.`,
    { boton: 'Importar', tono: 'warn', icono: 'layers' }
  );
  if (!ok) return;

  const btn = $('btn-seed');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  try {
    const obj = {};
    SEED_EQUIPOS.forEach(([codigo, tipo]) => {
      obj[equipoKey(codigo)] = {
        codigo, tipo,
        patente: SEED_PATENTES[codigo] || '',
        activo: true, creadoEn: Date.now()
      };
    });
    await bulkSaveEquipos(obj);
    showToast('Lista inicial importada.');
    await loadEquipos();
  } catch (_) {
    showToast('Error al importar la lista.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar lista inicial';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  const code = _s?.codigo || sessionStorage.getItem('responsable_code');
  const name = _s?.nombre || sessionStorage.getItem('responsable_name');
  if (!code) { window.location.href = 'index.html'; return; }

  // Acceso: super-admin (0000) o Jefe de taller.
  let allowed = code === '0000';
  if (!allowed) {
    try { const u = await getUsuario(code); allowed = !!(u && u.jefeTaller); } catch (_) {}
  }
  if (!allowed) { window.location.href = 'menu.html'; return; }
  puedeVerReportes(code).then(v => { verReportes = v; });

  $('hdr-name').textContent = name || '—';
  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  $('btn-add-equipo').addEventListener('click', openAddModal);
  $('btn-seed').addEventListener('click', seedEquipos);

  const buscar = $('buscar-equipo');
  buscar.value = st.q;
  buscar.addEventListener('input', () => { st.q = buscar.value; guardarFiltros(); renderLista(); });

  bindDesplegables((opt, dd) => {
    if (dd === 'ubic') st.ubic = opt.dataset.v;
    else if (dd === 'fam') st.fam = opt.dataset.v;
    else if (dd === 'periodo') {
      st.periodo = opt.dataset.periodo;
      guardarFiltros();
      return renderSide();
    }
    guardarFiltros();
    renderLista();
  });
  $('seg-estado').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-e]');
    if (!b) return;
    st.estado = b.dataset.e;
    guardarFiltros();
    renderLista();
  });

  $('equipos-list').addEventListener('click', ev => {
    const t = ev.target.closest('.eq-tile, .eq-r');
    if (!t) return;
    if (t.classList.contains('eq-tile')) openFicha(t.dataset.key);
    else elegir(t.dataset.key);
  });
  $('equipos-list').addEventListener('dblclick', ev => {
    const r = ev.target.closest('.eq-r');
    if (r) openFicha(r.dataset.key);
  });
  mqDesk.addEventListener('change', () => { if (allEquipos.length) renderLista(); });

  $('equipo-codigo').addEventListener('input', () => { if (!famAlta) pintarFamAlta(); });
  $('equipo-familia').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-fam]');
    if (!b) return;
    famAlta = b.dataset.fam === familiaPorCodigo($('equipo-codigo').value).k ? null : b.dataset.fam;
    pintarFamAlta();
  });
  $('modal-equipo-close').addEventListener('click', cerrarAlta);
  $('modal-equipo-cancel').addEventListener('click', cerrarAlta);
  $('modal-equipo').addEventListener('click', ev => { if (ev.target.id === 'modal-equipo') cerrarAlta(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('modal-equipo').classList.contains('hidden')) cerrarAlta(); });
  $('modal-equipo-save').addEventListener('click', saveEquipoModal);
  $('equipo-responsable').addEventListener('keydown', e => { if (e.key === 'Enter') saveEquipoModal(); });

  loadEquipos();
});
