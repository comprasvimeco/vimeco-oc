/* VIMECO S.A. — Ficha de Equipo (admin 0000 o Jefe de taller)

   Cabecera (foto, código, pastillas), Compras del equipo (OC con este equipo),
   ubicación y responsable, datos (código y descripción detrás de "Editar"),
   repuestos y documentación en Drive. "Guardar" aparece sólo con cambios y se
   avisa antes de salir sin guardar. Los documentos se guardan solos al subirlos. */

const $ = id => document.getElementById(id);

// esc, equipoKey, familias, ubicPill, compras: equiposComun.js

// Redimensiona y comprime la imagen en el cliente antes de guardarla como
// dataURL. Una foto de celular pesa 3-5 MB; así queda en ~80-150 KB.
// Helper genérico: reutilizable a futuro para la foto de rostro en Personal.
function compressImage(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        let { width, height } = img;
        if (width >= height && width > maxDim) {
          height = Math.round(height * maxDim / width); width = maxDim;
        } else if (height > width && height > maxDim) {
          width = Math.round(width * maxDim / height); height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---- Estado ----
let currentKey = null;
let equipo     = null;   // datos del equipo cargado
let obras      = [];     // obras para el selector de ubicación
let obrasMap   = {};
let fotoActual = null;   // dataURL guardado en Firebase (para saber si cambió)
let fotoNueva  = null;   // dataURL elegido en esta sesión (null = sin cambios)
let fotoQuitar = false;  // se pidió borrar la foto
let periodo    = '12m';  // de Compras del equipo
let verReportes = false;
let guardando  = false;

// ---- Cambios sin guardar ----
// Foto de lo editable; si difiere de la base, aparece la barra de Guardar.
let base = '';
function snapshot() {
  return JSON.stringify({
    c: $('eq-codigo').value.trim(), t: $('eq-tipo').value.trim(),
    p: $('eq-patente').value.trim().toUpperCase(), f: $('eq-familia').value,
    u: $('eq-ubicacion').value, r: $('eq-responsable').value.trim(),
    i: collectItems(), foto: fotoNueva ? 'nueva' : fotoQuitar ? 'quitar' : ''
  });
}
function hayCambios() { return !!equipo && snapshot() !== base; }
function revisarCambios() {
  const sucio = hayCambios();
  $('eq-savebar').classList.toggle('hidden', !sucio);
  if (sucio) { $('eq-save-st').textContent = 'Cambios sin guardar'; $('eq-save-st').classList.remove('err'); }
}
function errorGuardar(msg) {
  $('eq-savebar').classList.remove('hidden');
  $('eq-save-st').textContent = msg;
  $('eq-save-st').classList.add('err');
}

async function salir(url) {
  if (hayCambios()) {
    const ok = await showConfirm('Salir sin guardar',
      'Hay cambios en la ficha que no se guardaron. Si salís, se pierden.',
      { boton: 'Salir sin guardar', tono: 'warn', icono: 'alert', cancelar: 'Seguir editando' });
    if (!ok) return;
    base = snapshot();   // para que no salte el aviso del navegador
  }
  window.location.href = url;
}

// ---- Cabecera ----
function pintarCabecera() {
  const codigo = $('eq-codigo').value.trim() || equipo.codigo;
  const tipo   = $('eq-tipo').value.trim();
  const fam    = FAM_BY_KEY[$('eq-familia').value] || familiaDe(equipo);
  const pat    = $('eq-patente').value.trim().toUpperCase();
  const activo = equipo.activo !== false;
  const ubic   = $('eq-ubicacion').value;
  $('h-cod').textContent = codigo;
  $('h-tp').textContent  = [tipo || '—', fam.n].join(' · ');
  $('h-chips').innerHTML =
    (pat ? `<span class="eq-pat">${esc(pat)}</span>` : '') +
    `<span class="eq-st ${activo ? 'eq-st--ok' : 'eq-st--off'}">${icSvg(activo ? 'checkSm' : 'power')}${activo ? 'Activo' : 'Inactivo'}</span>` +
    ubicPill({ ubicacion: ubic, activo: true }, obrasMap);
  const resp = $('eq-responsable').value.trim();
  $('h-kv').innerHTML = `<span>Responsable</span><b>${esc(resp || '—')}</b>`;
  $('ic-ubic').className = 'eq-sq' + (ubic && esTaller(obrasMap[ubic]) ? ' eq-sq--blue' : '');
  $('ic-ubic').innerHTML = icSvg(ubic && esTaller(obrasMap[ubic]) ? 'tool' : 'pin');
  document.querySelector('.header-title').textContent = codigo || 'Ficha de Equipo';
  pintarFoto();
}

// ---- Foto ----
function fotoVisible() { return fotoQuitar ? null : (fotoNueva || fotoActual); }

function pintarFoto() {
  const src = fotoVisible();
  $('eq-foto').innerHTML = src
    ? `<img src="${src}" alt="Foto del equipo">`
    : icSvg((FAM_BY_KEY[$('eq-familia').value] || familiaDe(equipo)).i);
  $('btn-foto-menu').innerHTML = icSvg('camera') + (src ? 'Cambiar foto' : 'Agregar foto');
  $('menu-foto').innerHTML =
    `<button type="button" class="act-opt" role="menuitem" data-foto="cam"><span class="act-opt-ic eq-sq">${icSvg('camera')}</span>Sacar foto</button>` +
    `<button type="button" class="act-opt" role="menuitem" data-foto="gal"><span class="act-opt-ic eq-sq eq-sq--blue">${icSvg('image')}</span>Elegir de la galería</button>` +
    (src ? `<button type="button" class="act-opt" role="menuitem" data-foto="del"><span class="act-opt-ic eq-sq" style="background:#fde6e6;color:#b02a2a">${icSvg('trash')}</span>Quitar la foto</button>` : '');
}

async function onFotoElegida(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    fotoNueva  = await compressImage(file);
    fotoQuitar = false;
    pintarFoto();
    revisarCambios();
  } catch (_) {
    showToast('No se pudo procesar la imagen.', 'error');
  }
}

function onQuitarFoto() {
  fotoNueva  = null;
  fotoQuitar = !!fotoActual;
  pintarFoto();
  revisarCambios();
}

// ---- Estado (activo / inactivo): se guarda al instante, como antes ----
async function toggleActivo() {
  const activo = equipo.activo !== false;
  const ok = await showConfirm(
    activo ? 'Desactivar equipo' : 'Activar equipo',
    activo
      ? `¿Desactivar "${equipo.codigo}"? No aparecerá al asignar equipos en nuevas OC.`
      : `¿Activar "${equipo.codigo}"?`,
    activo ? { boton: 'Desactivar', tono: 'warn', icono: 'power' } : { boton: 'Activar', tono: 'ok', icono: 'power' }
  );
  if (!ok) return;
  try {
    await patchEquipo(currentKey, { activo: !activo });
    equipo.activo = !activo;
    pintarDatosVer();
    pintarCabecera();
    showToast(`Equipo ${activo ? 'desactivado' : 'activado'}.`);
  } catch (_) {
    showToast('Error al actualizar el estado.', 'error');
  }
}

// ---- Datos: lectura / edición protegida ----
let editandoDatos = false;

function pintarDatosVer() {
  const activo = equipo.activo !== false;
  const fam = FAM_BY_KEY[$('eq-familia').value] || familiaDe(equipo);
  $('datos-ver').innerHTML =
    `<span>Código</span><b>${esc($('eq-codigo').value.trim() || '—')}</b>` +
    `<span>Descripción</span><b>${esc($('eq-tipo').value.trim() || '—')}</b>` +
    `<span>Familia</span><b>${esc(fam.n)}</b>` +
    `<span>Patente</span><b>${esc($('eq-patente').value.trim().toUpperCase() || '—')}</b>` +
    `<span>Estado</span><b>${activo ? 'Activo' : 'Inactivo'} · <button type="button" class="eqf-estado ${activo ? 'eqf-estado--off' : 'eqf-estado--on'}" id="btn-toggle-activo">${activo ? 'Desactivar' : 'Activar'}</button></b>`;
  $('btn-toggle-activo').addEventListener('click', toggleActivo);
}

function setDatosEditables(on) {
  editandoDatos = on;
  $('datos-ver').style.display  = on ? 'none' : '';
  $('datos-edit').style.display = on ? '' : 'none';
  $('btn-edit-datos').style.display = on ? 'none' : '';
  if (on) $('eq-codigo').focus();
  else pintarDatosVer();
}

async function habilitarEdicionDatos() {
  if (editandoDatos) { $('eq-codigo').focus(); return; }
  const ok = await showConfirm(
    'Editar datos del equipo',
    'Vas a habilitar la edición del código, la descripción, la familia y la patente. Cambiar el código renombra el equipo. ¿Continuar?',
    { boton: 'Editar', tono: 'info', icono: 'edit' }
  );
  if (ok) {
    setDatosEditables(true);
    if (window.matchMedia('(max-width: 999px)').matches)
      $('datos-edit').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function pintarFamiliaSelect() {
  const auto = familiaPorCodigo($('eq-codigo').value);
  const sel  = $('eq-familia');
  const v    = sel.value;
  sel.innerHTML = FAMILIAS.map(f => `<option value="${f.k}">${esc(f.n)}${f.k === auto.k ? ' (por el código)' : ''}</option>`).join('');
  sel.value = v || familiaDe(equipo).k;
}

// ---- Ubicación ----
// La ubicación se guarda como referencia (key de la obra), no como texto: así
// el día que las obras tengan coordenadas el mapa sale directo, sin migrar datos.
function pintarUbicacion() {
  const sel     = $('eq-ubicacion');
  const actual  = equipo.ubicacion || '';
  const activas = obras.filter(o => o.activa);
  // Si la obra actual ya no está activa (se cerró), incluirla igual para no perderla.
  const extra = actual && !activas.some(o => o.key === actual)
    ? obras.filter(o => o.key === actual)
    : [];
  const opts = [...activas, ...extra].sort((a, b) => a.nombre.localeCompare(b.nombre));
  sel.innerHTML = '<option value="">Sin asignar</option>' +
    opts.map(o => `<option value="${esc(o.key)}">${esc(o.nombre)}</option>`).join('');
  sel.value = actual;
}

// ---- Repuestos ----
function addItemRow(valor = '') {
  const row = document.createElement('div');
  row.className = 'eqf-item';
  row.innerHTML = `
    <input type="text" placeholder="Ej: Filtro de aceite Mann W940" aria-label="Repuesto o característica">
    <button type="button" class="eqf-item-del" title="Quitar" aria-label="Quitar">${icSvg('x')}</button>`;
  row.querySelector('input').value = valor;
  row.querySelector('.eqf-item-del').addEventListener('click', () => {
    row.remove();
    refreshItemsEmpty();
    revisarCambios();
  });
  $('eq-items').appendChild(row);
  refreshItemsEmpty();
  return row;
}

function refreshItemsEmpty() {
  const cont = $('eq-items');
  const hasRows = cont.querySelector('.eqf-item');
  let ph = cont.querySelector('.eqf-items-empty');
  if (!hasRows && !ph) {
    ph = document.createElement('div');
    ph.className = 'eqf-items-empty';
    ph.textContent = 'Sin repuestos ni características cargados todavía.';
    cont.prepend(ph);
  } else if (hasRows && ph) {
    ph.remove();
  }
}

function collectItems() {
  return Array.from($('eq-items').querySelectorAll('.eqf-item input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

// ---- Compras del equipo ----
function pintarCompras() {
  $('compras-periodo').innerHTML = periodoDdHTML('periodo', periodo);
  ocsConEquipo().then(ocs => {
    $('f-compras').innerHTML = comprasHTML(resumenCompras(ocs, equipo.codigo, periodo),
      { max: 4, linkReportes: verReportes ? linkReportesEquipo(equipo.codigo) : '' });
  }).catch(() => {
    $('f-compras').innerHTML = '<div class="eq-vacio">No se pudieron leer las compras.</div>';
  });
}

// ---- Documentación (archivos en Drive) ----
// Índice en Firebase (/equipos_docs/{key}); el archivo vive en Drive, en
// EQUIPOS/{Código - Descripción}/. Subir o quitar un documento impacta al
// instante: no pasa por "Guardar".
let docsFolderId = null;
let docs         = [];     // [{ id, texto, nombre, fileId, mime, size, subidoPor, fecha }]
let docEditando  = null;   // id del documento cuyo texto se edita (null = alta)
let docArchivo   = null;   // File elegido en el modal de alta
let userName     = '';

function nombreCarpetaEquipo(codigo, tipo) {
  return [codigo, tipo].map(s => String(s || '').trim()).filter(Boolean).join(' - ') || 'Sin nombre';
}

function extension(nombre) {
  const m = /\.([a-z0-9]{1,6})$/i.exec(nombre || '');
  return m ? m[1].toLowerCase() : '';
}

function sinExtension(nombre) {
  return String(nombre || '').replace(/\.[a-z0-9]{1,6}$/i, '');
}

// Color y rótulo del cuadradito de la tarjeta según el tipo de archivo.
function tipoDoc(mime, nombre) {
  const ext = extension(nombre);
  mime = mime || '';
  if (mime === 'application/pdf' || ext === 'pdf') return { cls: 'pdf', label: 'PDF' };
  if (mime.startsWith('image/')) return { cls: 'img', label: (ext || 'IMG').toUpperCase().slice(0, 4) };
  if (/sheet|excel|csv/.test(mime) || /^(xlsx?|csv|ods)$/.test(ext))
    return { cls: 'xls', label: (ext || 'XLS').toUpperCase() };
  if (/word|document|text/.test(mime) || /^(docx?|odt|txt|rtf)$/.test(ext))
    return { cls: 'doc', label: (ext || 'DOC').toUpperCase() };
  return { cls: 'otro', label: (ext || 'ARCH').toUpperCase().slice(0, 4) };
}

function fmtPeso(bytes) {
  const n = Number(bytes) || 0;
  if (!n) return '';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}

function fmtFecha(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

function docTileHTML(mime, nombre) {
  const t = tipoDoc(mime, nombre);
  return `<span class="doc-tile doc-tile--${t.cls}">${esc(t.label)}</span>`;
}

function docCardHTML(d) {
  const meta = [fmtFecha(d.fecha), fmtPeso(d.size), d.subidoPor].filter(Boolean).join(' · ');
  return `
    <div class="doc-card" data-id="${esc(d.id)}">
      <a class="doc-link" href="https://drive.google.com/file/d/${encodeURIComponent(d.fileId)}/view" target="_blank" rel="noopener" title="${esc(d.nombre)}">
        ${docTileHTML(d.mime, d.nombre)}
        <span class="doc-body">
          <span class="doc-texto">${esc(d.texto || sinExtension(d.nombre))}</span>
          <span class="doc-meta">${esc(meta)}</span>
        </span>
      </a>
      <div class="doc-btns">
        <button type="button" class="doc-btn" data-act="edit" title="Editar texto" aria-label="Editar texto">${icSvg('edit')}</button>
        <button type="button" class="doc-btn doc-btn--del" data-act="del" title="Quitar" aria-label="Quitar">${icSvg('x')}</button>
      </div>
    </div>`;
}

function pintarDocs() {
  $('eq-docs').innerHTML = docs.length
    ? docs.map(docCardHTML).join('')
    : '<div class="eq-docs-empty">Sin documentos adjuntos todavía.</div>';
  const carpeta = $('btn-docs-carpeta');
  if (docsFolderId) carpeta.href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(docsFolderId);
  carpeta.style.display            = docsFolderId ? '' : 'none';
  $('btn-docs-sync').style.display = docsFolderId ? '' : 'none';
}

// Tarjeta provisoria con barra de progreso mientras sube.
function cardSubiendo(texto, file) {
  const el = document.createElement('div');
  el.className = 'doc-card doc-card--subiendo';
  el.innerHTML = `
    <div class="doc-link">
      ${docTileHTML(file.type, file.name)}
      <span class="doc-body">
        <span class="doc-texto">${esc(texto)}</span>
        <span class="doc-meta">Subiendo… 0%</span>
      </span>
    </div>
    <div class="doc-bar" style="width:0"></div>`;
  const vacio = $('eq-docs').querySelector('.eq-docs-empty');
  if (vacio) vacio.remove();
  $('eq-docs').prepend(el);
  return {
    progreso(p) {
      const pct = Math.round(p * 100);
      el.querySelector('.doc-bar').style.width = pct + '%';
      el.querySelector('.doc-meta').textContent = `Subiendo… ${pct}%`;
    },
    quitar() { el.remove(); }
  };
}

function abrirModalDoc(doc) {
  docEditando = doc ? doc.id : null;
  docArchivo  = null;
  $('modal-doc-title').textContent  = doc ? 'Editar texto' : 'Adjuntar documento';
  $('modal-doc-yes').textContent    = doc ? 'Guardar' : 'Subir';
  $('doc-file-group').style.display = doc ? 'none' : '';
  $('doc-elegido').textContent      = '';
  $('doc-texto').value = doc ? (doc.texto || sinExtension(doc.nombre)) : '';
  $('modal-doc').classList.remove('hidden');
  if (doc) $('doc-texto').focus();
}

function cerrarModalDoc() {
  $('modal-doc').classList.add('hidden');
  docEditando = null;
  docArchivo  = null;
}

function onDocElegido(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.size) { showToast('El archivo está vacío.', 'error'); return; }
  docArchivo = file;
  $('doc-elegido').textContent = file.name + ' · ' + fmtPeso(file.size);
  if (!$('doc-texto').value.trim()) $('doc-texto').value = sinExtension(file.name);
  $('doc-texto').focus();
}

async function confirmarModalDoc() {
  const texto = $('doc-texto').value.trim();
  if (docEditando) {
    const doc = docs.find(d => d.id === docEditando);
    cerrarModalDoc();
    if (doc && texto && texto !== doc.texto) await renombrarDoc(doc, texto);
    return;
  }
  if (!docArchivo) { showToast('Elegí un archivo.', 'error'); return; }
  const file = docArchivo;
  cerrarModalDoc();
  await subirDoc(file, texto || sinExtension(file.name));
}

// El archivo en Drive se llama como el texto de la tarjeta (+ extensión original),
// así la carpeta queda prolija para quien la abra directo en Drive.
function nombreEnDrive(texto, nombreOriginal) {
  const ext = extension(nombreOriginal);
  return texto + (ext ? '.' + ext : '');
}

async function subirDoc(file, texto) {
  const nombre = nombreEnDrive(texto, file.name);
  const card   = cardSubiendo(texto, file);
  const btn    = $('btn-docs-add');
  btn.disabled = true;
  try {
    const { fileId, folderId } = await uploadEquipoArchivo(file, {
      folderId:   docsFolderId,
      folderName: nombreCarpetaEquipo(equipo.codigo, equipo.tipo),
      nombre,
      onProgress: p => card.progreso(p)
    });
    if (folderId !== docsFolderId) {
      await setEquipoDocsFolder(currentKey, folderId);
      docsFolderId = folderId;
    }
    const data = {
      texto, nombre, fileId,
      mime: file.type || '', size: file.size,
      subidoPor: userName, fecha: Date.now()
    };
    const id = await addEquipoArchivo(currentKey, data);
    docs.unshift({ id, ...data });
    showToast('Documento subido.');
  } catch (err) {
    showToast('No se pudo subir el documento: ' + ((err && err.message) || 'error'), 'error');
  } finally {
    card.quitar();
    btn.disabled = false;
    pintarDocs();
  }
}

async function renombrarDoc(doc, texto) {
  try {
    await patchEquipoArchivo(currentKey, doc.id, { texto });
    doc.texto = texto;
    pintarDocs();
  } catch (_) {
    showToast('No se pudo guardar el texto.', 'error');
    return;
  }
  // Best-effort: la tarjeta ya quedó bien aunque Drive no acompañe.
  const nombre = nombreEnDrive(texto, doc.nombre);
  renameDriveItem(doc.fileId, nombre)
    .then(() => { doc.nombre = nombre; return patchEquipoArchivo(currentKey, doc.id, { nombre }); })
    .catch(() => {});
}

async function quitarDoc(doc) {
  const ok = await showConfirm(
    'Quitar documento',
    `¿Quitar "${doc.texto || doc.nombre}"? El archivo va a la papelera de Drive (se puede recuperar durante 30 días).`,
    { boton: 'Quitar', tono: 'del', icono: 'trash' }
  );
  if (!ok) return;
  try {
    await trashDriveFile(doc.fileId);
    await deleteEquipoArchivo(currentKey, doc.id);
    docs = docs.filter(d => d.id !== doc.id);
    pintarDocs();
    showToast('Documento quitado.');
  } catch (_) {
    showToast('No se pudo quitar el documento.', 'error');
  }
}

// Suma al índice los archivos que se subieron a mano directo en la carpeta de Drive.
async function traerDeDrive() {
  const btn = $('btn-docs-sync');
  btn.disabled = true;
  try {
    const enDrive   = await listDriveFolderFiles(docsFolderId);
    const conocidos = new Set(docs.map(d => d.fileId));
    const nuevos    = enDrive.filter(f => !conocidos.has(f.id));
    for (const f of nuevos) {
      const data = {
        texto: sinExtension(f.name), nombre: f.name, fileId: f.id,
        mime: f.mimeType || '', size: Number(f.size) || 0,
        subidoPor: 'Drive', fecha: Date.parse(f.createdTime) || Date.now()
      };
      const id = await addEquipoArchivo(currentKey, data);
      docs.push({ id, ...data });
    }
    docs.sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
    pintarDocs();
    showToast(nuevos.length
      ? `Se sumaron ${nuevos.length} archivo${nuevos.length === 1 ? '' : 's'} de Drive.`
      : 'No hay archivos nuevos en la carpeta.');
  } catch (_) {
    showToast('No se pudo leer la carpeta de Drive.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function onDocsClick(e) {
  const btn = e.target.closest('.doc-btn');
  if (!btn) return;
  const doc = docs.find(d => d.id === btn.closest('.doc-card').dataset.id);
  if (!doc) return;
  if (btn.dataset.act === 'edit') abrirModalDoc(doc);
  else quitarDoc(doc);
}

// ---- Carga ----
// Vuelca `equipo` (y la foto guardada) al formulario y toma esa foto como base.
function volcarFormulario() {
  $('eq-codigo').value      = equipo.codigo || '';
  $('eq-tipo').value        = equipo.tipo || '';
  $('eq-patente').value     = equipo.patente || '';
  $('eq-responsable').value = equipo.responsable || '';
  $('eq-familia').value     = '';
  pintarFamiliaSelect();
  pintarUbicacion();
  $('eq-items').innerHTML = '';
  (equipo.items || []).forEach(it => addItemRow(it));
  refreshItemsEmpty();
  fotoNueva = null; fotoQuitar = false;
  setDatosEditables(false);
  pintarCabecera();
  base = snapshot();
  revisarCambios();
}

async function loadFicha() {
  try {
    equipo = await getEquipo(currentKey);
    if (!equipo) {
      $('eq-loading').innerHTML = '<div class="eq-card eq-vacio">El equipo no existe.</div>';
      return;
    }
    const [foto, obrasAll, d] = await Promise.all([
      getEquipoFoto(currentKey).catch(() => null),
      getAllObras().catch(() => []),
      getEquipoDocs(currentKey).catch(() => ({ folderId: null, archivos: [] }))
    ]);
    fotoActual   = foto;
    obras        = obrasAll;
    obrasMap     = Object.fromEntries(obras.map(o => [o.key, o.nombre]));
    docsFolderId = d.folderId;
    docs         = d.archivos;

    volcarFormulario();
    pintarDocs();
    pintarCompras();

    $('eq-loading').style.display = 'none';
    $('eq-ficha').style.display   = '';
  } catch (_) {
    $('eq-loading').innerHTML = '<div class="eq-card eq-vacio">Error al cargar la ficha.</div>';
  }
}

async function descartar() {
  volcarFormulario();
}

// ---- Guardar ----
async function save() {
  if (guardando) return;
  const codigo      = $('eq-codigo').value.trim();
  const tipo        = $('eq-tipo').value.trim();
  const patente     = $('eq-patente').value.trim().toUpperCase();
  const responsable = $('eq-responsable').value.trim();
  const activo      = equipo.activo !== false;
  const ubicacion   = $('eq-ubicacion').value || null;
  const items       = collectItems();
  // La familia sólo se guarda si difiere de la que sale del código.
  const famSel      = $('eq-familia').value;
  const familia     = famSel && famSel !== familiaPorCodigo(codigo).k ? famSel : null;

  if (!codigo) {
    if (!editandoDatos) setDatosEditables(true);
    errorGuardar('El código es requerido.');
    return;
  }

  const newKey = equipoKey(codigo);
  const btn = $('btn-save');
  guardando = true;
  btn.disabled = true;
  btn.innerHTML = icSvg('checkSm') + 'Guardando…';

  try {
    let keyFinal = currentKey;

    if (newKey !== currentKey) {
      // Cambió el código = cambió la clave: mover el equipo (y su foto) a la clave nueva.
      const existentes = await getAllEquipos();
      if (existentes.some(e => e.key === newKey)) {
        errorGuardar('Ya existe un equipo con ese código.');
        return;
      }
      const datos = {
        codigo, tipo, patente, responsable, activo, ubicacion, items,
        creadoEn: equipo.creadoEn || Date.now()
      };
      if (familia) datos.familia = familia;
      await saveEquipo(newKey, datos);
      await deleteEquipo(currentKey);
      await moveEquipoDocs(currentKey, newKey).catch(() => {});
      keyFinal = newKey;
    } else {
      await patchEquipo(currentKey, { codigo, tipo, patente, responsable, activo, ubicacion, items, familia });
    }

    // Foto
    if (fotoNueva) {
      await saveEquipoFoto(keyFinal, fotoNueva);
      if (keyFinal !== currentKey) await deleteEquipoFoto(currentKey).catch(() => {});
    } else if (fotoQuitar) {
      await deleteEquipoFoto(keyFinal).catch(() => {});
      if (keyFinal !== currentKey) await deleteEquipoFoto(currentKey).catch(() => {});
    } else if (keyFinal !== currentKey && fotoActual) {
      // No se tocó la foto, pero cambió la clave: moverla.
      await saveEquipoFoto(keyFinal, fotoActual);
      await deleteEquipoFoto(currentKey).catch(() => {});
    }

    // La carpeta de Drive se llama "Código - Descripción": acompañar el cambio.
    if (docsFolderId && nombreCarpetaEquipo(codigo, tipo) !== nombreCarpetaEquipo(equipo.codigo, equipo.tipo))
      renameDriveItem(docsFolderId, nombreCarpetaEquipo(codigo, tipo)).catch(() => {});

    showToast('Ficha guardada.');
    if (keyFinal !== currentKey) {
      base = snapshot();
      window.location.replace('equipo.html?key=' + encodeURIComponent(keyFinal));
      return;
    }
    // Refrescar estado local
    const codigoAntes = equipo.codigo;
    equipo = { ...equipo, key: keyFinal, codigo, tipo, patente, responsable, activo, ubicacion, items };
    if (familia) equipo.familia = familia; else delete equipo.familia;
    if (fotoNueva) fotoActual = fotoNueva;
    else if (fotoQuitar) fotoActual = null;
    volcarFormulario();
    if (codigo !== codigoAntes) pintarCompras();
  } catch (_) {
    errorGuardar('Error al guardar. Intentá de nuevo.');
  } finally {
    guardando = false;
    btn.disabled = false;
    btn.innerHTML = icSvg('checkSm') + 'Guardar';
  }
}

// ---- Init ----
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

  currentKey = new URLSearchParams(location.search).get('key');
  if (!currentKey) { window.location.href = 'equipos.html'; return; }

  userName = name || '';
  $('hdr-name').textContent = name || '—';

  // Íconos de los encabezados de sección y botones
  $('btn-edit-hero').innerHTML  = icSvg('edit');
  $('btn-edit-datos').innerHTML = icSvg('edit') + 'Editar';
  $('ic-datos').innerHTML       = icSvg('file');
  $('ic-items').innerHTML       = icSvg('tool');
  $('ic-compras').innerHTML     = icSvg('cart');
  $('ic-docs').innerHTML        = icSvg('clip');
  $('ic-modal-doc').innerHTML   = icSvg('clip');
  $('btn-add-item').innerHTML   = icSvg('plus') + 'Agregar renglón';
  $('btn-save').innerHTML       = icSvg('checkSm') + 'Guardar';
  $('btn-docs-add').innerHTML     = icSvg('plus') + 'Adjuntar';
  $('btn-docs-carpeta').innerHTML = icSvg('folder');
  $('btn-docs-sync').innerHTML    = icSvg('undo');
  $('btn-doc-elegir').innerHTML   = icSvg('file') + 'Elegir archivo';

  // Salir: avisa si hay cambios
  $('btn-back').addEventListener('click', () => salir('equipos.html'));
  $('header-brand').addEventListener('click', () => salir('menu.html'));
  window.addEventListener('beforeunload', ev => {
    if (hayCambios()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // Foto
  bindDesplegables((opt, dd) => {
    if (dd === 'periodo') { periodo = opt.dataset.periodo; pintarCompras(); return; }
    if (dd === 'foto') {
      const a = opt.dataset.foto;
      if (a === 'cam') $('eq-file-cam').click();
      else if (a === 'gal') $('eq-file').click();
      else if (a === 'del') onQuitarFoto();
    }
  });
  $('eq-file').addEventListener('change', onFotoElegida);
  $('eq-file-cam').addEventListener('change', onFotoElegida);

  // Datos
  $('btn-edit-datos').addEventListener('click', habilitarEdicionDatos);
  $('btn-edit-hero').addEventListener('click', habilitarEdicionDatos);
  $('eq-codigo').addEventListener('input', pintarFamiliaSelect);

  // Cualquier cambio en la ficha: cabecera al día y barra de Guardar
  $('eq-ficha').addEventListener('input', () => { if (equipo) { pintarCabecera(); revisarCambios(); } });
  $('eq-ficha').addEventListener('change', () => { if (equipo) { pintarCabecera(); revisarCambios(); } });

  $('btn-add-item').addEventListener('click', () => { addItemRow().querySelector('input').focus(); });
  $('eq-items').addEventListener('keydown', ev => {
    // Enter en un renglón agrega otro abajo
    if (ev.key === 'Enter' && ev.target.matches('.eqf-item input')) {
      ev.preventDefault();
      addItemRow().querySelector('input').focus();
    }
  });
  $('btn-save').addEventListener('click', save);
  $('btn-descartar').addEventListener('click', descartar);

  // Documentación
  $('btn-docs-add').addEventListener('click', () => abrirModalDoc(null));
  $('btn-docs-sync').addEventListener('click', traerDeDrive);
  $('btn-doc-elegir').addEventListener('click', () => $('doc-file').click());
  $('doc-file').addEventListener('change', onDocElegido);
  $('modal-doc-no').addEventListener('click', cerrarModalDoc);
  $('modal-doc-yes').addEventListener('click', confirmarModalDoc);
  $('modal-doc').addEventListener('click', ev => { if (ev.target.id === 'modal-doc') cerrarModalDoc(); });
  $('doc-texto').addEventListener('keydown', e => { if (e.key === 'Enter') confirmarModalDoc(); });
  $('eq-docs').addEventListener('click', onDocsClick);

  puedeVerReportes(code).then(v => { verReportes = v; if (equipo) pintarCompras(); });
  loadFicha();
});
