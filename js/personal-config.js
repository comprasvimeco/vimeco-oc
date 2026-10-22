/* VIMECO S.A. — Personal: configuración (solo 0000)
   Arriba, tres tarjetas de resumen que avisan lo pendiente y abren su hoja:
   valores hora por mes (UOCRA), feriados y categorías. Abajo, el padrón: la
   lista a la izquierda y la ficha de la persona al costado (en el teléfono,
   una a la vez, con ?p=id en la URL), como en Obras y Usuarios. La ficha se
   guarda con la barra de abajo, que aparece sólo si hay cambios. */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MQ_ANCHA = window.matchMedia('(min-width: 1000px)');
const MESES  = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3   = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS3  = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
// Desde este mes se avisa si faltan los feriados del año siguiente.
const MES_AVISO_FERIADOS = 10;
const FERIADOS_API = 'https://api.argentinadatos.com/v1/feriados/';

// Texto compuesto de categoría: "Oficial + Horas Extras", "Ayudante + 20%", etc.
function categoriaLabel(p) {
  const parts = [];
  if (p.categoria) parts.push(p.categoria);
  if (p.horasExtra) parts.push('Horas Extras');
  const pct = Number(p.porcentajeExtra) || 0;
  if (pct > 0) parts.push(pct + '%');
  return parts.join(' + ');
}

// Fechas locales (toISOString pasa a UTC: de noche corre el día)
function hoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mesIsoActual = () => hoyIso().slice(0, 7);
function mesMas(mes, n) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const mesLargo = mes => `${MESES[+mes.slice(5) - 1]} ${mes.slice(0, 4)}`;
const mesCorto = mes => MES3[+mes.slice(5) - 1];
const fmtPesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fmtNum = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const fmtPct = n => (n > 0 ? '+' : '') + n.toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' %';
// "6.348,50" o "6348.5" → 6348.5
function parseNum(s) {
  s = String(s ?? '').trim().replace(/\$|\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s);
}
const soloDigitos = s => String(s || '').replace(/\D/g, '');
const listaY = l => l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' y ' + l[l.length - 1];

function abrirModal(id) { $(id).classList.remove('hidden'); }
function cerrarModal(id) { $(id).classList.add('hidden'); }

// ───────────── Datos ─────────────
let categorias    = [];
let valoresTodos  = {};   // { "YYYY-MM": { catKey: valorHora } }
let feriados      = {};   // { "YYYY-MM-DD": "Nombre" }
let allPersonal   = [];
let obrasMap      = {};   // { obraKey: nombre }

const mesesConValores = () => Object.keys(valoresTodos).filter(m => valoresTodos[m] && Object.keys(valoresTodos[m]).length).sort();
// Meses sin valores desde el primero cargado hasta el actual: esas quincenas
// la planilla de montos las calcula con el último mes anterior que tenga.
function mesesFaltantes() {
  const con = mesesConValores();
  if (!con.length) return [];
  const out = [], hoy = mesIsoActual();
  for (let m = con[0]; m <= hoy; m = mesMas(m, 1)) if (!con.includes(m)) out.push(m);
  return out;
}
// Último mes con valores, hasta `mes` inclusive.
function mesVigente(mes) {
  const con = mesesConValores().filter(m => m <= mes);
  return con.length ? con[con.length - 1] : null;
}
const anioFaltaFeriados = () => {
  const hoy = hoyIso(), y = +hoy.slice(0, 4);
  const tiene = a => Object.keys(feriados).some(f => f.startsWith(a + '-'));
  if (!tiene(y)) return y;
  if (+hoy.slice(5, 7) >= MES_AVISO_FERIADOS && !tiene(y + 1)) return y + 1;
  return null;
};
const proximoFeriado = () => Object.keys(feriados).sort().find(f => f >= hoyIso()) || null;
function fechaCorta(iso, conDia = true) {
  const d = new Date(iso + 'T12:00:00');
  return `${conDia ? DIAS3[d.getDay()] + ' ' : ''}${d.getDate()} ${MES3[d.getMonth()]}`;
}
const genteDe = cat => allPersonal.filter(p => p.activo !== false && p.categoria === cat).length;

// ───────────── Cabecera y resumen ─────────────
function renderCabecera() {
  const act = allPersonal.filter(p => p.activo !== false).length;
  $('pc-count').textContent = `${act} ${act === 1 ? 'activo' : 'activos'}`;
  const pend = [];
  const falt = mesesFaltantes();
  if (falt.length) {
    const largo = falt.length <= 3 ? `Faltan valores de ${listaY(falt.map(mesCorto))}` : `Faltan valores de ${falt.length} meses`;
    pend.push(`<button type="button" class="pc-pend" data-hoja="valores"><span class="largo">${largo}</span><span class="corto">Valores</span></button>`);
  } else if (!mesesConValores().length) {
    pend.push(`<button type="button" class="pc-pend" data-hoja="valores"><span class="largo">Sin valores hora cargados</span><span class="corto">Valores</span></button>`);
  }
  const fa = anioFaltaFeriados();
  if (fa) pend.push(`<button type="button" class="pc-pend" data-hoja="feriados"><span class="largo">Sin feriados ${fa}</span><span class="corto">Feriados</span></button>`);
  $('pc-pends').innerHTML = pend.join('');
}

function renderResumen() {
  const ult = mesesConValores().pop();
  const falt = mesesFaltantes();
  let valTx = 'Todavía no hay valores cargados';
  if (ult) {
    const c = categorias.find(c => valoresTodos[ult][sanitizeCatKey(c)]);
    valTx = `Último: ${mesLargo(ult)}${c ? ` · ${esc(c)} ${fmtPesos(valoresTodos[ult][sanitizeCatKey(c)])}` : ''}`;
  }
  const valPend = falt.length ? `<span class="pc-pend">${falt.length <= 2 ? listaY(falt.map(m => mesCorto(m)[0].toUpperCase() + mesCorto(m).slice(1))) : falt.length + ' meses'}</span>`
    : (!ult ? '<span class="pc-pend">Cargar</span>' : '');

  const prox = proximoFeriado();
  const fa = anioFaltaFeriados();
  const ferTx = prox ? `Próximo: ${fechaCorta(prox)} · ${esc(feriados[prox])}` : 'No hay feriados próximos cargados';

  const catTx = categorias.length ? categorias.map(esc).join(' › ') : 'Sin categorías: agregá la primera';
  $('pc-sum').innerHTML = `
    <button type="button" class="pc-sumc" data-hoja="valores"><span class="pc-sq t-per">${icSvg('dollar')}</span><div class="tx"><b>Valores hora</b><small>${valTx}</small></div>${valPend}<span class="chev">${icSvg('chevR')}</span></button>
    <button type="button" class="pc-sumc" data-hoja="feriados"><span class="pc-sq">${icSvg('calendar')}</span><div class="tx"><b>Feriados</b><small>${ferTx}</small></div>${fa ? `<span class="pc-pend">${fa}</span>` : ''}<span class="chev">${icSvg('chevR')}</span></button>
    <button type="button" class="pc-sumc" data-hoja="cats"><span class="pc-sq">${icSvg('layers')}</span><div class="tx"><b>Categorías</b><small>${catTx}</small></div><span class="chev">${icSvg('chevR')}</span></button>`;
}

function abrirHoja(h) {
  if (h === 'valores') abrirValores();
  else if (h === 'feriados') abrirFeriados();
  else if (h === 'cats') abrirCats();
}

// ───────────── Padrón: lista ─────────────
let filtro = 'activos';
let selId  = null;
let orig   = null;   // estado guardado de la ficha abierta
let draft  = null;   // lo que se está editando
let fotos  = { frente: null, dorso: null };   // archivos nuevos elegidos (sin subir)
let ladoFoto = null;

const iniciales = p => (((p.apellido || '')[0] || '') + ((p.nombre || '')[0] || '')).toUpperCase();
const obrasDe = p => Object.keys(p.obras || {}).filter(k => p.obras[k]).map(k => ({ key: k, nombre: obrasMap[k] || k }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre));

function filtrosDef() {
  const act = allPersonal.filter(p => p.activo !== false);
  const f = [
    { id: 'activos', label: 'Activos', n: act.length, ok: p => p.activo !== false },
    { id: 'sinobra', label: 'Sin obra', n: act.filter(p => !obrasDe(p).length).length, ok: p => p.activo !== false && !obrasDe(p).length },
  ];
  const porObra = new Map();
  act.forEach(p => obrasDe(p).forEach(o => porObra.set(o.key, { nombre: o.nombre, n: (porObra.get(o.key)?.n || 0) + 1 })));
  [...porObra.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre)).forEach(([k, o]) =>
    f.push({ id: 'o:' + k, label: o.nombre, n: o.n, icon: 'building', ok: p => p.activo !== false && !!(p.obras || {})[k] }));
  const inact = allPersonal.filter(p => p.activo === false).length;
  if (inact) f.push({ id: 'inactivos', label: 'Inactivos', n: inact, ok: p => p.activo === false });
  return f;
}

function renderFiltros() {
  const defs = filtrosDef();
  if (!defs.some(f => f.id === filtro)) filtro = 'activos';
  $('pc-flt').innerHTML = defs.map(f => `<button type="button" data-f="${esc(f.id)}" class="${f.id === filtro ? 'on' : ''}">${f.icon ? icSvg(f.icon) : ''}${esc(f.label)} <b>${f.n}</b></button>`).join('');
}

function filaHtml(p) {
  const off = p.activo === false;
  const obras = obrasDe(p);
  const cat = categoriaLabel(p) ? `<span class="pc-pm t-per">${esc(p.categoria || '')}${p.horasExtra ? ' + H. extras' : ''}${Number(p.porcentajeExtra) > 0 ? ` + ${p.porcentajeExtra}%` : ''}</span>` : '<span class="pc-pm t-warn">Sin categoría</span>';
  const ob = !obras.length ? (off ? '' : '<span class="pc-pm t-warn">Sin obra</span>')
    : obras.length > 2 ? `<span class="pc-pm t-obr">${icSvg('building')}${obras.length} obras</span>`
    : obras.map(o => `<span class="pc-pm t-obr">${icSvg('building')}${esc(o.nombre)}</span>`).join('');
  return `<button type="button" class="pc-row${off ? ' off' : ''}${p.id === selId ? ' sel' : ''}" data-id="${esc(p.id)}">
    <span class="pc-av${off ? ' off' : ''}">${esc(iniciales(p)) || icSvg('user')}</span>
    <span class="mid"><span class="nm">${esc(p.apellido)}, ${esc(p.nombre)}</span>
      <span class="l2">${cat}${p.dni ? `<span class="pc-dni">DNI ${esc(p.dni)}</span>` : ''}${ob}${off ? '<span class="pc-pm">Inactivo</span>' : ''}</span></span>
    <span class="chev">${icSvg('chevR')}</span></button>`;
}

function renderLista() {
  const cont = $('pc-list');
  if (!allPersonal.length) {
    cont.innerHTML = '<div class="pc-rows"><div class="pc-empty">El padrón está vacío. Agregá personal acá o desde la cuadrilla de una obra.</div></div>';
    return;
  }
  const q = ($('pc-q').value || '').trim().toLowerCase();
  const def = filtrosDef().find(f => f.id === filtro);
  // Al buscar se busca en todo el padrón, activos e inactivos.
  const list = allPersonal.filter(p => q
    ? `${p.apellido} ${p.nombre}`.toLowerCase().includes(q) || `${p.nombre} ${p.apellido}`.toLowerCase().includes(q) || soloDigitos(p.dni).includes(soloDigitos(q) || '\u0000')
    : def.ok(p));
  cont.innerHTML = list.length
    ? `<div class="pc-rows">${list.map(filaHtml).join('')}</div>`
    : `<div class="pc-rows"><div class="pc-empty">${q ? 'Nadie coincide con la búsqueda.' : 'No hay nadie en este filtro.'}</div></div>`;
}

function renderTodo() {
  renderCabecera();
  renderResumen();
  renderFiltros();
  renderLista();
}

// ───────────── Padrón: ficha ─────────────
function estadoDe(p) {
  return {
    apellido: p.apellido || '', nombre: p.nombre || '', dni: p.dni || '', categoria: p.categoria || '',
    horasExtra: !!p.horasExtra, porcentajeExtra: Number(p.porcentajeExtra) || 0,
    telefono: p.telefono || '', domicilio: p.domicilio || '',
  };
}
const TEXTOS = ['apellido', 'nombre', 'dni', 'telefono', 'domicilio'];
function cambios() {
  if (!orig || !draft) return [];
  const out = [];
  TEXTOS.forEach(k => { if (draft[k].trim() !== orig[k]) out.push(k); });
  if (draft.categoria !== orig.categoria) out.push('categoria');
  if (draft.horasExtra !== orig.horasExtra) out.push('horasExtra');
  if ((Number(draft.porcentajeExtra) || 0) !== orig.porcentajeExtra) out.push('porcentajeExtra');
  if (fotos.frente) out.push('frente');
  if (fotos.dorso) out.push('dorso');
  return out;
}
const hayCambios = () => cambios().length > 0;

function pintarBarra() {
  const n = cambios().length;
  $('pc-savebar').classList.toggle('hidden', !n);
  $('pc-save-txt').textContent = n === 1 ? '1 cambio sin guardar' : `${n} cambios sin guardar`;
}

function opcionesCategoria(sel) {
  const cats = categorias.slice();
  if (sel && !cats.includes(sel)) cats.push(sel);
  return ['<option value="">Sin categoría</option>']
    .concat(cats.map(c => `<option value="${esc(c)}" ${c === sel ? 'selected' : ''}>${esc(c)}</option>`)).join('');
}

// Las fotos del DNI se guardan como link "ver" de Drive, que el navegador no
// puede mostrar como imagen: se bajan con el token (como en Archivo).
const fotoCache = new Map();   // fileId → Promise<objectURL | null>
function fileIdDe(url) {
  const m = String(url || '').match(/\/d\/([\w-]{10,})/) || String(url || '').match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}
function urlFoto(url) {
  const id = fileIdDe(url);
  if (!id) return Promise.resolve(null);
  if (!fotoCache.has(id)) {
    fotoCache.set(id, bajarDriveArchivo(id)
      .then(r => (r && r.blob ? URL.createObjectURL(r.blob) : null))
      .catch(() => { fotoCache.delete(id); return null; }));
  }
  return fotoCache.get(id);
}
const fotoGuardada = (p, lado) => lado === 'frente' ? (p.fotoDniFrente || p.fotoDniUrl || '') : (p.fotoDniDorso || '');

function dniSlotHtml(p, lado) {
  const nombre = lado === 'frente' ? 'Frente' : 'Dorso';
  if (fotos[lado]) return `<button type="button" class="pc-dslot chg" data-ver="${lado}"><img src="${esc(fotos[lado]._url)}" alt="DNI ${nombre}"><span class="tag">${nombre} · nueva</span></button>`;
  if (fotoGuardada(p, lado)) return `<button type="button" class="pc-dslot" data-ver="${lado}" id="pc-dslot-${lado}"><span class="spinner"></span><span class="tag">${nombre}</span></button>`;
  return `<button type="button" class="pc-dslot vacio" data-elegir="${lado}"><span>${icSvg('camera')}${nombre}</span></button>`;
}

function renderFicha() {
  const cont = $('pc-ficha');
  const p = allPersonal.find(x => x.id === selId);
  if (!p) {
    cont.innerHTML = `<div class="pc-card pc-vacia">${icSvg('user')}<div>Elegí a alguien del padrón para ver y cambiar sus datos.</div></div>`;
    pintarBarra();
    return;
  }
  const off = p.activo === false;
  const meta = [];
  if (draft.categoria) meta.push(`<span class="pc-pm t-per">${esc(draft.categoria)}${draft.horasExtra ? ' + Horas Extras' : ''}</span>`);
  if (draft.dni.trim()) meta.push(`<span class="pc-pm">DNI ${esc(draft.dni.trim())}</span>`);
  if (p.creadoEn) meta.push(`<span class="pc-pm">${icSvg('calendar')}Alta ${new Date(p.creadoEn).toLocaleDateString('es-AR')}</span>`);
  if (off) meta.push(`<span class="pc-pm t-red">${icSvg('power')}Inactivo</span>`);
  const ch = new Set(cambios());
  const cg = k => ch.has(k) ? ' chg' : '';
  const tel = soloDigitos(draft.telefono);

  const head = `<div class="pc-card"><div class="pc-fhead"><span class="pc-av lg${off ? ' off' : ''}">${esc(iniciales(draft)) || icSvg('user')}</span>
    <div class="id"><div class="nm">${esc(draft.apellido.trim() || p.apellido)}, ${esc(draft.nombre.trim() || p.nombre)}</div><div class="meta">${meta.join('')}</div></div></div></div>`;

  const datos = `<div class="pc-card"><div class="pc-sec-h"><span class="pc-sq sm">${icSvg('edit')}</span><b>Datos</b></div>
    <div class="pc-row2">
      <div class="pc-fld"><label for="f-apellido">Apellido</label><input type="text" id="f-apellido" data-k="apellido" class="form-control${cg('apellido')}" value="${esc(draft.apellido)}"></div>
      <div class="pc-fld"><label for="f-nombre">Nombre</label><input type="text" id="f-nombre" data-k="nombre" class="form-control${cg('nombre')}" value="${esc(draft.nombre)}"></div>
    </div>
    <div class="pc-row2">
      <div class="pc-fld"><label for="f-dni">DNI</label><input type="text" id="f-dni" data-k="dni" inputmode="numeric" class="form-control${cg('dni')}" value="${esc(draft.dni)}"></div>
      <div class="pc-fld"><label for="f-cat">Categoría</label><select id="f-cat" data-k="categoria" class="form-control${cg('categoria')}">${opcionesCategoria(draft.categoria)}</select></div>
    </div>
    <div id="f-dup">${dupHtml(draft.dni, p.id)}</div>
    <label class="pc-prow"><span class="tx"><b>Horas extras</b><small>Se agrega a la categoría en las planillas de RRHH</small></span>
      <span class="pc-sw${cg('horasExtra')}"><input type="checkbox" id="f-he" ${draft.horasExtra ? 'checked' : ''}><span></span></span></label>
    <div class="pc-row2">
      <div class="pc-fld"><label for="f-pct">% adicional</label><input type="number" id="f-pct" data-k="porcentajeExtra" min="0" step="1" class="form-control${cg('porcentajeExtra')}" value="${draft.porcentajeExtra || ''}" placeholder="0"></div>
      <div class="pc-fld"><label for="f-tel">Teléfono</label><div class="pc-tel"><input type="tel" id="f-tel" data-k="telefono" inputmode="tel" class="form-control${cg('telefono')}" value="${esc(draft.telefono)}" placeholder="Sin cargar"><a class="pc-call" id="f-call" href="tel:${tel}" title="Llamar" aria-label="Llamar" ${tel.length >= 6 ? '' : 'hidden'}>${icSvg('phone')}</a></div></div>
    </div>
    <div class="pc-fld"><label for="f-dom">Domicilio</label><input type="text" id="f-dom" data-k="domicilio" class="form-control${cg('domicilio')}" value="${esc(draft.domicilio)}" placeholder="Sin cargar"></div></div>`;

  const hayFoto = l => fotos[l] || fotoGuardada(p, l);
  const dni = `<div class="pc-card"><div class="pc-sec-h"><span class="pc-sq sm">${icSvg('image')}</span><b>DNI</b>
      ${p.dniFolderUrl ? `<a class="pc-lnk push" href="${esc(p.dniFolderUrl)}" target="_blank" rel="noopener">${icSvg('folder')}Carpeta en Drive</a>` : ''}</div>
    <div class="pc-dnis">${dniSlotHtml(p, 'frente')}${dniSlotHtml(p, 'dorso')}</div>
    ${hayFoto('frente') || hayFoto('dorso') ? `<div class="pc-dcambiar"><button type="button" class="pc-lnk" data-elegir="frente">${icSvg('camera')}${hayFoto('frente') ? 'Cambiar' : 'Agregar'} frente</button><button type="button" class="pc-lnk" data-elegir="dorso">${icSvg('camera')}${hayFoto('dorso') ? 'Cambiar' : 'Agregar'} dorso</button></div>` : ''}
    <div class="pc-hint">Tocá una foto para verla grande. Se suben a Drive al guardar.</div></div>`;

  const obras = obrasDe(p);
  const obr = `<div class="pc-card"><div class="pc-sec-h"><span class="pc-sq sm t-obr">${icSvg('building')}</span><b>Obras</b></div>
    <div class="pc-chips">${obras.length ? obras.map(o => `<span class="pc-pm t-obr">${icSvg('building')}${esc(o.nombre)}</span>`).join('') : '<span class="pc-pm t-warn">No está en ninguna cuadrilla</span>'}</div>
    <div class="pc-hint">Se suma o se saca desde la cuadrilla de cada obra (Personal).</div></div>`;

  const estado = `<div class="pc-card">${off
    ? `<div><button type="button" class="foc-btn foc-btn--gen" id="f-toggle">${icSvg('power')}Activar</button></div><div class="pc-hint">Inactivo: no aparece en las cuadrillas. Sus partes y planillas viejas quedan.</div>`
    : `<div><button type="button" class="foc-btn foc-btn--del" id="f-toggle">${icSvg('power')}Desactivar</button></div><div class="pc-hint">Queda en el padrón y en las planillas viejas; deja de aparecer en las cuadrillas.</div>`}</div>`;

  cont.innerHTML = head + `<div class="pc-fcols"><div>${datos}</div><div>${dni}${obr}${estado}</div></div>`;
  pintarBarra();
  ['frente', 'dorso'].forEach(lado => {
    if (fotos[lado] || !fotoGuardada(p, lado)) return;
    const pid = p.id;
    urlFoto(fotoGuardada(p, lado)).then(u => {
      const el = $('pc-dslot-' + lado);
      if (!el || selId !== pid) return;
      const nombre = lado === 'frente' ? 'Frente' : 'Dorso';
      el.innerHTML = u ? `<img src="${u}" alt="DNI ${nombre}"><span class="tag">${nombre}</span>`
        : `<span>${icSvg('alert')}No se pudo mostrar</span><span class="tag">${nombre}</span>`;
      if (!u) el.dataset.drive = fotoGuardada(p, lado);
    });
  });
}

// Aviso si el DNI ya lo tiene otra persona del padrón.
function dupDni(dni, salvoId) {
  const d = soloDigitos(dni);
  if (d.length < 6) return null;
  return allPersonal.find(x => x.id !== salvoId && soloDigitos(x.dni) === d) || null;
}
function dupHtml(dni, salvoId) {
  const o = dupDni(dni, salvoId);
  return o ? `<div class="pc-aviso">${icSvg('alert')}<span>Ese DNI ya lo tiene <b>${esc(o.apellido)}, ${esc(o.nombre)}</b>${o.activo === false ? ' (inactivo)' : ''}. ¿No es la misma persona?</span></div>` : '';
}

async function abrirFicha(id, { push = true } = {}) {
  if (id === selId && orig) { if (!MQ_ANCHA.matches) mostrarFicha(true, push); return; }
  if (hayCambios() && !(await descartar())) return;
  const p = allPersonal.find(x => x.id === id);
  selId = p ? id : null;
  orig  = p ? estadoDe(p) : null;
  draft = p ? { ...orig } : null;
  limpiarFotos();
  renderLista();
  renderFicha();
  if (p) mostrarFicha(true, push);
}

// Teléfono: ficha a pantalla completa, con su entrada en el historial para que
// la flecha (o el atrás del sistema) vuelva a la lista.
function mostrarFicha(on, push) {
  document.body.classList.toggle('pc-open', on);
  if (on && push) {
    const url = '?p=' + encodeURIComponent(selId);
    if (location.search !== url) history[MQ_ANCHA.matches ? 'replaceState' : 'pushState']({ p: selId }, '', url);
  }
  if (on && !MQ_ANCHA.matches) window.scrollTo(0, 0);
}

function descartar() {
  return showConfirm('Cambios sin guardar', 'Hay cambios en la ficha que no se guardaron. ¿Descartarlos?',
    { boton: 'Descartar', tono: 'warn', icono: 'undo', cancelar: 'Seguir editando' });
}

function limpiarFotos() {
  ['frente', 'dorso'].forEach(l => { if (fotos[l]) URL.revokeObjectURL(fotos[l]._url); });
  fotos = { frente: null, dorso: null };
}

function deshacer() {
  if (!orig) return;
  draft = { ...orig };
  limpiarFotos();
  renderFicha();
}

async function guardarFicha() {
  const p = allPersonal.find(x => x.id === selId);
  if (!p || !hayCambios()) return;
  const nombre = draft.nombre.trim(), apellido = draft.apellido.trim(), dni = draft.dni.trim();
  if (!nombre || !apellido) { showToast('Nombre y apellido no pueden quedar vacíos.', 'warning'); return; }
  const dup = dupDni(dni, p.id);
  if (dup && soloDigitos(dni) !== soloDigitos(orig.dni)) {
    const ok = await showConfirm('DNI repetido', `Ese DNI ya lo tiene ${dup.apellido}, ${dup.nombre}. ¿Guardar igual?`,
      { boton: 'Guardar igual', tono: 'warn', icono: 'alert' });
    if (!ok) return;
  }
  const btn = $('pc-save');
  btn.disabled = true; btn.innerHTML = 'Guardando…';
  const id = p.id;
  try {
    const fields = {
      nombre, apellido, dni, categoria: draft.categoria, horasExtra: draft.horasExtra,
      porcentajeExtra: Number(draft.porcentajeExtra) || 0, telefono: draft.telefono.trim(), domicilio: draft.domicilio.trim(),
    };
    await patchPersonal(id, fields);
    let fotoFallo = false;
    if (fotos.frente || fotos.dorso) {
      btn.innerHTML = 'Subiendo fotos…';
      const label = `${apellido} ${nombre} - ${dni || 'sin dni'}`.substring(0, 100);
      const patch = {};
      try {
        if (fotos.frente) { const { url, folderUrl } = await uploadDniToDrive(fotos.frente, { label, lado: 'frente' }); patch.fotoDniFrente = url; patch.fotoDniUrl = url; if (folderUrl) patch.dniFolderUrl = folderUrl; }
        if (fotos.dorso)  { const { url, folderUrl } = await uploadDniToDrive(fotos.dorso,  { label, lado: 'dorso'  }); patch.fotoDniDorso = url; if (folderUrl && !patch.dniFolderUrl) patch.dniFolderUrl = folderUrl; }
      } catch (_) { fotoFallo = true; }
      if (Object.keys(patch).length) await patchPersonal(id, patch);
      // Al reemplazar una foto Drive conserva el mismo archivo: que se vuelva a bajar.
      Object.values(patch).forEach(u => { const fid = fileIdDe(u); if (fid) fotoCache.delete(fid); });
    }
    showToast(fotoFallo ? 'Se guardó, pero alguna foto del DNI no se pudo subir.' : 'Cambios guardados.', fotoFallo ? 'warning' : 'success');
    limpiarFotos();
    await cargarPadron(id);
  } catch (_) {
    showToast('No se pudo guardar. Probá de nuevo.', 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = icSvg('checkSm') + 'Guardar';
  }
}

async function toggleActivo() {
  const p = allPersonal.find(x => x.id === selId);
  if (!p) return;
  const activar = p.activo === false;
  const ok = await showConfirm(
    activar ? 'Activar' : 'Desactivar',
    activar ? `¿Activar a ${p.apellido}, ${p.nombre}?`
            : `¿Desactivar a ${p.apellido}, ${p.nombre}? Queda en el padrón y en las planillas viejas, pero deja de aparecer en las cuadrillas.`,
    activar ? { boton: 'Activar', tono: 'ok', icono: 'power' } : { boton: 'Desactivar', tono: 'warn', icono: 'power' }
  );
  if (!ok) return;
  try {
    await patchPersonal(p.id, { activo: activar });
    showToast(activar ? 'Activado.' : 'Desactivado.');
    await cargarPadron(p.id, { conservar: true });
  } catch (_) {
    showToast('No se pudo actualizar.', 'error');
  }
}

function onFichaInput(e) {
  const k = e.target.dataset.k;
  if (!k || !draft) return;
  draft[k] = e.target.value;
  e.target.classList.toggle('chg', cambios().includes(k));
  if (k === 'dni') $('f-dup').innerHTML = dupHtml(draft.dni, selId);
  if (k === 'telefono') { const t = soloDigitos(draft.telefono); $('f-call').href = 'tel:' + t; $('f-call').hidden = t.length < 6; }
  if (k === 'apellido' || k === 'nombre') {
    const nm = document.querySelector('#pc-ficha .pc-fhead .nm');
    if (nm) nm.textContent = `${draft.apellido.trim()}, ${draft.nombre.trim()}`;
  }
  pintarBarra();
}

function onFichaChange(e) {
  if (!draft) return;
  if (e.target.id === 'f-he') { draft.horasExtra = e.target.checked; renderFicha(); }
  else if (e.target.id === 'f-cat') { draft.categoria = e.target.value; renderFicha(); }
}

async function onFichaClick(e) {
  if (e.target.closest('#f-toggle')) { toggleActivo(); return; }
  const el = e.target.closest('[data-elegir]');
  if (el) { ladoFoto = el.dataset.elegir; $('pc-foto-input').value = ''; $('pc-foto-input').click(); return; }
  const v = e.target.closest('[data-ver]');
  if (v) {
    if (v.dataset.drive) { window.open(v.dataset.drive, '_blank', 'noopener'); return; }
    const img = v.querySelector('img');
    if (!img) return;
    $('foto-t').textContent = 'DNI · ' + (v.dataset.ver === 'frente' ? 'frente' : 'dorso');
    $('foto-img').src = img.src;
    abrirModal('modal-foto');
  }
}

// ───────────── Alta ─────────────
function openAlta() {
  ['alta-apellido', 'alta-nombre', 'alta-dni'].forEach(id => { $(id).value = ''; });
  $('alta-cat').innerHTML = opcionesCategoria('');
  $('alta-dup').innerHTML = '';
  $('alta-error').classList.add('hidden');
  abrirModal('modal-alta');
  setTimeout(() => $('alta-apellido').focus(), 50);
}

async function saveAlta() {
  const apellido = $('alta-apellido').value.trim(), nombre = $('alta-nombre').value.trim();
  const dni = $('alta-dni').value.trim(), categoria = $('alta-cat').value;
  const err = $('alta-error');
  if (!apellido || !nombre) { err.textContent = 'Faltan el apellido y el nombre.'; err.classList.remove('hidden'); return; }
  const dup = dupDni(dni, null);
  if (dup) {
    const ok = await showConfirm('DNI repetido', `Ese DNI ya lo tiene ${dup.apellido}, ${dup.nombre}. ¿Agregar igual?`,
      { boton: 'Agregar igual', tono: 'warn', icono: 'alert' });
    if (!ok) return;
  }
  const btn = $('alta-save');
  btn.disabled = true;
  try {
    const id = await savePersonal({ nombre, apellido, dni, categoria, horasExtra: false, porcentajeExtra: 0, telefono: '', domicilio: '',
      activo: true, fotoDniFrente: '', fotoDniDorso: '', obras: {} });
    cerrarModal('modal-alta');
    showToast('Agregado al padrón.');
    filtro = 'activos';
    $('pc-q').value = '';
    await cargarPadron(id);
    if (!MQ_ANCHA.matches) mostrarFicha(true, true);
  } catch (_) {
    err.textContent = 'No se pudo guardar. Probá de nuevo.';
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

// ───────────── Hoja: valores hora por mes ─────────────
let vMes = null, vOrig = {}, vDraft = {};

function abrirValores(mes) {
  const falt = mesesFaltantes();
  vMes = mes || falt[0] || mesIsoActual();
  cargarMesValores();
  abrirModal('hoja-valores');
}
function cargarMesValores() {
  const vals = valoresTodos[vMes] || {};
  vOrig = {}; vDraft = {};
  categorias.forEach(c => { const k = sanitizeCatKey(c); vOrig[k] = vals[k] ? fmtNum(vals[k]) : ''; vDraft[k] = vOrig[k]; });
  renderValores();
}
const valCambios = () => Object.keys(vDraft).filter(k => {
  const a = parseNum(vDraft[k]), b = parseNum(vOrig[k]);
  return !(isNaN(a) && isNaN(b)) && a !== b;
});

// "Agosto $ 7.420 · +4,5 %": el último mes cargado antes del elegido y cuánto sube.
function subValor(k) {
  const ref = mesVigente(mesMas(vMes, -1));
  const r = ref ? Number(valoresTodos[ref][k]) || 0 : 0;
  if (!r) return 'Sin valor anterior';
  const v = parseNum(vDraft[k]), m = mesLargo(ref).slice(0, -5);
  return `${m[0].toUpperCase() + m.slice(1)} ${fmtPesos(r)}${!isNaN(v) && v > 0 ? ' · ' + fmtPct((v / r - 1) * 100) : ''}`;
}

function renderValores() {
  const cargado = Object.keys(valoresTodos[vMes] || {}).length > 0;
  const ref = mesVigente(mesMas(vMes, -1));
  const ch = new Set(valCambios());
  const n = ch.size;
  const filas = categorias.map(c => {
    const k = sanitizeCatKey(c);
    return `<div class="pc-vrow"><div class="tx">${esc(c)}<small data-vsub="${esc(k)}">${subValor(k)}</small></div>
      <input type="text" inputmode="decimal" class="form-control${ch.has(k) ? ' chg' : ''}" data-vk="${esc(k)}" value="${esc(vDraft[k])}" placeholder="$/hora" aria-label="Valor hora ${esc(c)}"></div>`;
  }).join('');

  // Tabla de los últimos meses (hasta el elegido o el actual)
  const hasta = vMes > mesIsoActual() ? vMes : mesIsoActual();
  const ms = []; for (let i = 5; i >= 0; i--) ms.push(mesMas(hasta, -i));
  const primero = mesesConValores()[0];
  const tabla = categorias.length ? `<div class="pc-vt-wrap"><div class="pc-vt-t">Últimos meses</div><table class="pc-vt">
    <tr><th>$/hora</th>${ms.map(m => { const tiene = Object.keys(valoresTodos[m] || {}).length; return `<th class="${!tiene && primero && m >= primero ? 'falta' : ''}${m === vMes ? ' cur' : ''}"><button type="button" data-vmes="${m}">${mesCorto(m)}</button></th>`; }).join('')}</tr>
    ${categorias.map(c => { const k = sanitizeCatKey(c); return `<tr><td>${esc(c)}</td>${ms.map(m => { const v = (valoresTodos[m] || {})[k]; return `<td class="${v ? '' : 'falta'}${m === vMes ? ' cur' : ''}">${v ? fmtNum(v) : '—'}</td>`; }).join('')}</tr>`; }).join('')}
    </table></div>` : '';

  $('val-box').innerHTML = `
    <div class="pc-dlg-h"><span class="pc-sq sm t-per">${icSvg('dollar')}</span><div><b id="val-t">Valores hora</b><small>Básico de convenio (UOCRA) por categoría</small></div>
      <button type="button" class="pc-qx x" data-cerrar aria-label="Cerrar">${icSvg('x')}</button></div>
    ${!categorias.length ? '<div class="pc-aviso">' + icSvg('alert') + '<span>Primero cargá las categorías.</span></div>' : `
    <div class="pc-mes"><button type="button" class="arr" data-vnav="-1" aria-label="Mes anterior">${icSvg('chevL')}</button><b>${mesLargo(vMes)[0].toUpperCase() + mesLargo(vMes).slice(1)}</b>
      <button type="button" class="arr" data-vnav="1" aria-label="Mes siguiente">${icSvg('chevR')}</button>
      <span class="pc-pm ${cargado ? 't-ok' : 't-red'}">${cargado ? 'Cargado' : 'Sin cargar'}</span></div>
    ${ref ? `<div class="pc-acts" style="margin-top:0"><button type="button" class="foc-btn foc-btn--clear" id="val-copiar">${icSvg('copy')}Copiar de ${mesLargo(ref).slice(0, -5)}</button></div>
    <div class="pc-pct">${icSvg('percent')}Subir todo un <input type="text" inputmode="decimal" id="val-pct" placeholder="0" aria-label="Porcentaje"> % sobre ${mesLargo(ref).slice(0, -5)}
      <button type="button" class="foc-btn foc-btn--edit" id="val-pct-ok">Aplicar</button></div>` : ''}
    ${filas}
    <div class="pc-hint">Se cargan a mano cuando sale la escala (<a href="https://www.uocra.org" target="_blank" rel="noopener">uocra.org</a>). Un mes sin valores usa los del último mes cargado.</div>
    ${tabla}`}
    <div class="pc-dlg-f">
      <button type="button" class="foc-btn foc-btn--clear" data-cerrar>${n ? 'Cancelar' : 'Cerrar'}</button>
      ${categorias.length ? `<button type="button" class="foc-btn foc-btn--save" id="val-save" ${n ? '' : 'disabled'}>${icSvg('checkSm')}Guardar ${mesLargo(vMes).slice(0, -5)}</button>` : ''}
    </div>`;
}

async function valSalir() {
  if (!valCambios().length) return true;
  return showConfirm('Valores sin guardar', `Cambiaste valores de ${mesLargo(vMes)} que no se guardaron. ¿Descartarlos?`,
    { boton: 'Descartar', tono: 'warn', icono: 'undo', cancelar: 'Seguir editando' });
}

async function onValClick(e) {
  if (e.target.closest('[data-cerrar]')) { if (await valSalir()) cerrarModal('hoja-valores'); return; }
  const nav = e.target.closest('[data-vnav]');
  const ir = e.target.closest('[data-vmes]');
  if (nav || ir) {
    if (!(await valSalir())) return;
    vMes = ir ? ir.dataset.vmes : mesMas(vMes, +nav.dataset.vnav);
    cargarMesValores();
    return;
  }
  const ref = mesVigente(mesMas(vMes, -1));
  if (e.target.closest('#val-copiar') && ref) {
    categorias.forEach(c => { const k = sanitizeCatKey(c); const r = valoresTodos[ref][k]; if (r) vDraft[k] = fmtNum(r); });
    renderValores();
    return;
  }
  if (e.target.closest('#val-pct-ok') && ref) {
    const pct = parseNum($('val-pct').value);
    if (isNaN(pct)) { showToast('Poné el porcentaje.', 'warning'); return; }
    categorias.forEach(c => { const k = sanitizeCatKey(c); const r = Number(valoresTodos[ref][k]); if (r) vDraft[k] = fmtNum(Math.round(r * (1 + pct / 100))); });
    renderValores();
    return;
  }
  if (e.target.closest('#val-save')) guardarValores();
}

async function guardarValores() {
  const out = {};
  for (const c of categorias) {
    const k = sanitizeCatKey(c), raw = String(vDraft[k] || '').trim();
    if (!raw) continue;
    const v = parseNum(raw);
    if (isNaN(v) || v < 0) { showToast(`El valor de ${c} no es un número.`, 'warning'); return; }
    if (v > 0) out[k] = v;
  }
  const btn = $('val-save');
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await saveValoresCategorias(vMes, out);
    if (Object.keys(out).length) valoresTodos[vMes] = out; else delete valoresTodos[vMes];
    showToast(`Valores de ${mesLargo(vMes)} guardados.`);
    cargarMesValores();
    renderCabecera();
    renderResumen();
  } catch (_) {
    showToast('No se pudieron guardar los valores.', 'error');
    renderValores();
  }
}

// ───────────── Hoja: feriados ─────────────
let fAnio = null;

function abrirFeriados() {
  const fa = anioFaltaFeriados();
  fAnio = fa || +hoyIso().slice(0, 4);
  renderFeriados();
  abrirModal('hoja-feriados');
}

function filaFeriado(f, { past, prox, extra = '', cls = '', sub = '' } = {}) {
  return `<div class="pc-fer${past ? ' past' : ''}${prox ? ' prox' : ''}${cls}"><span class="d">${fechaCorta(f, false)}<small>${DIAS3[new Date(f + 'T12:00:00').getDay()]}</small></span>
    <div class="tx">${esc(feriados[f] ?? '')}${sub}</div>${extra}</div>`;
}

function renderFeriados() {
  const hoy = hoyIso(), yHoy = +hoy.slice(0, 4);
  const anios = new Set(Object.keys(feriados).map(f => +f.slice(0, 4)));
  anios.add(yHoy); anios.add(yHoy + 1); anios.add(fAnio);
  const cuenta = a => Object.keys(feriados).filter(f => f.startsWith(a + '-')).length;
  const lista = Object.keys(feriados).filter(f => f.startsWith(fAnio + '-')).sort();
  const prox = proximoFeriado();
  const falta = anioFaltaFeriados();
  $('fer-box').innerHTML = `
    <div class="pc-dlg-h"><span class="pc-sq sm">${icSvg('calendar')}</span><div><b id="fer-t">Feriados</b><small>Los partes los toman como día no laborable</small></div>
      <button type="button" class="pc-qx x" data-cerrar aria-label="Cerrar">${icSvg('x')}</button></div>
    <div class="pc-yr">${[...anios].sort().map(a => `<button type="button" data-anio="${a}" class="${a === fAnio ? 'on' : ''}${!cuenta(a) && a >= yHoy ? ' red' : ''}">${a} · ${cuenta(a) || 'ninguno'}</button>`).join('')}</div>
    <div class="pc-flist">${lista.length ? lista.map(f => filaFeriado(f, { past: f < hoy, prox: f === prox,
      extra: `<button type="button" class="pc-qx" data-quitar="${f}" aria-label="Quitar">${icSvg('x')}</button>` })).join('')
      : `<div class="pc-empty" style="padding:.8rem">No hay feriados de ${fAnio} cargados.</div>`}</div>
    ${falta === fAnio ? `<div class="pc-aviso">${icSvg('calendar')}<span>Faltan los feriados de ${fAnio}: sin ellos los partes los toman como días hábiles.</span></div>` : ''}
    <div class="pc-acts"><button type="button" class="foc-btn foc-btn--edit" id="fer-traer">${icSvg('download')}Traer feriados nacionales ${fAnio}</button></div>
    <div class="pc-addf"><input type="date" id="fer-fecha" class="form-control" aria-label="Fecha">
      <input type="text" id="fer-nombre" class="form-control" placeholder="Otro día no laborable (ej: puente)" aria-label="Nombre">
      <button type="button" class="foc-btn foc-btn--clear" id="fer-add">${icSvg('plus')}Agregar</button></div>`;
}

async function addFeriado() {
  const fecha = $('fer-fecha').value, nombre = $('fer-nombre').value.trim();
  if (!fecha)  { showToast('Elegí una fecha.', 'warning'); return; }
  if (!nombre) { showToast('Poné el nombre del feriado.', 'warning'); return; }
  if (feriados[fecha] && feriados[fecha] !== nombre) {
    const ok = await showConfirm('Ya hay un feriado ese día', `El ${fecha.split('-').reverse().join('/')} ya está cargado como «${feriados[fecha]}». ¿Reemplazarlo por «${nombre}»?`,
      { boton: 'Reemplazar', tono: 'warn', icono: 'calendar' });
    if (!ok) return;
  }
  const antes = { ...feriados };
  feriados[fecha] = nombre;
  fAnio = +fecha.slice(0, 4);
  try { await saveFeriados(feriados); showToast('Feriado agregado.'); }
  catch (_) { feriados = antes; showToast('No se pudo guardar.', 'error'); }
  renderFeriados(); renderCabecera(); renderResumen();
}

async function quitarFeriado(fecha) {
  const ok = await showConfirm('Quitar feriado', `¿Quitar «${feriados[fecha]}» del ${fecha.split('-').reverse().join('/')}?`, { boton: 'Quitar', tono: 'del', icono: 'trash' });
  if (!ok) return;
  const antes = { ...feriados };
  delete feriados[fecha];
  try { await saveFeriados(feriados); showToast('Feriado quitado.'); }
  catch (_) { feriados = antes; showToast('No se pudo guardar.', 'error'); }
  renderFeriados(); renderCabecera(); renderResumen();
}

async function onFerClick(e) {
  if (e.target.closest('[data-cerrar]')) { cerrarModal('hoja-feriados'); return; }
  const a = e.target.closest('[data-anio]');
  if (a) { fAnio = +a.dataset.anio; renderFeriados(); return; }
  const q = e.target.closest('[data-quitar]');
  if (q) { quitarFeriado(q.dataset.quitar); return; }
  if (e.target.closest('#fer-add')) { addFeriado(); return; }
  if (e.target.closest('#fer-traer')) traerFeriados(fAnio);
}

// Feriados nacionales de argentinadatos.com (pública, sin clave). Los que ya
// están cargados ese día no se tocan.
let traidos = [];
async function traerFeriados(anio) {
  const btn = $('fer-traer');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Buscando…';
  try {
    const r = await fetch(FERIADOS_API + anio, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    traidos = (Array.isArray(data) ? data : [])
      .filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && x.nombre)
      .map(x => ({ fecha: x.fecha, nombre: x.nombre, tipo: x.tipo || '', ya: !!feriados[x.fecha], on: !feriados[x.fecha] }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (!traidos.length) { showToast(`Todavía no hay feriados publicados para ${anio}. Cargalos a mano.`, 'warning'); return; }
    renderTraer(anio);
    abrirModal('modal-traer');
  } catch (_) {
    showToast('No se pudo traer la lista. Probá más tarde o cargalos a mano.', 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = icSvg('download') + 'Traer feriados nacionales ' + anio;
  }
}

function renderTraer(anio) {
  const n = traidos.filter(t => t.on && !t.ya).length;
  const ya = traidos.filter(t => t.ya).length;
  $('traer-box').innerHTML = `
    <div class="pc-dlg-h"><span class="pc-sq sm t-ok">${icSvg('download')}</span><div><b id="traer-t">Feriados nacionales ${anio}</b><small>${traidos.length} encontrados · argentinadatos.com${ya ? ` · ${ya} ya cargados` : ''}</small></div></div>
    <div class="pc-flist">${traidos.map((t, i) => {
      const d = new Date(t.fecha + 'T12:00:00');
      return `<label class="pc-fer ${t.ya ? 'ya' : 'nuevo'}"><span class="d">${d.getDate()} ${MES3[d.getMonth()]}<small>${DIAS3[d.getDay()]}</small></span>
        <span class="tx">${esc(t.nombre)}${t.ya ? '<small>Ya está cargado</small>' : /trasladable/i.test(t.tipo) ? '<small>Trasladable: puede moverse por decreto</small>' : ''}</span>
        <span class="pc-sw ok"><input type="checkbox" data-t="${i}" ${t.on && !t.ya ? 'checked' : ''} ${t.ya ? 'disabled' : ''}><span></span></span></label>`;
    }).join('')}</div>
    <div class="pc-hint">Los días no laborables con fines turísticos (puentes) no vienen: si la empresa los da, se agregan a mano.</div>
    <div class="pc-dlg-f">
      <button type="button" class="foc-btn foc-btn--clear" id="traer-cancel">Cancelar</button>
      <button type="button" class="foc-btn foc-btn--gen" id="traer-ok" data-anio="${anio}" ${n ? '' : 'disabled'}>${icSvg('checkSm')}${n ? `Agregar ${n} ${n === 1 ? 'feriado' : 'feriados'}` : 'Nada para agregar'}</button>
    </div>`;
}

async function agregarTraidos(anio) {
  const nuevos = traidos.filter(t => t.on && !t.ya);
  if (!nuevos.length) return;
  const antes = { ...feriados };
  nuevos.forEach(t => { feriados[t.fecha] = t.nombre; });
  $('traer-ok').disabled = true;
  try {
    await saveFeriados(feriados);
    showToast(`${nuevos.length} feriados de ${anio} agregados.`);
    cerrarModal('modal-traer');
  } catch (_) {
    feriados = antes;
    showToast('No se pudieron guardar.', 'error');
    $('traer-ok').disabled = false;
  }
  fAnio = +anio;
  renderFeriados(); renderCabecera(); renderResumen();
}

// ───────────── Hoja: categorías ─────────────
let catEdit = -1;   // índice de la que se está renombrando

function abrirCats() { catEdit = -1; renderCats(); abrirModal('hoja-cats'); }

function renderCats() {
  const vig = mesVigente(mesIsoActual());
  $('cat-box').innerHTML = `
    <div class="pc-dlg-h"><span class="pc-sq sm">${icSvg('layers')}</span><div><b id="cat-t">Categorías</b><small>El orden es la jerarquía: así se ordenan las cuadrillas y las planillas</small></div>
      <button type="button" class="pc-qx x" data-cerrar aria-label="Cerrar">${icSvg('x')}</button></div>
    <div>${categorias.length ? categorias.map((c, i) => {
      const n = genteDe(c), v = vig ? valoresTodos[vig][sanitizeCatKey(c)] : null;
      return `<div class="pc-cat"><div class="ord"><button type="button" data-mover="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="Subir">${icSvg('arrowUp')}</button><button type="button" data-mover="${i}" data-d="1" ${i < categorias.length - 1 ? '' : 'disabled'} aria-label="Bajar">${icSvg('arrowDown')}</button></div>
        <span class="n">${i + 1}</span>
        <div class="tx">${catEdit === i ? `<input type="text" class="form-control" id="cat-ren" value="${esc(c)}" aria-label="Nuevo nombre">` : `<b>${esc(c)}</b><small>${n ? `${n} ${n === 1 ? 'persona' : 'personas'}` : 'Nadie activo todavía'}</small>`}</div>
        ${catEdit === i ? `<button type="button" class="foc-btn foc-btn--save" id="cat-ren-ok" style="padding:.4rem .7rem">${icSvg('checkSm')}</button>`
          : `${v ? `<div class="vh"><b>${fmtPesos(v)}</b>${mesCorto(vig)}</div>` : ''}<button type="button" class="pc-mini" data-ren="${i}" title="Renombrar" aria-label="Renombrar">${icSvg('edit')}</button><button type="button" class="pc-qx" data-quitarc="${i}" aria-label="Quitar">${icSvg('x')}</button>`}</div>`;
    }).join('') : '<div class="pc-empty" style="padding:.8rem">Sin categorías. Agregá la primera.</div>'}</div>
    <div class="pc-addc"><input type="text" id="cat-input" class="form-control" placeholder="Nueva categoría, ej: Oficial"><button type="button" class="foc-btn foc-btn--clear" id="cat-add">${icSvg('plus')}Agregar</button></div>
    <div class="pc-dlg-f"><button type="button" class="foc-btn foc-btn--clear" data-cerrar>Cerrar</button></div>`;
  if (catEdit >= 0) { const i = $('cat-ren'); i.focus(); i.select(); }
}

async function guardarCategorias(msg) {
  try { await saveCategoriasPersonal(categorias); if (msg) showToast(msg); }
  catch (_) { showToast('No se pudo guardar.', 'error'); }
  renderCats(); renderResumen();
  if (selId) renderFicha();
}

async function addCategoria() {
  const val = $('cat-input').value.trim();
  if (!val) return;
  if (categorias.some(c => c.toLowerCase() === val.toLowerCase())) { showToast('Esa categoría ya existe.', 'warning'); return; }
  categorias.push(val);
  await guardarCategorias('Categoría agregada.');
  setTimeout(() => $('cat-input')?.focus(), 30);
}

async function moverCategoria(i, d) {
  const j = i + d;
  if (j < 0 || j >= categorias.length) return;
  [categorias[i], categorias[j]] = [categorias[j], categorias[i]];
  await guardarCategorias();
}

async function quitarCategoria(i) {
  const c = categorias[i], n = genteDe(c);
  const ok = await showConfirm('Quitar categoría',
    n ? `${n} ${n === 1 ? 'persona tiene' : 'personas tienen'} «${c}»: siguen con ese nombre en las planillas hasta que les cambies la categoría, y su monto se calcula sin valor hora. ¿Quitarla igual?`
      : `¿Quitar la categoría «${c}»?`,
    { boton: 'Quitar', tono: 'del', icono: 'trash' });
  if (!ok) return;
  categorias.splice(i, 1);
  await guardarCategorias('Categoría quitada.');
}

// Renombrar pasa al nombre nuevo a la gente que la tenía y los valores hora de
// todos los meses (se guardan por nombre).
async function renombrarCategoria() {
  const i = catEdit, viejo = categorias[i];
  const nuevo = ($('cat-ren')?.value || '').trim();
  if (!nuevo || nuevo === viejo) { catEdit = -1; renderCats(); return; }
  if (categorias.some((c, j) => j !== i && c.toLowerCase() === nuevo.toLowerCase())) { showToast('Ya hay una categoría con ese nombre.', 'warning'); return; }
  const gente = allPersonal.filter(p => p.categoria === viejo);
  const kv = sanitizeCatKey(viejo), kn = sanitizeCatKey(nuevo);
  const meses = Object.keys(valoresTodos).filter(m => valoresTodos[m] && valoresTodos[m][kv] != null);
  if (gente.length || meses.length) {
    const partes = [];
    if (gente.length) { const inact = gente.filter(p => p.activo === false).length; partes.push(`${gente.length} ${gente.length === 1 ? 'persona' : 'personas'}${inact ? ` (${inact} inactiva${inact === 1 ? '' : 's'})` : ''}`); }
    if (meses.length) partes.push(`los valores hora de ${meses.length} ${meses.length === 1 ? 'mes' : 'meses'}`);
    const ok = await showConfirm('Renombrar categoría', `«${viejo}» pasa a llamarse «${nuevo}». Se pasan ${listaY(partes)}. Los partes y planillas ya generados no cambian.`,
      { boton: 'Renombrar', tono: 'ok', icono: 'edit' });
    if (!ok) return;
  }
  const btn = $('cat-ren-ok'); if (btn) btn.disabled = true;
  try {
    categorias[i] = nuevo;
    await saveCategoriasPersonal(categorias);
    for (const m of meses) {
      const vals = { ...valoresTodos[m] };
      if (kn !== kv) { vals[kn] = vals[kv]; delete vals[kv]; }
      await saveValoresCategorias(m, vals);
      valoresTodos[m] = vals;
    }
    for (const p of gente) await patchPersonal(p.id, { categoria: nuevo });
    gente.forEach(p => { p.categoria = nuevo; });
    if (orig && orig.categoria === viejo) { orig.categoria = nuevo; if (draft.categoria === viejo) draft.categoria = nuevo; }
    showToast('Categoría renombrada.');
  } catch (_) {
    showToast('No se pudo terminar de renombrar. Revisá la categoría de la gente y los valores.', 'error');
    await cargarConfig();
  }
  catEdit = -1;
  renderCats(); renderTodo();
  if (selId) renderFicha();
}

async function onCatClick(e) {
  if (e.target.closest('[data-cerrar]')) { cerrarModal('hoja-cats'); return; }
  const m = e.target.closest('[data-mover]');
  if (m) { moverCategoria(+m.dataset.mover, +m.dataset.d); return; }
  const r = e.target.closest('[data-ren]');
  if (r) { catEdit = +r.dataset.ren; renderCats(); return; }
  if (e.target.closest('#cat-ren-ok')) { renombrarCategoria(); return; }
  const q = e.target.closest('[data-quitarc]');
  if (q) { quitarCategoria(+q.dataset.quitarc); return; }
  if (e.target.closest('#cat-add')) addCategoria();
}

// ───────────── Carga ─────────────
async function cargarConfig() {
  try {
    [categorias, feriados, valoresTodos] = await Promise.all([getCategoriasPersonal(), getFeriados(), getValoresCategoriasTodos()]);
  } catch (_) {
    showToast('Error al cargar la configuración.', 'error');
  }
}

async function cargarPadron(abrir, { conservar = false } = {}) {
  try {
    const [personal, obras] = await Promise.all([getPersonal(), getAllObras()]);
    allPersonal = personal;
    obrasMap = {};
    obras.forEach(o => { obrasMap[o.key] = o.nombre; });
  } catch (_) {
    $('pc-list').innerHTML = '<div class="pc-rows"><div class="pc-empty">Error al cargar el padrón.</div></div>';
    return;
  }
  const p = allPersonal.find(x => x.id === abrir);
  selId = p ? abrir : null;
  if (p && !(conservar && draft)) { orig = estadoDe(p); draft = { ...orig }; }
  else if (p && conservar) { orig = estadoDe(p); }
  else if (!p) { orig = draft = null; }
  renderTodo();
  renderFicha();
  if (p && abrir && !MQ_ANCHA.matches && !document.body.classList.contains('pc-open')) mostrarFicha(true, true);
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  if (_s.codigo !== '0000') { window.location.href = 'menu.html'; return; }
  $('hdr-name').textContent = _s.nombre;

  $('btn-back').addEventListener('click', () => {
    if (!MQ_ANCHA.matches && document.body.classList.contains('pc-open')) { history.back(); return; }
    window.location.href = 'administracion.html';
  });
  // Atrás en el teléfono: de la ficha a la lista (preguntando si hay cambios).
  window.addEventListener('popstate', async () => {
    const k = new URLSearchParams(location.search).get('p');
    if (k) { abrirFicha(k, { push: false }); return; }
    if (hayCambios()) {
      if (!(await descartar())) { history.pushState({ p: selId }, '', '?p=' + encodeURIComponent(selId)); return; }
      deshacer();
    }
    mostrarFicha(false);
    if (!MQ_ANCHA.matches) { selId = null; orig = draft = null; limpiarFotos(); renderLista(); renderFicha(); }
  });
  window.addEventListener('beforeunload', e => {
    if (hayCambios() || (!$('hoja-valores').classList.contains('hidden') && valCambios().length)) { e.preventDefault(); e.returnValue = ''; }
  });

  // Resumen y pendientes → hojas
  document.querySelector('.pc-page').addEventListener('click', e => {
    const h = e.target.closest('[data-hoja]');
    if (h) abrirHoja(h.dataset.hoja);
  });

  // Padrón
  $('pc-list').addEventListener('click', e => { const r = e.target.closest('.pc-row'); if (r) abrirFicha(r.dataset.id); });
  $('pc-flt').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { filtro = b.dataset.f; renderFiltros(); renderLista(); } });
  $('pc-q').addEventListener('input', renderLista);
  const ficha = $('pc-ficha');
  ficha.addEventListener('input', onFichaInput);
  ficha.addEventListener('change', onFichaChange);
  ficha.addEventListener('click', onFichaClick);
  ficha.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); e.target.blur(); } });
  $('pc-foto-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f || !ladoFoto || !draft) return;
    if (fotos[ladoFoto]) URL.revokeObjectURL(fotos[ladoFoto]._url);
    f._url = URL.createObjectURL(f);
    fotos[ladoFoto] = f;
    renderFicha();
  });
  $('pc-undo').addEventListener('click', deshacer);
  $('pc-save').innerHTML = icSvg('checkSm') + 'Guardar';
  $('pc-save').addEventListener('click', guardarFicha);
  $('foto-close').innerHTML = icSvg('x');
  $('foto-close').addEventListener('click', () => cerrarModal('modal-foto'));
  $('modal-foto').addEventListener('click', e => { if (e.target.id === 'modal-foto') cerrarModal('modal-foto'); });

  // Alta
  $('alta-ic').innerHTML = icSvg('userPlus');
  $('alta-save').innerHTML = icSvg('checkSm') + 'Agregar y abrir ficha';
  $('pc-add').addEventListener('click', openAlta);
  $('alta-cancel').addEventListener('click', () => cerrarModal('modal-alta'));
  $('alta-save').addEventListener('click', saveAlta);
  $('alta-dni').addEventListener('input', () => { $('alta-dup').innerHTML = dupHtml($('alta-dni').value, null); });
  ['alta-apellido', 'alta-nombre', 'alta-dni'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') saveAlta(); }));

  // Hojas
  $('val-box').addEventListener('click', onValClick);
  $('val-box').addEventListener('input', e => {
    const k = e.target.dataset.vk;
    if (k == null) return;
    vDraft[k] = e.target.value;
    e.target.classList.toggle('chg', valCambios().includes(k));
    const sub = $('val-box').querySelector(`[data-vsub="${CSS.escape(k)}"]`);
    if (sub) sub.textContent = subValor(k);
    const n = valCambios().length, b = $('val-save');
    if (b) b.disabled = !n;
    const c = $('val-box').querySelector('[data-cerrar].foc-btn');
    if (c) c.textContent = n ? 'Cancelar' : 'Cerrar';
  });
  $('val-box').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'val-pct') $('val-pct-ok').click(); });
  $('fer-box').addEventListener('click', onFerClick);
  $('fer-box').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'fer-nombre') addFeriado(); });
  $('traer-box').addEventListener('click', e => {
    if (e.target.closest('#traer-cancel')) { cerrarModal('modal-traer'); return; }
    const ok = e.target.closest('#traer-ok');
    if (ok) agregarTraidos(ok.dataset.anio);
  });
  $('traer-box').addEventListener('change', e => {
    const i = e.target.dataset.t;
    if (i == null) return;
    traidos[+i].on = e.target.checked;
    renderTraer($('traer-ok').dataset.anio);
  });
  $('cat-box').addEventListener('click', onCatClick);
  $('cat-box').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'cat-input') addCategoria();
    else if (e.key === 'Enter' && e.target.id === 'cat-ren') renombrarCategoria();
    else if (e.key === 'Escape' && e.target.id === 'cat-ren') { e.stopPropagation(); catEdit = -1; renderCats(); }
  });

  const inicial = new URLSearchParams(location.search).get('p');
  if (inicial) history.replaceState(null, '', location.pathname);
  await cargarConfig();
  renderCabecera();
  renderResumen();
  cargarPadron(inicial);
});

