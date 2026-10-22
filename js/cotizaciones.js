/* VIMECO S.A. — Cotizaciones: varios presupuestos del mismo pedido, comparados
   renglón por renglón. Cada presupuesto se lee al subirlo (extractFromFile, la
   misma lectura que precarga la OC); «Comparar» hace una sola llamada al modelo
   grande (compararPresupuestos) que sólo empareja y lee condiciones; las cuentas
   salen de cotizacionCalc.js. Del presupuesto elegido sale la OC precargada. */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const MAX_PRESUS = 6;
const pad2 = n => String(n).padStart(2, '0');
const fmtFecha = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
const fechaISO = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtPesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDoc = (n, usd) => (usd ? 'US$ ' : '$ ') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCant = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });
const fmtPct = n => (n > 0 ? '+' : '') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

// ─── Estado ─────────────────────────────────────────────
const S = {
  code: '', nombre: '', admin: false,
  obras: [], obrasListas: null,
  lista: [],
  cot: null,            // la comparativa abierta
  locales: {},          // pid → { nombre, estado: 'subiendo'|'leyendo'|'error', error, file } mientras se sube
  files: {},            // pid → File ya bajado o recién subido (no volver a bajarlo para comparar)
  comparando: false,
  celSel: null,         // celda tocada del cuadro: 'fila:pid'
  empujado: false,
  tc: null,
};

const presusDe = cot => Object.entries(cot?.presupuestos || {})
  .map(([pid, p]) => ({ ...p, pid }))
  .sort((a, b) => (a.ts || 0) - (b.ts || 0));
const leidos = cot => presusDe(cot).filter(p => p.estado === 'leido' && p.lectura);
const nombrePresu = p => p.lectura?.proveedor || p.nombre || 'Presupuesto';
const puedeBorrar = cot => S.admin || cot?.creadoPor?.codigo === S.code;

// La comparación guardada sirve mientras estén todos sus presupuestos; si se
// sumó uno, se muestra igual con el aviso de volver a comparar.
function estadoComparacion(cot) {
  const c = cot?.comparacion;
  if (!c || !Array.isArray(c.pids)) return 'sin';
  const ids = leidos(cot).map(p => p.pid);
  if (c.pids.some(pid => !ids.includes(pid))) return 'rota';
  return ids.length === c.pids.length ? 'ok' : 'vieja';
}

function cuadroDe(cot) {
  const c = cot.comparacion;
  const lecturas = c.pids.map(pid => cot.presupuestos[pid].lectura);
  // RTDB no guarda nulls ni objetos vacíos: se rearma lo que el cálculo espera.
  const comp = {
    pids: c.pids,
    presupuestos: c.presupuestos || {},
    renglones: (c.renglones || []).map(r => ({ ...r, items: r.items || {} })),
    avisos: c.avisos || []
  };
  lecturas.forEach(l => { l.items = l.items || []; });
  return { comp, q: armarCuadro(comp, lecturas, { tc: S.tc, cantidades: cot.cantidades || {} }) };
}

// ─── Lista ──────────────────────────────────────────────
function pillsEstado(cot) {
  const n = leidos(cot).length;
  if (cot.estado === 'cerrada')
    return `<span class="ct-pill ct-pill--ok">${icSvg('check')}OC ${esc(cot.oc?.nroOC || '')}</span>`;
  if (n < 2) return `<span class="ct-pill ct-pill--amb">${icSvg('clock')}${n ? 'Falta al menos otro' : 'Sin presupuestos'}</span>`;
  const e = estadoComparacion(cot);
  if (e !== 'ok') return `<span class="ct-pill">${icSvg('sparkles')}Para comparar</span>`;
  let mejor = '';
  try {
    const { q } = cuadroDe(cot);
    const cta = q.justa || q.amplia;
    if (cta?.mejor) mejor = `<span class="ct-pill ct-pill--gr">Más barato: ${esc(nombrePresu(cot.presupuestos[cta.mejor]))}</span>`;
  } catch (_) {}
  return `<span class="ct-pill ct-pill--ok">${icSvg('check')}Comparada</span>${mejor}`;
}

function tarjeta(cot) {
  const n = presusDe(cot).length;
  const cerrada = cot.estado === 'cerrada';
  return `<button type="button" class="ct-box ct-card" data-id="${esc(cot.id)}">
    <span class="ct-sq${cerrada ? ' ct-sq--ok' : ''}">${icSvg(cerrada ? 'check' : 'layers')}</span>
    <span style="min-width:0;flex:1">
      <span class="ct-card-t">${esc(cot.titulo)}</span>
      <span class="ct-sub" style="display:block">${esc(cot.obra)} · ${n} ${n === 1 ? 'presupuesto' : 'presupuestos'} · ${esc(cot.creadoPor?.nombre || '')} ${fmtFecha(cot.ts)}</span>
      <span class="ct-card-p">${pillsEstado(cot)}</span>
    </span>
  </button>`;
}

function pintarLista() {
  const abiertas = S.lista.filter(c => c.estado !== 'cerrada');
  const cerradas = S.lista.filter(c => c.estado === 'cerrada');
  const pill = $('n-abiertas');
  pill.textContent = `${abiertas.length} ${abiertas.length === 1 ? 'abierta' : 'abiertas'}`;
  pill.classList.toggle('hidden', !abiertas.length);
  if (!S.lista.length) {
    $('lista').innerHTML = `<div class="ct-box ct-vacio">Todavía no hay comparativas.<br>Tocá <b>Nueva comparativa</b>, elegí la obra y subí dos o más presupuestos del mismo pedido.</div>`;
    return;
  }
  $('lista').innerHTML =
    (abiertas.length ? `<div class="ct-h">Abiertas</div><div class="ct-lista">${abiertas.map(tarjeta).join('')}</div>` : '') +
    (cerradas.length ? `<div class="ct-h">Cerradas</div><div class="ct-lista">${cerradas.map(tarjeta).join('')}</div>` : '');
}

async function cargarLista() {
  try {
    S.lista = await getCotizaciones();
  } catch (e) {
    console.warn('getCotizaciones:', e);
    $('lista').innerHTML = '<div class="ct-box ct-vacio">No se pudieron cargar las comparativas. <button type="button" class="ct-btn" onclick="location.reload()">Reintentar</button></div>';
    return;
  }
  pintarLista();
}

// ─── Nueva ──────────────────────────────────────────────
async function abrirNueva() {
  if (!S.obras.length) await S.obrasListas;
  $('n-obra').innerHTML = '<option value="">Elegí la obra</option>' +
    S.obras.map(o => `<option>${esc(o.nombre)}</option>`).join('');
  $('n-titulo').value = '';
  $('modal-nueva').classList.remove('hidden');
  setTimeout(() => $('n-obra').focus(), 50);
}
const cerrarNueva = () => $('modal-nueva').classList.add('hidden');

async function crearNueva() {
  const obra = $('n-obra').value.trim();
  const titulo = $('n-titulo').value.trim();
  if (!obra || !titulo) {
    toast(!obra ? 'Elegí la obra.' : 'Escribí qué se está cotizando.', 'warning');
    (!obra ? $('n-obra') : $('n-titulo')).focus();
    return;
  }
  const btn = $('nueva-crear');
  btn.disabled = true;
  const data = { titulo, obra, creadoPor: { codigo: S.code, nombre: S.nombre }, ts: Date.now(), estado: 'abierta' };
  try {
    const id = await crearCotizacion(data);
    S.lista.unshift({ ...data, id });
    cerrarNueva();
    abrirDetalle(id, { push: true });
  } catch (e) {
    console.warn('crearCotizacion:', e);
    toast('No se pudo crear la comparativa. Revisá la conexión.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── Detalle ────────────────────────────────────────────
async function abrirDetalle(id, { push } = {}) {
  S.cot = S.lista.find(c => c.id === id) || null;
  S.locales = {};
  S.celSel = null;
  $('vista-lista').classList.add('hidden');
  $('vista-det').classList.remove('hidden');
  if (push) { history.pushState({ c: id }, '', '?c=' + encodeURIComponent(id)); S.empujado = true; }
  window.scrollTo(0, 0);
  if (S.cot) pintarDetalle();
  else $('res').innerHTML = '<div class="ct-carga"><span class="spinner"></span>Cargando…</div>';
  try {
    const fresca = await getCotizacion(id);
    if (!fresca) { toast('Esa comparativa ya no existe.', 'warning'); volverALista(); return; }
    S.cot = fresca;
    reemplazarEnLista(fresca);
  } catch (e) {
    console.warn('getCotizacion:', e);
    if (!S.cot) { toast('No se pudo abrir la comparativa.', 'error'); volverALista(); return; }
  }
  if (leidos(S.cot).length && !S.tc && Object.values(S.cot.comparacion?.presupuestos || {}).some(p => p.moneda === 'USD')) {
    S.tc = await dolarOficial();
  }
  pintarDetalle();
}

async function dolarOficial() {
  try {
    const d = (typeof getDolarCached === 'function' && getDolarCached()) || await getDolarSnapshot();
    return d?.oficial?.venta || null;
  } catch (_) { return null; }
}

function reemplazarEnLista(cot) {
  const i = S.lista.findIndex(c => c.id === cot.id);
  if (i >= 0) S.lista[i] = cot; else S.lista.unshift(cot);
}

function volverALista() {
  S.cot = null;
  $('vista-det').classList.add('hidden');
  $('vista-lista').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
  S.empujado = false;
  pintarLista();
}

function pintarDetalle() {
  const cot = S.cot;
  $('det-titulo').textContent = cot.titulo;
  $('det-pills').innerHTML = `<span class="ct-pill">${icSvg('building')}${esc(cot.obra)}</span>` +
    `<span class="ct-pill ct-pill--gr">${esc(cot.creadoPor?.nombre || '')} · ${fmtFecha(cot.ts)}</span>` +
    (cot.estado === 'cerrada' ? `<span class="ct-pill ct-pill--ok">${icSvg('check')}OC ${esc(cot.oc?.nroOC || '')}</span>` : '');
  $('btn-borrar').classList.toggle('hidden', !puedeBorrar(cot));
  pintarPresus();
  pintarResultado();
}

function pintarPresus() {
  const cot = S.cot;
  const guardados = presusDe(cot);
  const locales = Object.entries(S.locales).filter(([pid]) => !cot.presupuestos?.[pid] || S.locales[pid].estado === 'leyendo');
  const filas = [];

  for (const p of guardados) {
    if (S.locales[p.pid]?.estado === 'leyendo') continue;
    const r = p.lectura;
    const n = r?.items?.length || 0;
    const sub = p.estado === 'leido'
      ? `${n} ${n === 1 ? 'renglón' : 'renglones'}${r.total_documento ? ' · ' + fmtPesos(r.total_documento) + (r.precios_incluyen_iva ? ' con IVA' : '') : ''}`
      : esc(p.error || 'No se pudo leer');
    const pill = p.estado === 'leido' ? '' : `<button type="button" class="ct-btn ct-btn--del" data-releer="${esc(p.pid)}" style="padding:.3rem .6rem;font-size:.76rem">Leer de nuevo</button>`;
    filas.push(`<div class="ct-pr">
      <span class="ct-sq">${icSvg('store')}</span>
      <div class="ct-pr-x"><div class="ct-pr-t">${esc(nombrePresu(p))}</div><div class="ct-sub">${sub}</div></div>
      ${pill}
      <span class="ct-pr-acc">
        ${p.fileId ? `<a href="https://drive.google.com/file/d/${encodeURIComponent(p.fileId)}/view" target="_blank" rel="noopener" aria-label="Ver el archivo" title="Ver el archivo">${icSvg('eye')}</a>` : ''}
        <button type="button" data-quitar="${esc(p.pid)}" aria-label="Quitar este presupuesto" title="Quitar">${icSvg('x')}</button>
      </span>
    </div>`);
  }
  for (const [pid, l] of locales) {
    const txt = { subiendo: 'Subiendo y leyendo…', leyendo: 'Leyendo con IA…', error: l.error || 'No se pudo subir' }[l.estado];
    filas.push(`<div class="ct-pr">
      <span class="ct-sq">${l.estado === 'error' ? icSvg('alert') : '<span class="spinner"></span>'}</span>
      <div class="ct-pr-x"><div class="ct-pr-t">${esc(l.nombre)}</div><div class="ct-sub">${esc(txt)}</div></div>
      ${l.estado === 'error' ? `<span class="ct-pr-acc"><button type="button" data-reintentar="${esc(pid)}" aria-label="Reintentar" title="Reintentar">${icSvg('rotate')}</button><button type="button" data-descartar="${esc(pid)}" aria-label="Descartar" title="Descartar">${icSvg('x')}</button></span>` : ''}
    </div>`);
  }
  $('presus').innerHTML = filas.join('');

  const nLeidos = leidos(cot).length;
  const ocupado = locales.some(([, l]) => l.estado !== 'error');
  const est = estadoComparacion(cot);
  const btn = $('btn-comparar');
  btn.disabled = S.comparando || ocupado || nLeidos < 2;
  $('btn-comparar-txt').textContent = S.comparando ? 'Comparando…' : est === 'ok' ? 'Volver a comparar' : `Comparar ${nLeidos >= 2 ? 'los ' + nLeidos : ''}`.trim();
  $('cmp-nota').textContent = nLeidos < 2 ? 'Hacen falta al menos dos presupuestos leídos.'
    : ocupado ? 'Esperá a que termine de leer.' : '';
  $('drop').classList.toggle('hidden', guardados.length + locales.length >= MAX_PRESUS);
}

// ─── Subir y leer ───────────────────────────────────────
const nuevoPid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const archivoOk = f => /\.(jpe?g|png|webp|pdf)$/i.test(f.name) || ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type);

async function agregarArchivos(files) {
  const cot = S.cot;
  if (!cot) return;
  let lugar = MAX_PRESUS - presusDe(cot).length - Object.keys(S.locales).filter(pid => !cot.presupuestos?.[pid]).length;
  for (const f of files) {
    if (!archivoOk(f)) { toast(`${f.name}: usá PDF, JPG, PNG o WEBP.`, 'error'); continue; }
    if (lugar <= 0) { toast(`Hasta ${MAX_PRESUS} presupuestos por comparativa.`, 'warning'); break; }
    lugar--;
    const pid = nuevoPid();
    S.locales[pid] = { nombre: f.name, estado: 'subiendo', file: f };
    subirYLeer(cot.id, pid);
  }
  pintarPresus();
}

async function subirYLeer(cotId, pid) {
  const l = S.locales[pid];
  const cot = S.lista.find(c => c.id === cotId) || S.cot;
  l.estado = 'subiendo'; l.error = null;
  if (S.cot?.id === cotId) pintarPresus();

  const subida = uploadCotizacionArchivo(l.file, { obra: cot.obra, carpeta: `${fechaISO(cot.ts)} ${cot.titulo}` })
    .then(r => ({ ok: true, ...r }), e => ({ ok: false, e }));
  const lectura = extractFromFile(l.file).then(r => ({ ok: true, r }), e => ({ ok: false, e }));
  const [up, lec] = await Promise.all([subida, lectura]);

  if (!up.ok || !up.fileId) {
    console.warn('uploadCotizacionArchivo:', up.e);
    l.estado = 'error'; l.error = 'No se pudo guardar en Drive. Reintentá.';
    if (S.cot?.id === cotId) pintarPresus();
    return;
  }
  const p = {
    nombre: l.file.name, fileId: up.fileId, mime: l.file.type || '', size: l.file.size || 0,
    ts: Date.now(), subidoPor: { codigo: S.code, nombre: S.nombre },
    estado: lec.ok ? 'leido' : 'error',
    ...(lec.ok ? { lectura: lec.r } : { error: lec.e?.message || 'No se pudo leer' })
  };
  try {
    await patchCotizacion(cotId, p, 'presupuestos/' + pid);
  } catch (e) {
    console.warn('patchCotizacion:', e);
    l.estado = 'error'; l.error = 'No se pudo guardar. Revisá la conexión y reintentá.';
    if (S.cot?.id === cotId) pintarPresus();
    return;
  }
  S.files[pid] = l.file;
  delete S.locales[pid];
  cot.presupuestos = { ...(cot.presupuestos || {}), [pid]: p };
  if (!lec.ok) toast(`${l.file.name}: ${p.error}`, 'error');
  if (S.cot?.id === cotId) { pintarPresus(); pintarResultado(); }
}

async function archivoDe(p) {
  if (S.files[p.pid]) return S.files[p.pid];
  const r = await bajarDriveArchivo(p.fileId);
  if (!r.blob) throw new Error('El archivo no se puede bajar de Drive.');
  const f = new File([r.blob], r.nombre || p.nombre || 'presupuesto', { type: r.mime || p.mime || r.blob.type });
  S.files[p.pid] = f;
  return f;
}

async function releer(pid) {
  const cot = S.cot;
  const p = cot.presupuestos[pid];
  S.locales[pid] = { nombre: p.nombre, estado: 'leyendo' };
  pintarPresus();
  try {
    const r = await extractFromFile(await archivoDe({ ...p, pid }));
    const cambios = { estado: 'leido', lectura: r, error: null };
    await patchCotizacion(cot.id, cambios, 'presupuestos/' + pid);
    Object.assign(p, cambios);
    delete p.error;
  } catch (e) {
    toast(`No se pudo leer: ${e.message}`, 'error');
  }
  delete S.locales[pid];
  if (S.cot === cot) { pintarPresus(); pintarResultado(); }
}

async function quitar(pid) {
  const cot = S.cot;
  const p = cot.presupuestos[pid];
  const ok = await showConfirm('Quitar presupuesto', `Se saca «${nombrePresu(p)}» de esta comparativa. El archivo queda en Drive.`,
    { boton: 'Quitar', tono: 'del', icono: 'trash' });
  if (!ok) return;
  try {
    await deleteCotizacion(cot.id, 'presupuestos/' + pid);
    delete cot.presupuestos[pid];
    pintarPresus(); pintarResultado();
  } catch (e) {
    toast('No se pudo quitar. Revisá la conexión.', 'error');
  }
}

// ─── Comparar ───────────────────────────────────────────
async function comparar() {
  const cot = S.cot;
  const presus = leidos(cot);
  if (presus.length < 2 || S.comparando) return;
  S.comparando = true;
  pintarPresus();
  $('res').innerHTML = `<div class="ct-box ct-carga"><span class="spinner"></span><span>Comparando ${presus.length} presupuestos con IA.<br><span class="ct-sub">Puede tardar hasta un minuto y medio.</span></span></div>`;
  try {
    const conArchivo = [];
    for (const p of presus) conArchivo.push({ file: await archivoDe(p), lectura: p.lectura });
    const { crudo, modelo, flojo } = await compararPresupuestos(conArchivo);
    const pids = presus.map(p => p.pid);
    const comp = normalizarComparacion(crudo, pids, presus.map(p => p.lectura));
    const comparacion = { ...comp, ts: Date.now(), modelo, flojo, por: { codigo: S.code, nombre: S.nombre } };
    await patchCotizacion(cot.id, { comparacion, cantidades: null });
    // Lo guardado se relee: así se ve igual que lo verá otro (sin los null).
    cot.comparacion = JSON.parse(JSON.stringify(comparacion));
    delete cot.cantidades;
    if (Object.values(comp.presupuestos).some(p => p.moneda === 'USD') && !S.tc) S.tc = await dolarOficial();
  } catch (e) {
    console.warn('comparar:', e);
    toast(`No se pudo comparar: ${e.message}`, 'error');
  }
  S.comparando = false;
  if (S.cot === cot) { pintarPresus(); pintarResultado(); }
}

// ─── Cuadro ─────────────────────────────────────────────
function celdaTexto(c, q) {
  if (c.comun == null) return { precio: fmtDoc(c.neto, true), sub: 'sin cotización del dólar' };
  const subs = [];
  if (c.usd) subs.push(`de US$ ${fmtCant(c.neto)}`);
  else if (c.factor !== 1) subs.push(`de ${fmtPesos(c.neto)} por ${esc(c.unidadDoc)}`);
  if (c.ivaIncluido) subs.push(`de ${fmtPesos(c.unitarioDoc)} c/IVA`);
  if (c.distinto) subs.push('no es lo mismo');
  return { precio: fmtPesos(c.comun), sub: subs.join(' · ') };
}

function detalleCelda(f, pid, cot) {
  const c = f.celdas[pid];
  const p = cot.presupuestos[pid];
  const partes = [`<b>${esc(nombrePresu(p))}</b>, renglón ${c.idx + 1}: «${esc(c.cita)}» · ${fmtCant(c.cantDoc)} ${esc(c.unidadDoc)} a ${fmtDoc(c.unitarioDoc, c.usd)}.`];
  if (c.ivaIncluido) partes.push('Con IVA incluido: se pasó a neto.');
  if (c.factor !== 1) partes.push(`1 ${esc(c.unidadDoc)} = ${fmtCant(c.factor)} ${esc(f.unidad)}.`);
  if (c.nota) partes.push(esc(c.nota));
  return partes.join(' ');
}

function bloqueCuenta(titulo, sub, cta, cot, hi) {
  const filas = cta.orden.map((pid, i) => {
    const gana = pid === cta.mejor;
    return `<span class="${gana ? 'gana' : ''}">${esc(nombrePresu(cot.presupuestos[pid]))}</span>
      <span class="num ${gana ? 'gana' : ''}">${fmtPesos(cta.totales[pid])}${i && cta.dif[pid] ? ` <span class="ct-sub">${fmtPct(cta.dif[pid])}</span>` : ''}</span>`;
  }).join('');
  return `<div class="ct-box"${hi ? ' style="box-shadow:inset 0 0 0 2px #c9d8ee"' : ''}>
    <div class="ct-sum-t">${titulo}</div><div class="ct-sub">${sub}</div>
    <div class="ct-sum-l">${filas}</div></div>`;
}

function pintarResultado() {
  const cot = S.cot;
  const box = $('res');
  if (S.comparando) return;
  const est = estadoComparacion(cot);
  const n = leidos(cot).length;

  if (est === 'sin' || est === 'rota') {
    box.innerHTML = `<div class="ct-box ct-vacio">${
      n < 2 ? 'Subí al menos dos presupuestos del mismo pedido. Cuando estén leídos, tocá <b>Comparar</b>.'
      : est === 'rota' ? 'Cambiaron los presupuestos desde la última comparación. Tocá <b>Comparar</b> para rehacerla.'
      : 'Listos para comparar. La IA empareja los renglones y lee las condiciones; las cuentas las hace la app.'}</div>`;
    return;
  }

  let comp, q;
  try { ({ comp, q } = cuadroDe(cot)); }
  catch (e) {
    console.warn('armarCuadro:', e);
    box.innerHTML = '<div class="ct-box ct-vacio">No se pudo armar el cuadro. Tocá <b>Volver a comparar</b>.</div>';
    return;
  }
  const c = cot.comparacion;
  const pids = q.pids;
  const nom = pid => esc(nombrePresu(cot.presupuestos[pid]));
  const html = [];

  if (est === 'vieja') html.push(`<div class="ct-aviso ct-aviso--inf">${icSvg('info')}<span>Hay presupuestos nuevos que no están en este cuadro. Tocá <b>Volver a comparar</b> para sumarlos.</span></div>`);
  if (c.flojo) html.push(`<div class="ct-aviso ct-aviso--amb">${icSvg('alert')}<span>Se comparó con el modelo liviano porque los grandes estaban sin cupo o saturados. Conviene volver a comparar más tarde.</span></div>`);
  const usdSinTc = pids.some(pid => comp.presupuestos[pid]?.moneda === 'USD') && !S.tc;
  if (usdSinTc) html.push(`<div class="ct-aviso ct-aviso--amb">${icSvg('alert')}<span>Hay un presupuesto en dólares y no se pudo traer la cotización: queda afuera de las cuentas.</span></div>`);

  // Resumen
  const sums = [];
  if (q.justa) sums.push(bloqueCuenta('Mismo producto en todos', `${q.justa.filas.length} ${q.justa.filas.length === 1 ? 'renglón' : 'renglones'} que cotizan todos igual, sin IVA`, q.justa, cot, true));
  if (q.amplia) sums.push(bloqueCuenta(q.justa ? 'Sumando los parecidos' : 'Con productos parecidos', `${q.amplia.filas.length} ${q.amplia.filas.length === 1 ? 'renglón' : 'renglones'}: incluye otra marca o línea, mirá si sirven`, q.amplia, cot, !q.justa));
  if (!sums.length) sums.push('<div class="ct-box ct-vacio">No hay renglones que coticen todos: mirá renglón por renglón.</div>');
  const faltan = pids.filter(pid => q.faltan[pid]);
  html.push(`<div class="ct-sum">${sums.join('')}</div>`);
  if (faltan.length) html.push(`<div class="ct-sub" style="margin-top:-.3rem">${faltan.map(pid => `${nom(pid)} no cotiza ${q.faltan[pid]} ${q.faltan[pid] === 1 ? 'renglón' : 'renglones'}`).join(' · ')}.</div>`);

  // Avisos de la IA
  if (comp.avisos.length) html.push(`<div class="ct-ia"><div class="ct-ia-t">${icSvg('sparkles')}Para revisar</div>
    <ul>${comp.avisos.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    <div class="ct-ia-pie">La IA empareja y avisa; las sumas las hace la app con los números leídos. Comparado con ${esc(c.modelo || '')} el ${fmtFecha(c.ts)}.</div></div>`);

  // Cuadro (escritorio)
  const cabezas = pids.map(pid => {
    const r = cot.presupuestos[pid].lectura;
    const pr = comp.presupuestos[pid] || {};
    const sub = [pr.moneda === 'USD' ? 'en dólares' : null, r.precios_incluyen_iva ? 'IVA incluido' : '+ IVA', pr.condiciones?.pago].filter(Boolean).join(' · ');
    return `<th>${nom(pid)}<span class="sub">${esc(sub)}</span></th>`;
  }).join('');
  const filasTb = q.filas.map(f => {
    const tds = pids.map(pid => {
      const cel = f.celdas[pid];
      if (!cel) return '<td class="falta">no cotiza</td>';
      const t = celdaTexto(cel, q);
      const cls = ['num', 'ct-cel', f.mejor === pid ? 'best' : '', cel.distinto ? 'dist' : '', S.celSel === f.i + ':' + pid ? 'sel' : ''].filter(Boolean).join(' ');
      return `<td class="${cls}" tabindex="0" data-cel="${f.i}:${esc(pid)}">${t.precio}${t.sub ? `<span class="sub">${t.sub}</span>` : ''}</td>`;
    }).join('');
    const grado = f.grado === 'parecido' && Object.keys(f.celdas).length > 1
      ? `<span class="ct-pill ct-pill--amb" style="margin-top:.2rem" title="${esc(f.motivo || '')}">Parecido</span>` : '';
    return `<tr><td><b>${esc(f.nombre)}</b><span class="sub">por ${esc(f.unidad)}</span>${grado}</td>
      <td><input class="ct-cant num${f.cantFijada ? ' fija' : ''}" type="number" min="0" step="any" inputmode="decimal" data-cant="${f.i}" value="${f.cant}" aria-label="Cantidad de ${esc(f.nombre)}"></td>${tds}</tr>`;
  }).join('');
  const filaTot = (cta, titulo, sub, hi) => cta ? `<tr class="tot${hi ? ' hi' : ''}"><td>${titulo}<span class="sub">${sub}</span></td><td></td>${pids.map(pid =>
    `<td class="num">${fmtPesos(cta.totales[pid])}<span class="sub">${pid === cta.mejor ? 'el más barato' : cta.dif[pid] ? fmtPct(cta.dif[pid]) : ''}</span></td>`).join('')}</tr>` : '';
  const filaDoc = `<tr class="tot"><td>Todo lo cotizado<span class="sub">sin IVA, cantidades de cada presupuesto</span></td><td></td>${pids.map(pid => {
    const t = q.totalDoc[pid];
    return `<td class="num">${fmtDoc(t.neto, t.usd)}${t.documento ? `<span class="sub">total del documento ${fmtDoc(t.documento, t.usd)}</span>` : ''}</td>`;
  }).join('')}</tr>`;
  const sel = S.celSel && (() => { const [i, pid] = S.celSel.split(':'); const f = q.filas[+i]; return f && f.celdas[pid] ? detalleCelda(f, pid, cot) : null; })();
  html.push(`<div class="ct-box ct-tw ct-tw--cuadro" style="padding:0"><table class="ct-tb">
    <thead><tr><th>Renglón</th><th>Cantidad</th>${cabezas}</tr></thead>
    <tbody>${filasTb}${filaTot(q.justa, 'Mismo producto', 'renglones iguales en todos', true)}${filaTot(q.amplia, 'Con parecidos', 'suma también otra marca o línea', !q.justa)}${filaDoc}</tbody>
  </table><div style="padding:0 .7rem .7rem"><div class="ct-src" id="ct-src"><b>De dónde sale:</b> ${sel || 'tocá un precio del cuadro. Los precios van sin IVA y por la unidad del renglón; la cantidad se puede cambiar para comparar al mismo volumen.'}</div></div></div>`);

  // Cuadro (teléfono)
  html.push(`<div class="ct-box ct-mob">${q.filas.map(f => {
    const orden = pids.filter(pid => f.celdas[pid]).sort((a, b) => (f.celdas[a].comun ?? Infinity) - (f.celdas[b].comun ?? Infinity));
    const sinCot = pids.filter(pid => !f.celdas[pid]);
    const grado = f.grado === 'parecido' && Object.keys(f.celdas).length > 1 ? '<span class="ct-pill ct-pill--amb">Parecido</span>' : '';
    return `<div class="ct-mr"><div class="ct-mr-h"><span class="ct-mr-t">${esc(f.nombre)}</span>${grado}</div>
      <div class="ct-mr-q">${orden.map(pid => { const t = celdaTexto(f.celdas[pid], q); const g = f.mejor === pid ? 'gana' : '';
        return `<span class="${g}">${nom(pid)}${t.sub ? `<span class="ct-sub" style="display:block;font-weight:500">${t.sub}</span>` : ''}</span><span class="num ${g}">${t.precio}</span>`; }).join('')}
      ${sinCot.map(pid => `<span>${nom(pid)}</span><span class="falta">no cotiza</span>`).join('')}</div>
      <div class="ct-mr-cant">Cantidad <input class="ct-cant num${f.cantFijada ? ' fija' : ''}" type="number" min="0" step="any" inputmode="decimal" data-cant="${f.i}" value="${f.cant}" aria-label="Cantidad de ${esc(f.nombre)}"> ${esc(f.unidad)}</div></div>`;
  }).join('')}</div>`);

  // Condiciones
  const CONDS = [['pago', 'Pago'], ['entrega', 'Entrega'], ['validez', 'Validez'], ['flete', 'Flete'], ['percepciones', 'Percepciones'], ['otros', 'Otros']];
  const filasCond = CONDS.filter(([k]) => pids.some(pid => comp.presupuestos[pid]?.condiciones?.[k]))
    .map(([k, t]) => `<tr><td>${t}</td>${pids.map(pid => `<td>${esc(comp.presupuestos[pid]?.condiciones?.[k] || '—')}</td>`).join('')}</tr>`);
  const filaFecha = pids.some(pid => comp.presupuestos[pid]?.fecha || comp.presupuestos[pid]?.numero)
    ? `<tr><td>Presupuesto</td>${pids.map(pid => { const pr = comp.presupuestos[pid] || {}; return `<td>${esc([pr.numero ? 'N° ' + pr.numero : null, pr.fecha].filter(Boolean).join(' · ') || '—')}</td>`; }).join('')}</tr>` : '';
  if (filasCond.length || filaFecha)
    html.push(`<div class="ct-box ct-tw" style="padding:0"><table class="ct-tb ct-cond"><thead><tr><th>Condiciones</th>${pids.map(pid => `<th style="text-align:left">${nom(pid)}</th>`).join('')}</tr></thead><tbody>${filasCond.join('')}${filaFecha}</tbody></table></div>`);

  // Elegir y generar la OC
  const cta = q.justa || q.amplia;
  const elegido = cot.oc?.pid || cta?.mejor || pids[0];
  html.push(`<div class="ct-box"><div class="ct-sum-t">Generar la OC</div>
    ${cot.estado === 'cerrada' ? `<div class="ct-aviso ct-aviso--inf" style="margin:.5rem 0 0">${icSvg('check')}<span>Ya salió la OC ${esc(cot.oc?.nroOC || '')} de esta comparativa.</span></div>` : ''}
    <div class="ct-ele">${pids.map(pid => { const t = q.totalDoc[pid]; return `<label><input type="radio" name="ele" value="${esc(pid)}"${pid === elegido ? ' checked' : ''}>
      <span><b>${nom(pid)}</b><span class="ct-sub" style="display:block">${fmtDoc(t.neto, t.usd)} sin IVA${q.faltan[pid] ? ` · no cotiza ${q.faltan[pid]}` : ''}${cta?.mejor === pid ? ' · el más barato' : ''}</span></span></label>`; }).join('')}</div>
    <button type="button" class="ct-btn ct-btn--solid" id="btn-oc" style="margin-top:.7rem;width:100%">${icSvg('arrowRight')}Abrir la Orden de Compra</button>
    <div class="ct-sub" style="margin-top:.4rem">Se abre precargada con los renglones y el presupuesto adjunto, como si lo hubieras leído ahí. Revisala antes de generar.</div></div>`);

  box.innerHTML = html.join('');
}

// Cantidad de un renglón: recalcula al toque y se guarda para todos.
let _cantTimer = null, _cantPend = {};
function cambiarCantidad(i, valor) {
  const cot = S.cot;
  const v = Number(String(valor).replace(',', '.'));
  const cants = Array.isArray(cot.cantidades) ? { ...cot.cantidades } : { ...(cot.cantidades || {}) };
  if (v > 0) cants[i] = v; else delete cants[i];
  cot.cantidades = cants;
  pintarResultado();
  _cantPend[i] = v > 0 ? v : null;
  clearTimeout(_cantTimer);
  _cantTimer = setTimeout(() => {
    const cambios = _cantPend;
    _cantPend = {};
    patchCotizacion(cot.id, cambios, 'cantidades').catch(e => console.warn('cantidades:', e));
  }, 600);
}

// ─── Ir a la OC ─────────────────────────────────────────
// El archivo viaja en la base del borrador de la OC con su propia clave (ver
// tomarArchivoCotizacion en app.js); la lectura, en sessionStorage.
function guardarArchivoParaOC(file) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vimeco-borrador-oc', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('archivo');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('archivo', 'readwrite');
      tx.objectStore('archivo').put(file, 'cotizacion_' + S.code);
      tx.oncomplete = () => { db.close(); res(); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    };
  });
}

async function irALaOC() {
  const cot = S.cot;
  const pid = document.querySelector('input[name="ele"]:checked')?.value;
  const p = pid && cot.presupuestos[pid];
  if (!p) return;
  if (cot.estado === 'cerrada') {
    const ok = await showConfirm('Ya salió una OC', `De esta comparativa ya salió la OC ${cot.oc?.nroOC || ''}. ¿Abrís otra igual?`,
      { boton: 'Abrir otra', tono: 'warn', icono: 'alert' });
    if (!ok) return;
  }
  const btn = $('btn-oc');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Preparando…';
  try {
    await guardarArchivoParaOC(await archivoDe({ ...p, pid }));
  } catch (e) {
    console.warn('guardarArchivoParaOC:', e);
    toast('No se pudo traer el archivo: la OC se abre sin el presupuesto adjunto.', 'warning');
  }
  const moneda = cot.comparacion?.presupuestos?.[pid]?.moneda === 'USD' ? 'USD' : 'ARS';
  try {
    sessionStorage.setItem('oc_desde_cotizacion', JSON.stringify({
      ts: Date.now(), cotizacionId: cot.id, pid, obra: cot.obra, titulo: cot.titulo, moneda, lectura: p.lectura
    }));
  } catch (_) {
    toast('No se pudo preparar la OC.', 'error');
    btn.disabled = false;
    return;
  }
  window.location.href = 'app.html';
}

async function borrarComparativa() {
  const cot = S.cot;
  const ok = await showConfirm('Borrar comparativa', `Se borra «${cot.titulo}» con su cuadro. Los archivos quedan en Drive.`,
    { boton: 'Borrar', tono: 'del', icono: 'trash' });
  if (!ok) return;
  try {
    await deleteCotizacion(cot.id);
    S.lista = S.lista.filter(c => c.id !== cot.id);
    if (S.empujado) history.back(); else volverALista();
  } catch (e) {
    toast('No se pudo borrar. Revisá la conexión.', 'error');
  }
}

// ─── Eventos ────────────────────────────────────────────
async function elegidos(input) {
  const files = [...input.files];
  input.value = '';
  return files;
}

function enlazar() {
  document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = icSvg(el.dataset.ic); });

  $('btn-back').addEventListener('click', () => {
    if (!$('vista-det').classList.contains('hidden')) { if (S.empujado) history.back(); else volverALista(); }
    else window.location.href = 'compras.html';
  });
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('c');
    if (id) abrirDetalle(id); else { S.empujado = false; volverALista(); }
  });

  $('btn-nueva').addEventListener('click', abrirNueva);
  $('nueva-close').addEventListener('click', cerrarNueva);
  $('nueva-cancel').addEventListener('click', cerrarNueva);
  $('nueva-crear').addEventListener('click', crearNueva);
  $('form-nueva').addEventListener('submit', e => { e.preventDefault(); crearNueva(); });
  $('lista').addEventListener('click', e => {
    const card = e.target.closest('[data-id]');
    if (card) abrirDetalle(card.dataset.id, { push: true });
  });

  $('btn-elegir').addEventListener('click', () => $('in-elegir').click());
  $('btn-foto').addEventListener('click', () => $('in-foto').click());
  $('in-elegir').addEventListener('change', async e => agregarArchivos(await elegidos(e.target)));
  $('in-foto').addEventListener('change', async e => {
    const [f] = await elegidos(e.target);
    if (!f) return;
    let listo = f;
    if (typeof openScanner === 'function') {
      try { listo = await openScanner(f); } catch (_) { toast('Escáner no disponible; se usó la foto original.', 'warning'); }
    }
    if (listo) agregarArchivos([listo]);
  });

  // Soltar archivos en cualquier lado de la comparativa abierta.
  const det = $('vista-det');
  let hondo = 0;
  det.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); hondo++; $('drop').classList.add('sobre'); } });
  det.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  det.addEventListener('dragleave', () => { if (--hondo <= 0) { hondo = 0; $('drop').classList.remove('sobre'); } });
  det.addEventListener('drop', e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    hondo = 0; $('drop').classList.remove('sobre');
    agregarArchivos([...e.dataTransfer.files]);
  });

  $('presus').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.quitar) quitar(b.dataset.quitar);
    else if (b.dataset.releer) releer(b.dataset.releer);
    else if (b.dataset.reintentar) subirYLeer(S.cot.id, b.dataset.reintentar);
    else if (b.dataset.descartar) { delete S.locales[b.dataset.descartar]; pintarPresus(); }
  });
  $('btn-comparar').addEventListener('click', comparar);
  $('btn-borrar').addEventListener('click', borrarComparativa);

  const res = $('res');
  const tocarCelda = td => { S.celSel = td.dataset.cel; pintarResultado(); };
  res.addEventListener('click', e => {
    const td = e.target.closest('[data-cel]');
    if (td) tocarCelda(td);
    else if (e.target.closest('#btn-oc')) irALaOC();
  });
  res.addEventListener('keydown', e => {
    const td = e.target.closest('[data-cel]');
    if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tocarCelda(td); }
  });
  res.addEventListener('change', e => {
    const inp = e.target.closest('[data-cant]');
    if (inp) cambiarCantidad(+inp.dataset.cant, inp.value);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('modal-nueva').classList.contains('hidden')) cerrarNueva();
  });
  // Salir con un presupuesto subiéndose lo corta: se avisa.
  window.addEventListener('beforeunload', e => {
    if (Object.values(S.locales).some(l => l.estado !== 'error')) { e.preventDefault(); e.returnValue = ''; }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }
  // Por ahora sólo para 0000, mientras se prueba.
  if (_s.codigo !== '0000') { window.location.href = 'compras.html'; return; }
  S.code = _s.codigo;
  S.nombre = _s.nombre || '';
  sessionStorage.setItem('responsable_code', S.code);
  $('hdr-name').textContent = _s.nombre;
  enlazar();

  alcanceOC(S.code).then(a => { S.admin = !!a.isAdmin; if (S.cot) pintarDetalle(); }).catch(() => {});
  S.obrasListas = getObrasActivas().then(o => { S.obras = o; }).catch(e => console.warn('getObrasActivas:', e));

  await cargarLista();
  const id = new URLSearchParams(location.search).get('c');
  if (id) abrirDetalle(id);
});
