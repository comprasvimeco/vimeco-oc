/* VIMECO S.A. — Gestión de Equipos (solo Admin) */

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



function showConfirm(title, msg) {
  return new Promise(resolve => {
    $('modal-confirm-title').textContent = title;
    $('modal-confirm-msg').textContent   = msg;
    const modal = $('modal-confirm');
    modal.classList.remove('hidden');
    $('modal-confirm-no').onclick  = () => { modal.classList.add('hidden'); resolve(false); };
    $('modal-confirm-yes').onclick = () => { modal.classList.add('hidden'); resolve(true); };
  });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Clave de Firebase derivada del código (sin caracteres inválidos).
function equipoKey(codigo) {
  return String(codigo).trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

let allEquipos = [];

function renderEquipos(list) {
  const container = $('equipos-list');
  const seedBtn   = $('btn-seed');
  if (!list.length) {
    container.innerHTML = '<div class="hist-empty">No hay equipos cargados.</div>';
    seedBtn.classList.remove('hidden');
    return;
  }
  seedBtn.classList.add('hidden');
  container.innerHTML = list.map(e => `
    <div class="eq-row ${e.activo ? '' : 'eq-row--inactive'}" title="Abrir ficha">
      <span class="eq-code">${esc(e.codigo)}</span>
      <span class="eq-tipo">${esc(e.tipo || '')}</span>
      ${e.activo ? '' : '<span class="u-badge u-badge-inactivo">Inactivo</span>'}
      <span class="eq-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>
  `).join('');

  container.querySelectorAll('.eq-row').forEach((row, i) =>
    row.addEventListener('click', () => openFicha(list[i].key)));
}

function openFicha(key) {
  window.location.href = 'equipo.html?key=' + encodeURIComponent(key);
}

async function loadEquipos() {
  try {
    allEquipos = await getAllEquipos();
    renderEquipos(allEquipos);
  } catch (_) {
    $('equipos-list').innerHTML = '<div class="hist-empty">Error al cargar equipos.</div>';
  }
}

function openAddModal() {
  $('modal-equipo-title').textContent = 'Agregar equipo';
  $('modal-equipo-error').classList.add('hidden');
  $('equipo-codigo').value = '';
  $('equipo-tipo').value   = '';
  $('equipo-codigo').disabled = false;
  $('modal-equipo').classList.remove('hidden');
  setTimeout(() => $('equipo-codigo').focus(), 50);
}

// Alta rápida (código + tipo). La foto y los repuestos se cargan luego en la ficha.
async function saveEquipoModal() {
  const codigo = $('equipo-codigo').value.trim();
  const tipo   = $('equipo-tipo').value.trim();
  const errEl  = $('modal-equipo-error');

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
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';

  try {
    await saveEquipo(key, { codigo, tipo, activo: true, creadoEn: Date.now() });
    $('modal-equipo').classList.add('hidden');
    showToast('Equipo creado.');
    openFicha(key);
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

async function seedEquipos() {
  const ok = await showConfirm(
    'Importar lista inicial',
    `Se cargarán ${SEED_EQUIPOS.length} equipos. Los equipos con el mismo código se sobrescribirán.`
  );
  if (!ok) return;

  const btn = $('btn-seed');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  try {
    const obj = {};
    SEED_EQUIPOS.forEach(([codigo, tipo]) => {
      obj[equipoKey(codigo)] = { codigo, tipo, activo: true, creadoEn: Date.now() };
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

  $('hdr-name').textContent = name || '—';
  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  $('btn-add-equipo').addEventListener('click', openAddModal);
  $('btn-seed').addEventListener('click', seedEquipos);
  $('modal-equipo-close').addEventListener('click',  () => $('modal-equipo').classList.add('hidden'));
  $('modal-equipo-cancel').addEventListener('click', () => $('modal-equipo').classList.add('hidden'));
  $('modal-equipo-save').addEventListener('click', saveEquipoModal);
  $('equipo-tipo').addEventListener('keydown', e => { if (e.key === 'Enter') saveEquipoModal(); });

  loadEquipos();
});
