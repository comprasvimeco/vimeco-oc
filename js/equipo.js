/* VIMECO S.A. — Ficha de Equipo (admin 0000 o Jefe de taller) */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Clave de Firebase derivada del código (igual que en equipos.js).
function equipoKey(codigo) {
  return String(codigo).trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

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
let fotoActual = null;   // dataURL guardado en Firebase (para saber si cambió)
let fotoNueva  = null;   // dataURL elegido en esta sesión (null = sin cambios)
let fotoQuitar = false;  // se pidió borrar la foto

// ---- Foto ----
function pintarFoto(dataURL) {
  const box = $('eq-foto');
  if (dataURL) {
    box.innerHTML = `<img src="${dataURL}" alt="Foto del equipo">`;
    $('btn-foto').textContent = 'Cambiar foto';
    $('btn-foto-del').style.display = '';
  } else {
    box.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>`;
    $('btn-foto').textContent = 'Agregar foto';
    $('btn-foto-del').style.display = 'none';
  }
}

async function onFotoElegida(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const dataURL = await compressImage(file);
    fotoNueva  = dataURL;
    fotoQuitar = false;
    pintarFoto(dataURL);
  } catch (_) {
    showToast('No se pudo procesar la imagen.', 'error');
  }
}

function onQuitarFoto() {
  fotoNueva  = null;
  fotoQuitar = true;
  pintarFoto(null);
}

// ---- Estado (activo / inactivo) ----
function pintarEstado() {
  const activo = equipo.activo !== false;
  const badge  = $('eq-estado-badge');
  badge.textContent = activo ? 'Activo' : 'Inactivo';
  badge.className   = 'u-badge ' + (activo ? 'u-badge-activo' : 'u-badge-inactivo');
  const btn = $('btn-toggle-activo');
  btn.textContent = activo ? 'Desactivar' : 'Activar';
  btn.className   = 'btn btn-sm ' + (activo ? 'btn-danger' : 'btn-success');
}

async function toggleActivo() {
  const activo = equipo.activo !== false;
  const ok = await showConfirm(
    activo ? 'Desactivar equipo' : 'Activar equipo',
    activo
      ? `¿Desactivar "${equipo.codigo}"? No aparecerá al asignar equipos en nuevas OC.`
      : `¿Activar "${equipo.codigo}"?`
  );
  if (!ok) return;
  const btn = $('btn-toggle-activo');
  btn.disabled = true;
  try {
    await patchEquipo(currentKey, { activo: !activo });
    equipo.activo = !activo;
    pintarEstado();
    showToast(`Equipo ${activo ? 'desactivado' : 'activado'}.`);
  } catch (_) {
    showToast('Error al actualizar el estado.', 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---- Edición protegida de código / descripción ----
let editandoDatos = false;

function setDatosEditables(on) {
  editandoDatos = on;
  $('eq-codigo').readOnly = !on;
  $('eq-tipo').readOnly   = !on;
  $('btn-edit-datos').textContent = on ? 'Editando…' : 'Editar';
  $('btn-edit-datos').disabled = on;
  if (on) $('eq-codigo').focus();
}

async function habilitarEdicionDatos() {
  if (editandoDatos) return;
  const ok = await showConfirm(
    'Editar datos del equipo',
    'Vas a habilitar la edición del código y la descripción. Cambiar el código renombra el equipo. ¿Continuar?'
  );
  if (ok) setDatosEditables(true);
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
  row.className = 'eq-item-row';
  row.innerHTML = `
    <input type="text" class="form-control" placeholder="Ej: Filtro de aceite Mann W940">
    <button class="eq-item-del" title="Quitar">&times;</button>`;
  row.querySelector('input').value = valor;
  row.querySelector('.eq-item-del').addEventListener('click', () => {
    row.remove();
    refreshItemsEmpty();
  });
  $('eq-items').appendChild(row);
  refreshItemsEmpty();
  return row;
}

function refreshItemsEmpty() {
  const cont = $('eq-items');
  const hasRows = cont.querySelector('.eq-item-row');
  let ph = cont.querySelector('.eq-items-empty');
  if (!hasRows && !ph) {
    ph = document.createElement('div');
    ph.className = 'eq-items-empty';
    ph.textContent = 'Sin repuestos ni características cargados todavía.';
    cont.prepend(ph);
  } else if (hasRows && ph) {
    ph.remove();
  }
}

function collectItems() {
  return Array.from($('eq-items').querySelectorAll('.eq-item-row input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

// ---- Documentación (archivos en Drive) ----
// Índice en Firebase (/equipos_docs/{key}); el archivo vive en Drive, en
// EQUIPOS/{Código - Descripción}/. Subir o quitar un documento impacta al
// instante: no pasa por "Guardar cambios".
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

// Color y rótulo del cuadradito de la card según el tipo de archivo.
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
  return `<span class="doc-tile doc-tile--${t.cls}">${icSvg('file')}<span>${esc(t.label)}</span></span>`;
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
        <button class="doc-btn" data-act="edit" title="Editar texto" aria-label="Editar texto">${icSvg('edit')}</button>
        <button class="doc-btn doc-btn--del" data-act="del" title="Quitar" aria-label="Quitar">${icSvg('x')}</button>
      </div>
    </div>`;
}

function pintarDocs() {
  $('eq-docs').innerHTML = docs.length
    ? docs.map(docCardHTML).join('')
    : '<div class="eq-docs-empty">Sin documentos adjuntos todavía.</div>';
  const carpeta = $('btn-docs-carpeta');
  if (docsFolderId) carpeta.href = 'https://drive.google.com/drive/folders/' + encodeURIComponent(docsFolderId);
  carpeta.style.display           = docsFolderId ? '' : 'none';
  $('btn-docs-sync').style.display = docsFolderId ? '' : 'none';
}

// Card provisoria con barra de progreso mientras sube.
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

// El archivo en Drive se llama como el texto de la card (+ extensión original),
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
  // Best-effort: la card ya quedó bien aunque Drive no acompañe.
  const nombre = nombreEnDrive(texto, doc.nombre);
  renameDriveItem(doc.fileId, nombre)
    .then(() => { doc.nombre = nombre; return patchEquipoArchivo(currentKey, doc.id, { nombre }); })
    .catch(() => {});
}

async function quitarDoc(doc) {
  const ok = await showConfirm(
    'Quitar documento',
    `¿Quitar "${doc.texto || doc.nombre}"? El archivo va a la papelera de Drive (se puede recuperar durante 30 días).`
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
  btn.textContent = 'Buscando…';
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
    btn.textContent = 'Traer de Drive';
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
async function loadFicha() {
  try {
    equipo = await getEquipo(currentKey);
    if (!equipo) {
      $('eq-loading').innerHTML = '<div class="hist-empty">El equipo no existe.</div>';
      return;
    }
    fotoActual = await getEquipoFoto(currentKey).catch(() => null);
    obras      = await getAllObras().catch(() => []);
    const d    = await getEquipoDocs(currentKey).catch(() => ({ folderId: null, archivos: [] }));
    docsFolderId = d.folderId;
    docs         = d.archivos;

    $('eq-codigo').value      = equipo.codigo || '';
    $('eq-tipo').value        = equipo.tipo || '';
    $('eq-patente').value     = equipo.patente || '';
    $('eq-responsable').value = equipo.responsable || '';
    pintarEstado();
    pintarUbicacion();

    (equipo.items || []).forEach(it => addItemRow(it));
    refreshItemsEmpty();

    pintarFoto(fotoActual);
    pintarDocs();

    $('eq-loading').style.display = 'none';
    $('eq-ficha').style.display   = '';
    document.querySelector('.header-title').textContent = equipo.codigo || 'Ficha de Equipo';
  } catch (_) {
    $('eq-loading').innerHTML = '<div class="hist-empty">Error al cargar la ficha.</div>';
  }
}

// ---- Guardar ----
async function save() {
  const codigo      = $('eq-codigo').value.trim();
  const tipo        = $('eq-tipo').value.trim();
  const patente     = $('eq-patente').value.trim().toUpperCase();
  const responsable = $('eq-responsable').value.trim();
  const activo      = equipo.activo !== false;
  const ubicacion   = $('eq-ubicacion').value || null;
  const items       = collectItems();
  const errEl       = $('eq-error');
  errEl.classList.add('hidden');

  if (!codigo) {
    errEl.textContent = 'El código es requerido.';
    errEl.classList.remove('hidden');
    return;
  }

  const newKey = equipoKey(codigo);
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    let keyFinal = currentKey;

    if (newKey !== currentKey) {
      // Cambió el código = cambió la clave: mover el equipo (y su foto) a la clave nueva.
      const existentes = await getAllEquipos();
      if (existentes.some(e => e.key === newKey)) {
        errEl.textContent = 'Ya existe un equipo con ese código.';
        errEl.classList.remove('hidden');
        return;
      }
      await saveEquipo(newKey, {
        codigo, tipo, patente, responsable, activo, ubicacion, items,
        creadoEn: equipo.creadoEn || Date.now()
      });
      await deleteEquipo(currentKey);
      await moveEquipoDocs(currentKey, newKey).catch(() => {});
      keyFinal = newKey;
    } else {
      await patchEquipo(currentKey, { codigo, tipo, patente, responsable, activo, ubicacion, items });
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
      window.location.replace('equipo.html?key=' + encodeURIComponent(keyFinal));
      return;
    }
    // Refrescar estado local
    equipo = { key: keyFinal, codigo, tipo, patente, responsable, activo, ubicacion, items, creadoEn: equipo.creadoEn };
    if (fotoNueva) fotoActual = fotoNueva;
    else if (fotoQuitar) fotoActual = null;
    fotoNueva = null; fotoQuitar = false;
    setDatosEditables(false);
    document.querySelector('.header-title').textContent = codigo;
  } catch (_) {
    errEl.textContent = 'Error al guardar. Intentá de nuevo.';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
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
  $('btn-back').addEventListener('click', () => { window.location.href = 'equipos.html'; });
  $('btn-foto').addEventListener('click', () => $('eq-file').click());
  $('btn-foto-cam').addEventListener('click', () => $('eq-file-cam').click());
  $('eq-file').addEventListener('change', onFotoElegida);
  $('eq-file-cam').addEventListener('change', onFotoElegida);
  $('btn-foto-del').addEventListener('click', onQuitarFoto);
  $('btn-edit-datos').addEventListener('click', habilitarEdicionDatos);
  $('btn-toggle-activo').addEventListener('click', toggleActivo);
  $('btn-add-item').addEventListener('click', () => addItemRow().querySelector('input').focus());
  $('btn-save').addEventListener('click', save);

  $('btn-docs-add').innerHTML     = icSvg('clip') + ' Adjuntar';
  $('btn-docs-carpeta').innerHTML = icSvg('folder') + ' Carpeta';
  $('btn-docs-add').addEventListener('click', () => abrirModalDoc(null));
  $('btn-docs-sync').addEventListener('click', traerDeDrive);
  $('btn-doc-elegir').addEventListener('click', () => $('doc-file').click());
  $('doc-file').addEventListener('change', onDocElegido);
  $('modal-doc-no').addEventListener('click', cerrarModalDoc);
  $('modal-doc-yes').addEventListener('click', confirmarModalDoc);
  $('doc-texto').addEventListener('keydown', e => { if (e.key === 'Enter') confirmarModalDoc(); });
  $('eq-docs').addEventListener('click', onDocsClick);

  loadFicha();
});
