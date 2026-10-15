/* VIMECO OC — Novedades: datos para corregir

   Lo operativo que antes vivía en Reportes y se mudó acá, donde se ve a
   diario (traído de Leva con el rediseño de Reportes):
   - OC duplicadas de toda la empresa (Historial muestra a cada uno sólo las
     suyas), con el mismo panel y el mismo criterio que Historial.
   - OC cargadas con una obra que no está en la lista: se pasan a una que sí.
     Reemplaza al «Unificar obras» de Reportes, que tenía la lista de VIMECO
     escrita en el código.
   - Eliminar una OC del historial, desde su ficha (0000, admin o reportes:
     lo mismo que dejan las reglas).

   Usa lo de js/actividad.js (histAll, ocPorNro, allEvents, render, abrirFicha,
   cerrarFicha, esc, $), que se carga antes. actividad.js llama a
   datosCargar(hist) cuando baja el historial y a datosFicha(oc) al abrir una ficha. */

let datosObras    = [];      // /obras completo, activas e inactivas
let datosPuedeDel = false;   // puede eliminar OC del historial
let datosFichaOC  = null;    // la OC de la ficha abierta

// Lo que cuenta como compra: ni las de prueba ni las anuladas/pendientes.
const datosFirmes = () => histAll.filter(oc => esCompraFirme(oc) && !esOCPrueba(oc));

async function datosCargar(hist) {
  const code = miCodigo;
  let u = null;
  try { u = await getUsuario(code); } catch (_) {}
  datosPuedeDel = code === '0000' || !!(u && (u.admin || u.reportes));
  try { datosObras = await getAllObras(); } catch (_) { datosObras = []; }
  datosRender();
}

function datosRender() {
  datosRenderDup();
  datosRenderSueltas();
}

// ===================================================
//  OC duplicadas (todas, no sólo las propias)
// ===================================================
let datosGrupos = [];

function datosRenderDup() {
  const box = $('act-dup');
  datosGrupos = grupoDuplicados(datosFirmes()).filter(g => !g.every(oc => oc.noDuplicada));
  if (!datosGrupos.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const n = datosGrupos.length;
  const money = oc => fmtMonto(oc.total, oc.moneda);
  const dia = ts => new Date(ts || 0).toLocaleDateString('es-AR');
  box.innerHTML = `
    <div class="dup-panel-t">${icSvg('copy')} ${n > 1 ? n + ' posibles OC duplicadas' : 'Posible OC duplicada'}</div>
    <div class="dup-panel-sub">Más de una OC al mismo proveedor, de la misma persona, en menos de una hora y por un monto
      parecido o con los mismos artículos. Marcá la que quedó sin validez: sigue en el historial como «Duplicada», pero deja de contar en Reportes.</div>
    ${datosGrupos.map((g, gi) => `
      <div class="dup-grupo" data-g="${gi}">
        <div class="dup-grupo-head"><b>${esc(g[0].proveedor?.nombre || 'Sin proveedor')}</b> · ${esc(dia(g[0].timestamp))} · ${esc(g[0].responsable?.nombre || '—')}</div>
        <div class="dup-lista">${g.map((oc, i) => {
          const anular = i < g.length - 1;
          return `
          <label class="dup-oc${anular ? ' dup-oc--anular' : ''}">
            <input type="checkbox" value="${i}"${anular ? ' checked' : ''}>
            <span class="dup-oc-main">
              <button type="button" class="dup-oc-nro datos-ver" data-nro="${esc(oc.nroOC)}" title="Ver la ficha de la OC">${esc(oc.nroOC)}</button>
              <span class="dup-oc-sub">${esc(horaDe(oc.timestamp))} · ${esc(oc.obra || 'Sin obra')}</span>
            </span>
            <span class="dup-oc-monto">${esc(money(oc))}<small>${esc(etiquetaDup(oc, g[0]))}</small></span>
          </label>`;
        }).join('')}</div>
        <div class="dup-grupo-foot">
          <button class="foc-btn foc-btn--clear dup-distintas">Son compras distintas</button>
          <button class="foc-btn foc-btn--del dup-anular"></button>
        </div>
      </div>`).join('')}`;
  box.querySelectorAll('.dup-grupo').forEach(datosSyncAnular);
  box.classList.remove('hidden');

  if (box._wired) return;
  box._wired = true;
  box.addEventListener('change', e => {
    const lbl = e.target.closest('.dup-oc');
    if (!lbl) return;
    lbl.classList.toggle('dup-oc--anular', e.target.checked);
    datosSyncAnular(e.target.closest('.dup-grupo'));
  });
  box.addEventListener('click', e => {
    const ver = e.target.closest('.datos-ver');
    if (ver) { e.preventDefault(); abrirFicha(ocPorNro.get(ver.dataset.nro)); return; }
    const grupo = e.target.closest('.dup-grupo');
    if (!grupo) return;
    if (e.target.closest('.dup-anular'))    datosResolverDup(grupo, 'anular');
    if (e.target.closest('.dup-distintas')) datosResolverDup(grupo, 'distintas');
  });
}

function datosMarcadas(grupo) {
  const g = datosGrupos[+grupo.dataset.g];
  const sel = new Set([...grupo.querySelectorAll('input:checked')].map(c => +c.value));
  return { anular: g.filter((_, i) => sel.has(i)), quedan: g.filter((_, i) => !sel.has(i)) };
}

function datosSyncAnular(grupo) {
  const { anular } = datosMarcadas(grupo);
  const btn = grupo.querySelector('.dup-anular');
  btn.innerHTML = icSvg('x') + (anular.length === 1 ? `Anular la ${esc(anular[0].nroOC)}`
    : anular.length ? `Anular ${anular.length} OC` : 'Anular');
  btn.disabled = !anular.length;
}

// Igual que en Historial: la reemplaza la más nueva de las que quedan.
async function datosResolverDup(grupo, accion) {
  const { anular, quedan } = datosMarcadas(grupo);
  if (accion === 'anular' && !quedan.length) {
    toast('Tiene que quedar al menos una OC sin anular: la que vale.', 'error');
    return;
  }
  grupo.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    if (accion === 'distintas') {
      await marcarComprasDistintas([...anular, ...quedan]);
      toast('Listo: no se marcan más como duplicadas.', 'success');
    } else {
      await anularPorReemplazo(anular, quedan[quedan.length - 1].nroOC);
      if (quedan.length > 1) await marcarComprasDistintas(quedan);
      toast(`${anular.map(oc => 'OC ' + oc.nroOC).join(', ')} anulada${anular.length > 1 ? 's' : ''} como duplicada.`, 'success');
    }
  } catch (e) {
    toast('No se pudo guardar. ' + e.message, 'error');
  }
  datosRenderDup();
  render();   // las tarjetas del feed muestran el estado de su OC
}

// ===================================================
//  OC con una obra que no está en la lista
// ===================================================
// La OC guarda el nombre de la obra, no su clave: si la obra se renombró, se
// borró o se cargó a mano con otra escritura, sus OC quedan sueltas y Reportes
// las cuenta como otra obra. Se agrupan por nombre y se pasan a una de la lista.
const datosNorm = s => normTxt(s).replace(/[^a-z0-9]+/g, ' ').trim();

function datosSueltas() {
  if (!datosObras.length) return [];
  const nombres = new Set(datosObras.map(o => o.nombre));
  const map = new Map();
  datosFirmes().forEach(oc => {
    if (!oc.obra || nombres.has(oc.obra)) return;
    if (!map.has(oc.obra)) map.set(oc.obra, []);
    map.get(oc.obra).push(oc);
  });
  return [...map.entries()]
    .map(([nombre, ocs]) => ({ nombre, ocs, sugerida: datosSugerida(nombre) }))
    .sort((a, b) => b.ocs.length - a.ocs.length);
}

// La obra de la lista que más se le parece: misma escritura sin tildes ni
// signos, o una que la contiene («La Molienda II - Varios» → «La Molienda II»).
function datosSugerida(nombre) {
  const n = datosNorm(nombre);
  const igual = datosObras.find(o => datosNorm(o.nombre) === n);
  if (igual) return igual.nombre;
  const cont = datosObras
    .filter(o => { const m = datosNorm(o.nombre); return m.length > 3 && (n.startsWith(m + ' ') || m.startsWith(n + ' ')); })
    .sort((a, b) => b.nombre.length - a.nombre.length)[0];
  return cont ? cont.nombre : '';
}

function datosRenderSueltas() {
  const box = $('act-sueltas');
  const grupos = datosSueltas();
  if (!grupos.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const n = grupos.length;
  const opciones = sel => `<option value="">${esc('Elegí la obra…')}</option>` +
    datosObras.map(o => `<option value="${esc(o.nombre)}"${o.nombre === sel ? ' selected' : ''}>${esc(o.nombre)}${o.activa === false ? ` (${'inactiva'})` : ''}</option>`).join('');
  box.innerHTML = `
    <div class="dup-panel-t">${icSvg('building')} ${n > 1 ? `${n} nombres de obra que no están en la lista` : `1 nombre de obra que no está en la lista`}</div>
    <div class="dup-panel-sub">Sus OC se cargaron con un nombre que no coincide con ninguna obra: Reportes las cuenta aparte. Pasalas a la obra que corresponde.</div>
    ${grupos.map((g, gi) => `
      <div class="dup-grupo" data-g="${gi}">
        <div class="dup-grupo-head"><b>${esc(g.nombre)}</b> · ${g.ocs.length} OC</div>
        <div class="datos-mover">
          <select class="form-control datos-dest" aria-label="${esc('Obra a la que pasan')}">${opciones(g.sugerida)}</select>
          <button class="foc-btn foc-btn--gen datos-pasar"${g.sugerida ? '' : ' disabled'}>${icSvg('check')}Pasar</button>
        </div>
      </div>`).join('')}`;
  box._grupos = grupos;
  box.classList.remove('hidden');

  if (box._wired) return;
  box._wired = true;
  box.addEventListener('change', e => {
    const sel = e.target.closest('.datos-dest');
    if (sel) sel.closest('.dup-grupo').querySelector('.datos-pasar').disabled = !sel.value;
  });
  box.addEventListener('click', e => {
    const btn = e.target.closest('.datos-pasar');
    if (btn) datosPasar(btn.closest('.dup-grupo'), btn);
  });
}

async function datosPasar(grupoEl, btn) {
  const g  = $('act-sueltas')._grupos[+grupoEl.dataset.g];
  const to = grupoEl.querySelector('.datos-dest').value;
  if (!g || !to) return;
  const ok = await showConfirm('Pasar a la obra',
    `¿Pasar ${g.ocs.length === 1 ? 'la OC' : `las ${g.ocs.length} OC`} de «${g.nombre}» a «${to}»? ` +
    'Cambia el nombre en el historial; el PDF ya emitido no se toca.',
    { boton: 'Pasar', tono: 'ok', icono: 'check' });
  if (!ok) return;

  btn.disabled = true;
  let bien = 0, mal = 0;
  await Promise.all(g.ocs.map(async oc => {
    try { await patchHistorialEntry(histKeyOf(oc), { obra: to }); oc.obra = to; bien++; }
    catch (_) { mal++; }
  }));
  toast(`${bien} OC pasada${bien !== 1 ? 's' : ''} a ${to}${mal ? `, ${mal} con error` : ''}.`, mal ? 'warning' : 'success');
  datosRender();
  render();
}

// ===================================================
//  Eliminar una OC, desde su ficha
// ===================================================
function datosFicha(oc) {
  datosFichaOC = oc;
  let btn = $('preview-delete');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'preview-delete';
    btn.className = 'foc-btn foc-btn--del';
    btn.title = 'Eliminar la OC del historial';
    btn.innerHTML = icSvg('trash') + 'Eliminar';
    btn.addEventListener('click', datosEliminar);
    const foot = document.querySelector('#modal-preview .foc-foot-r');
    foot.insertBefore(btn, foot.firstChild);
  }
  btn.classList.toggle('hidden', !datosPuedeDel || !oc);
}

async function datosEliminar() {
  const oc = datosFichaOC;
  if (!oc) return;
  const ok = await showConfirm('Eliminar OC',
    `¿Borrar la OC ${oc.nroOC} (${fmtMonto(oc.total, oc.moneda)}) del historial? ` +
    'No se puede deshacer. El PDF archivado no se toca: si esta OC ya se le mandó al proveedor, borrarla acá no la da de baja. ' +
    'Si fue un error de carga reemplazado por otra OC, mejor anulala: queda como «Duplicada».',
    { boton: 'Borrar', tono: 'del', icono: 'trash' });
  if (!ok) return;

  const btn = $('preview-delete');
  btn.disabled = true;
  try {
    await deleteHistorialEntry(histKeyOf(oc));
    // Sus novedades apuntarían a una OC que ya no existe. Best-effort: lo que
    // importa, el historial, ya está borrado.
    try { await deleteNovedadesDeOC(oc.nroOC); } catch (e) { console.warn('deleteNovedadesDeOC:', e); }
    const i = histAll.indexOf(oc); if (i >= 0) histAll.splice(i, 1);
    ocPorNro.delete(oc.nroOC);
    allEvents = allEvents.filter(e => (e.nroOC || nroDeTitulo(e.titulo)) !== oc.nroOC);
    cerrarFicha();
    toast('OC borrada.', 'success');
    datosRender();
    render();
  } catch (e) {
    toast('No se pudo borrar. ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
