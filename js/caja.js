/* global getCajaMovimientos, saveCajaMovimiento, deleteCajaMovimiento,
          patchCajaMovimiento, getCategoriasCaja, saveCategoriasCaja,
          getAllUsuarios, getUsuario, uploadToCajaDrive */

document.addEventListener('DOMContentLoaded', async () => {

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

  // ─── DOM refs ────────────────────────────────────────
  const toastContainer = document.getElementById('toast-container');

  function showToast(msg, type = '') {
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function fmtMonto(n) {
    const s = Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return '$ ' + s;
  }

  function fmtFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Registra un movimiento de caja en el feed de Novedades (best-effort).
  function logCajaActivity(mov, fileId) {
    if (typeof logActivity !== 'function') return;
    const label  = mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso';
    const cuenta = targetCodigo !== userCodigo ? ` (caja de ${targetNombre})` : '';
    logActivity({
      tipo:    'caja',
      usuario: { codigo: userCodigo, nombre: userNombre },
      titulo:   `${label} de caja — ${fmtMonto(mov.monto || 0)}${cuenta}`,
      detalle:  [mov.categoria, mov.descripcion].filter(Boolean).join(' · ') || '—',
      driveUrl: fileId ? `https://drive.google.com/file/d/${fileId}/view` : ''
    });
  }

  // Anima un número desde su valor actual hasta `to` (con formato de monto)
  const _countTimers = new WeakMap();
  function countUp(el, to) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = el._cuVal || 0;
    if (reduce || from === to) { el.textContent = fmtMonto(to); el._cuVal = to; return; }
    if (_countTimers.has(el)) cancelAnimationFrame(_countTimers.get(el));
    const dur = 650, t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      el.textContent = fmtMonto(from + (to - from) * eased);
      if (p < 1) { _countTimers.set(el, requestAnimationFrame(step)); }
      else { el.textContent = fmtMonto(to); el._cuVal = to; }
    };
    _countTimers.set(el, requestAnimationFrame(step));
  }

  // ─── Header ──────────────────────────────────────────
  document.getElementById('hdr-name').textContent = userNombre;

  document.getElementById('btn-menu').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('hdr-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('hdr-dropdown').classList.add('hidden'));

  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('vimeco_session');
    window.location.href = 'index.html';
  });

  if (isAdmin) {
    document.getElementById('btn-categorias').classList.remove('hidden');
    document.getElementById('btn-categorias').addEventListener('click', openCategoriasModal);
  }

  // ─── Load categories ─────────────────────────────────
  async function loadCategorias() {
    try {
      categorias = await getCategoriasCaja();
    } catch (_) { categorias = []; }

    if (!categorias.length) {
      categorias = ['Viaticos', 'Peajes', 'Combustibles', 'Repuestos', 'Oficina', 'Herramientas', 'Pasajes', 'Inspección', 'Equipos', 'Otras'];
      try { await saveCategoriasCaja(categorias); } catch (_) {}
    }

    const sel = document.getElementById('gasto-categoria');
    sel.innerHTML = '<option value="">— Seleccioná —</option>';
    categorias.forEach(c => {
      const o = document.createElement('option');
      o.value = o.textContent = c;
      sel.appendChild(o);
    });
  }

  // ─── Admin: selector de usuario ──────────────────────
  if (isAdmin) {
    document.getElementById('admin-selector-card').classList.remove('hidden');

    try {
      const usuarios = await getAllUsuarios();
      const sel = document.getElementById('select-usuario');
      usuarios.forEach(u => {
        const o = document.createElement('option');
        o.value = u.codigo;
        o.textContent = `${u.nombre} (${u.codigo})`;
        sel.appendChild(o);
      });
      sel.value = userCodigo;
    } catch (_) {}

    document.getElementById('select-usuario').addEventListener('change', () => {
      const sel = document.getElementById('select-usuario');
      if (!sel.value) return;
      targetCodigo = sel.value;
      targetNombre = sel.options[sel.selectedIndex].textContent.replace(/ \(\w+\)$/, '');
      loadMovimientos();
    });
  }

  // ─── Ingreso (recarga): disponible para admin y usuarios habilitados ─
  {
    document.getElementById('btn-nuevo-ingreso').addEventListener('click', () => openRecargaModal());
    document.getElementById('modal-recarga-close').addEventListener('click', closeRecargaModal);
    document.getElementById('btn-recarga-cancelar').addEventListener('click', closeRecargaModal);
    document.getElementById('modal-recarga').addEventListener('click', e => { if (e.target === e.currentTarget) closeRecargaModal(); });

    document.getElementById('btn-recarga-guardar').addEventListener('click', async () => {
      const errorEl    = document.getElementById('recarga-error');
      const mesRecarga  = document.getElementById('recarga-mes').value;
      const comentario  = document.getElementById('recarga-comentario').value.trim();
      const monto       = parseMonto(document.getElementById('recarga-monto').value);
      const MESES_R = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const [ry, rm]  = mesRecarga.split('-');
      const labelMes  = `Recarga ${MESES_R[parseInt(rm, 10)]} ${ry}`;
      const descripcion = comentario ? `${labelMes} — ${comentario}` : labelMes;
      errorEl.classList.add('hidden');

      if (!monto || monto <= 0) {
        errorEl.textContent = 'Ingresá un monto válido.';
        errorEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-recarga-guardar');
      btn.disabled = true;
      const mov = { tipo: 'ingreso', descripcion, fecha: mesRecarga + '-01', monto };
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
  }

  // ─── Load movements ──────────────────────────────────
  async function loadMovimientos() {
    const elLoad  = document.getElementById('movimientos-loading');
    const elEmpty = document.getElementById('movimientos-empty');
    const elTable = document.getElementById('movimientos-table-wrap');
    const elCards = document.getElementById('movimientos-cards');

    elLoad.style.display  = 'block';
    elEmpty.style.display = 'none';
    elTable.style.display = 'none';
    elCards.style.display = 'none';

    try {
      movimientos = await getCajaMovimientos(targetCodigo);
    } catch (err) {
      movimientos = [];
      showToast('Error al cargar movimientos: ' + (err.message || err), 'error');
    }

    elLoad.style.display = 'none';

    // Rebuild month filter (always month-based, no "todos")
    const mesActualDefault = new Date().toISOString().substring(0, 7);
    const mesesData = [...new Set(movimientos.map(m => m.fecha?.substring(0, 7)).filter(Boolean))];
    if (!mesesData.includes(mesActualDefault)) mesesData.push(mesActualDefault);
    const meses = mesesData.sort().reverse();
    const prevFilter = document.getElementById('filter-mes').value;
    const filterSel  = document.getElementById('filter-mes');
    filterSel.innerHTML = '';
    const MESES = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach(mes => {
      const [y, m] = mes.split('-');
      const o = document.createElement('option');
      o.value = mes;
      o.textContent = `${MESES[parseInt(m, 10)]} ${y}`;
      filterSel.appendChild(o);
    });
    filterSel.value = prevFilter && meses.includes(prevFilter) ? prevFilter : mesActualDefault;

    renderMovimientos();
  }

  function renderMovimientos() {
    const mesFilter = document.getElementById('filter-mes').value;
    const filtered  = mesFilter ? movimientos.filter(m => m.fecha?.startsWith(mesFilter)) : movimientos;

    // Balance del mes seleccionado (con arrastre acumulado)
    const totalIngresos = filtered.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const totalGastos   = filtered.filter(m => m.tipo === 'gasto').reduce((s, m)  => s + (m.monto || 0), 0);
    // Excedente anterior = neto de TODOS los movimientos de meses previos al seleccionado
    const excedente = mesFilter
      ? movimientos
          .filter(m => m.fecha && m.fecha.substring(0, 7) < mesFilter)
          .reduce((s, m) => s + (m.tipo === 'ingreso' ? (m.monto || 0) : -(m.monto || 0)), 0)
      : 0;
    const saldo = excedente + totalIngresos - totalGastos;

    countUp(document.getElementById('val-excedente'), excedente);
    countUp(document.getElementById('val-ingresos'), totalIngresos);
    countUp(document.getElementById('val-gastos'),   totalGastos);
    const valSaldoEl = document.getElementById('val-saldo');
    countUp(valSaldoEl, saldo);
    valSaldoEl.classList.toggle('neg', saldo < 0);

    const elEmpty = document.getElementById('movimientos-empty');
    const elTable = document.getElementById('movimientos-table-wrap');
    const elCards = document.getElementById('movimientos-cards');

    if (!filtered.length) {
      elEmpty.style.display = 'block';
      elTable.style.display = 'none';
      elCards.style.display = 'none';
      return;
    }

    elEmpty.style.display = 'none';
    const isMobile = window.innerWidth < 700;
    elTable.style.display = isMobile ? 'none' : 'block';
    elCards.style.display = isMobile ? 'block' : 'none';

    if (isMobile) {
      renderCards(filtered);
    } else {
      renderTable(filtered);
    }
  }

  function canDelete() {
    return isAdmin || targetCodigo === userCodigo;
  }

  function driveLink(m) {
    if (!m.driveFileId) return '';
    return `<a href="https://drive.google.com/file/d/${m.driveFileId}/view" target="_blank" rel="noopener" class="btn btn-xs btn-outline" title="Ver comprobante"><svg class="icon" style="width:13px;height:13px;" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></a>`;
  }

  function deleteBtn(key) {
    if (!canDelete()) return '';
    return `<button class="btn btn-xs btn-secondary btn-del" data-key="${key}" title="Eliminar"><svg class="icon" style="width:13px;height:13px;" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></button>`;
  }

  function editBtn(key) {
    if (!canDelete()) return '';
    return `<button class="btn btn-xs btn-secondary btn-edit" data-key="${key}" title="Editar"><svg class="icon" style="width:13px;height:13px;" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;
  }

  function openEdit(key) {
    const m = movimientos.find(x => x.key === key);
    if (!m) return;
    if (m.tipo === 'ingreso') openRecargaModal(m);
    else openGastoModal(m);
  }

  function attachRowListeners(container) {
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => confirmDelete(btn.dataset.key));
    });
    container.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => openEdit(btn.dataset.key));
    });
  }

  function renderTable(data) {
    const tbody = document.getElementById('movimientos-tbody');
    tbody.innerHTML = '';
    data.forEach(m => {
      const isIngreso = m.tipo === 'ingreso';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtFecha(m.fecha)}</td>
        <td><span class="caja-badge ${isIngreso ? 'caja-badge-ingreso' : 'caja-badge-gasto'}">${isIngreso ? 'Ingreso' : 'Gasto'}</span></td>
        <td>${m.categoria || '—'}</td>
        <td>${m.proveedor || '—'}</td>
        <td>${m.descripcion || '—'}</td>
        <td class="text-right" style="font-weight:700;color:${isIngreso ? 'var(--success)' : 'var(--danger)'};">${isIngreso ? '+' : '-'}${fmtMonto(m.monto || 0)}</td>
        <td style="text-align:center;white-space:nowrap;">${driveLink(m)} ${editBtn(m.key)} ${deleteBtn(m.key)}</td>
      `;
      tbody.appendChild(tr);
    });
    attachRowListeners(tbody);
  }

  function renderCards(data) {
    const container = document.getElementById('movimientos-cards');
    container.innerHTML = '';
    data.forEach(m => {
      const isIngreso = m.tipo === 'ingreso';
      const div = document.createElement('div');
      div.className = 'caja-mov-card';
      div.innerHTML = `
        <div class="caja-mov-card-top">
          <div>
            <span class="caja-badge ${isIngreso ? 'caja-badge-ingreso' : 'caja-badge-gasto'}">${isIngreso ? 'Ingreso' : 'Gasto'}</span>
            ${m.categoria ? `<span class="caja-cat-tag">${m.categoria}</span>` : ''}
          </div>
          <span class="caja-mov-monto" style="color:${isIngreso ? 'var(--success)' : 'var(--danger)'};">${isIngreso ? '+' : '-'}${fmtMonto(m.monto || 0)}</span>
        </div>
        <div class="caja-mov-desc">${m.descripcion || '—'}</div>
        ${m.proveedor ? `<div class="caja-mov-prov">${m.proveedor}</div>` : ''}
        <div class="caja-mov-foot">
          <span class="caja-mov-fecha">${fmtFecha(m.fecha)}</span>
          <div style="display:flex;gap:4px;">${driveLink(m)} ${editBtn(m.key)} ${deleteBtn(m.key)}</div>
        </div>
      `;
      container.appendChild(div);
    });
    attachRowListeners(container);
  }

  async function confirmDelete(key) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    const mesMov = movimientos.find(m => m.key === key)?.fecha?.substring(0, 7);
    try {
      await deleteCajaMovimiento(targetCodigo, key);
      showToast('Movimiento eliminado', 'success');
      await loadMovimientos();
      sincronizarExcel(mesMov);
    } catch (_) {
      showToast('Error al eliminar', 'error');
    }
  }

  document.getElementById('filter-mes').addEventListener('change', renderMovimientos);
  window.addEventListener('resize', renderMovimientos);

  // ─── Gasto (Egreso) modal ────────────────────────────
  let gastoFile  = null;
  let editGasto  = null;   // movimiento en edición (o null al crear)

  function openGastoModal(mov) {
    editGasto = mov || null;
    gastoFile = null;
    document.getElementById('gasto-file').value        = '';
    document.getElementById('gasto-camera').value      = '';
    document.getElementById('gasto-file-name').classList.add('hidden');
    document.getElementById('gasto-categoria').value   = mov?.categoria   || '';
    document.getElementById('gasto-fecha').value       = mov?.fecha       || new Date().toISOString().split('T')[0];
    document.getElementById('gasto-proveedor').value   = mov?.proveedor   || '';
    document.getElementById('gasto-descripcion').value = mov?.descripcion || '';
    document.getElementById('gasto-monto').value       = mov ? String(mov.monto ?? '').replace('.', ',') : '';
    document.getElementById('gasto-error').classList.add('hidden');
    document.getElementById('modal-gasto-title').textContent = mov ? 'Editar Egreso' : 'Registrar Egreso';
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      document.getElementById('btn-gasto-camera').style.display = '';
    }
    document.getElementById('modal-gasto').classList.remove('hidden');
  }

  function closeGastoModal() {
    document.getElementById('modal-gasto').classList.add('hidden');
    gastoFile = null;
    editGasto = null;
  }

  document.getElementById('btn-nuevo-gasto').addEventListener('click', () => openGastoModal());
  document.getElementById('modal-gasto-close').addEventListener('click', closeGastoModal);
  document.getElementById('btn-gasto-cancelar').addEventListener('click', closeGastoModal);
  document.getElementById('modal-gasto').addEventListener('click', e => { if (e.target === e.currentTarget) closeGastoModal(); });

  document.getElementById('btn-gasto-archivo').addEventListener('click', () => document.getElementById('gasto-file').click());
  document.getElementById('btn-gasto-camera').addEventListener('click', () => document.getElementById('gasto-camera').click());

  function handleFileSelected(file) {
    if (!file) return;
    gastoFile = file;
    const nameEl = document.getElementById('gasto-file-name');
    nameEl.textContent = file.name;
    nameEl.classList.remove('hidden');
  }

  document.getElementById('gasto-file').addEventListener('change',   e => handleFileSelected(e.target.files[0]));
  document.getElementById('gasto-camera').addEventListener('change', e => handleFileSelected(e.target.files[0]));

  document.getElementById('btn-gasto-guardar').addEventListener('click', async () => {
    const errorEl     = document.getElementById('gasto-error');
    errorEl.classList.add('hidden');

    const categoria   = document.getElementById('gasto-categoria').value;
    const fecha       = document.getElementById('gasto-fecha').value;
    const proveedor   = document.getElementById('gasto-proveedor').value.trim();
    const descripcion = document.getElementById('gasto-descripcion').value.trim();
    const monto       = parseMonto(document.getElementById('gasto-monto').value);

    if (!categoria)   { errorEl.textContent = 'Seleccioná una categoría.';   errorEl.classList.remove('hidden'); return; }
    if (!fecha)       { errorEl.textContent = 'Ingresá la fecha.';           errorEl.classList.remove('hidden'); return; }
    if (!descripcion) { errorEl.textContent = 'Ingresá una descripción.';    errorEl.classList.remove('hidden'); return; }
    if (!monto || monto <= 0) { errorEl.textContent = 'Ingresá un monto válido.'; errorEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('btn-gasto-guardar');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const mov = { tipo: 'gasto', categoria, proveedor: proveedor || null, descripcion, fecha, monto };

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
        showToast('Comprobante no se pudo subir a Drive', 'warning');
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
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Guardar Egreso';
  });

  // ─── Recarga (Ingreso) modal ─────────────────────────
  let editIngreso = null;   // movimiento en edición (o null al crear)

  const MESES_LBL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function openRecargaModal(mov) {
    editIngreso = mov || null;
    const sel = document.getElementById('recarga-mes');
    sel.innerHTML = '';
    const now = new Date();
    const meses = [];
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      meses.push(d.toISOString().substring(0, 7));
    }
    const editMes = mov?.fecha?.substring(0, 7);
    if (editMes && !meses.includes(editMes)) meses.push(editMes);
    meses.sort().reverse();
    meses.forEach((val, idx) => {
      const [y, m] = val.split('-');
      const o = document.createElement('option');
      o.value = val;
      o.textContent = `${MESES_LBL[parseInt(m, 10)]} ${y}`;
      o.selected = editMes ? (val === editMes) : (idx === 0);
      sel.appendChild(o);
    });
    // Comentario: lo que sigue al "Recarga {Mes} {Año} — " si existe
    let comentario = '';
    if (mov?.descripcion) {
      const parts = mov.descripcion.split(' — ');
      if (parts.length > 1) comentario = parts.slice(1).join(' — ');
    }
    document.getElementById('recarga-monto').value      = mov ? String(mov.monto ?? '').replace('.', ',') : '';
    document.getElementById('recarga-comentario').value = comentario;
    document.getElementById('recarga-error').classList.add('hidden');
    document.getElementById('modal-recarga-title').textContent = mov ? 'Editar Ingreso' : 'Registrar Ingreso';
    document.getElementById('modal-recarga').classList.remove('hidden');
  }

  function closeRecargaModal() {
    document.getElementById('modal-recarga').classList.add('hidden');
    editIngreso = null;
  }

  // ─── Categorías modal (admin) ─────────────────────────
  let categoriasEdit = [];

  function openCategoriasModal() {
    categoriasEdit = [...categorias];
    renderCategoriasEdit();
    document.getElementById('nueva-categoria').value = '';
    document.getElementById('modal-categorias').classList.remove('hidden');
  }

  function closeCategoriasModal() {
    document.getElementById('modal-categorias').classList.add('hidden');
  }

  function renderCategoriasEdit() {
    const list = document.getElementById('categorias-list');
    list.innerHTML = '';
    categoriasEdit.forEach((c, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:.5rem;';
      row.innerHTML = `
        <span style="flex:1;padding:.4rem .65rem;background:var(--gray-100);border-radius:var(--radius);font-size:.9rem;">${c}</span>
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
    document.getElementById('btn-agregar-categoria').addEventListener('click', () => {
      const input = document.getElementById('nueva-categoria');
      const val   = input.value.trim();
      if (val && !categoriasEdit.includes(val)) {
        categoriasEdit.push(val);
        renderCategoriasEdit();
      }
      input.value = '';
    });
    document.getElementById('nueva-categoria').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-agregar-categoria').click();
    });

    document.getElementById('modal-categorias-close').addEventListener('click', closeCategoriasModal);
    document.getElementById('btn-categorias-cancelar').addEventListener('click', closeCategoriasModal);
    document.getElementById('modal-categorias').addEventListener('click', e => { if (e.target === e.currentTarget) closeCategoriasModal(); });

    document.getElementById('btn-categorias-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('btn-categorias-guardar');
      btn.disabled = true;
      try {
        await saveCategoriasCaja(categoriasEdit);
        categorias = [...categoriasEdit];
        // Refresh select
        const sel = document.getElementById('gasto-categoria');
        sel.innerHTML = '<option value="">— Seleccioná —</option>';
        categorias.forEach(c => {
          const o = document.createElement('option');
          o.value = o.textContent = c;
          sel.appendChild(o);
        });
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
    const mesActual = mes || hoy.toISOString().substring(0, 7);
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
    const R_DET_TTL  = 15 + numCats;
    const R_DET_HDR  = 16 + numCats;
    const R_DET_D0   = 17 + numCats;

    // Filas Excel 1-based para fórmulas
    const XF = (r) => r + 1;
    const detFirst = XF(R_DET_D0);
    const detLast  = XF(R_DET_D0 + filtered.length - 1);
    const hasData  = filtered.length > 0;

    const dr = (col) => hasData ? `$${col}$${detFirst}:$${col}$${detLast}` : `$${col}$${detFirst}:$${col}$${detFirst}`;
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
    const E = ['', '', '', '', '', ''];
    const rows = [];
    rows[R_TITLE]   = [`VIMECO S.A. — Caja Chica`, ...E.slice(1)];
    rows[R_USER]    = [`Usuario: ${targetNombre}`,  ...E.slice(1)];
    rows[R_PERIODO] = [`Período: ${periodo}`,        ...E.slice(1)];
    rows[R_GEN]     = [`Generado: ${hoy.toLocaleDateString('es-AR')}`, ...E.slice(1)];
    rows[4]         = [...E];
    rows[R_RESUMEN] = [`RESUMEN — ${periodo}`, ...E.slice(1)];
    rows[R_EXC]     = ['Excedente anterior', valExc, '', '', '', ''];
    rows[R_INGR]    = ['Ingresos',  f(valIngr,        sumif('Ingreso', 'F')),          '', '', '', ''];
    rows[R_GAST]    = ['Gastos',    f(valGast,         hasData ? `ABS(${sumif('Gasto','F')})` : '0'), '', '', '', ''];
    rows[R_SALDO]   = ['Saldo',     f(valExc+valIngr-valGast, `B${XF(R_EXC)}+B${XF(R_INGR)}-B${XF(R_GAST)}`), '', '', '', ''];
    rows[10]        = [...E];
    rows[R_CAT_TTL] = [`GASTOS POR CATEGORÍA`, ...E.slice(1)];
    rows[R_CAT_HDR] = ['Categoría', 'Monto ($)', '', '', '', ''];
    cats.forEach(([cat, val], i) => {
      const fCat = hasData ? `ABS(SUMIF(${dr('C')},"${cat.replace(/"/g,'""')}",${dr('F')}))` : '0';
      rows[R_CAT_D0 + i] = [cat, f(val, fCat), '', '', '', ''];
    });
    const catSumFormula = numCats > 0 ? `SUM(B${XF(R_CAT_D0)}:B${XF(R_CAT_D0 + numCats - 1)})` : '0';
    rows[R_CAT_TOT] = ['TOTAL GASTOS', f(valGast, catSumFormula), '', '', '', ''];
    rows[14 + numCats] = [...E];
    rows[R_DET_TTL] = [`DETALLE — ${periodo}`, ...E.slice(1)];
    rows[R_DET_HDR] = ['Fecha', 'Tipo', 'Categoría', 'Proveedor', 'Descripción', 'Monto ($)'];
    filtered.forEach((mv, i) => {
      rows[R_DET_D0 + i] = [
        mv.fecha       || '',
        mv.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        mv.categoria   || '',
        mv.proveedor   || '',
        mv.descripcion || '',
        mv.tipo === 'ingreso' ? (mv.monto || 0) : -(mv.monto || 0)
      ];
    });

    // ─── Libro ──────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 26 }, { wch: 36 }, { wch: 14 }];

    ws['!merges'] = [
      R_TITLE, R_USER, R_PERIODO, R_GEN, R_RESUMEN, R_CAT_TTL, R_DET_TTL
    ].map(r => ({ s: { r, c: 0 }, e: { r, c: 5 } }));

    ws['!rows'] = [];
    ws['!rows'][R_TITLE]   = { hpt: 22 };
    ws['!rows'][R_RESUMEN] = ws['!rows'][R_CAT_TTL] = ws['!rows'][R_DET_TTL] = { hpt: 18 };

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
    [R_RESUMEN, R_CAT_TTL, R_DET_TTL].forEach(r =>
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
    // Cabecera tabla detalle
    for (let c = 0; c < 6; c++)
      cs(R_DET_HDR, c, { font: { bold: true, sz: 10, color: { rgb: WHITE } }, fill: solid(TEAL), border: thin(), alignment: { horizontal: c === 5 ? 'right' : 'left' } });
    // Filas detalle
    filtered.forEach((mv, i) => {
      const bg = i % 2 === 0 ? WHITE : LGRAY;
      const isI = mv.tipo === 'ingreso';
      for (let c = 0; c < 6; c++)
        cs(R_DET_D0 + i, c, c === 5
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

  // ─── Helper: parse monto ─────────────────────────────
  function parseMonto(str) {
    if (!str) return 0;
    const n = parseFloat(str.replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  // ─── Init ────────────────────────────────────────────
  await loadCategorias();
  await loadMovimientos();
});
