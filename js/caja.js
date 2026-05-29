/* global getCajaMovimientos, saveCajaMovimiento, deleteCajaMovimiento,
          getCategoriasCaja, saveCategoriasCaja, getAllUsuarios,
          extractFromTicket, uploadToCajaDrive */

document.addEventListener('DOMContentLoaded', async () => {

  // ─── Auth ────────────────────────────────────────────
  const session = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch(_) { return null; } })();
  if (!session?.codigo) { window.location.href = 'index.html'; return; }
  if (session.codigo !== '0000') { window.location.href = 'menu.html'; return; }

  const userCodigo = session.codigo;
  const userNombre = session.nombre;
  const isAdmin    = true;

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

  // ─── Header ──────────────────────────────────────────
  document.getElementById('hdr-name').textContent = userNombre;

  document.getElementById('btn-menu').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('hdr-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', () => document.getElementById('hdr-dropdown').classList.add('hidden'));
  document.getElementById('btn-inicio').addEventListener('click', () => { window.location.href = 'menu.html'; });
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
      categorias = ['Materiales', 'Combustible', 'Herramientas', 'Alimentación', 'Transporte', 'Servicios', 'Otros'];
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

  // ─── Admin setup ─────────────────────────────────────
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

    document.getElementById('btn-recarga').addEventListener('click', openRecargaModal);
    document.getElementById('modal-recarga-close').addEventListener('click', closeRecargaModal);
    document.getElementById('btn-recarga-cancelar').addEventListener('click', closeRecargaModal);
    document.getElementById('modal-recarga').addEventListener('click', e => { if (e.target === e.currentTarget) closeRecargaModal(); });

    document.getElementById('btn-recarga-guardar').addEventListener('click', async () => {
      const errorEl    = document.getElementById('recarga-error');
      const descripcion = document.getElementById('recarga-descripcion').value.trim();
      const monto       = parseMonto(document.getElementById('recarga-monto').value);
      errorEl.classList.add('hidden');

      if (!monto || monto <= 0) {
        errorEl.textContent = 'Ingresá un monto válido.';
        errorEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-recarga-guardar');
      btn.disabled = true;
      try {
        await saveCajaMovimiento(targetCodigo, {
          tipo:        'ingreso',
          descripcion: descripcion || 'Recarga',
          fecha:       new Date().toISOString().split('T')[0],
          monto
        });
        closeRecargaModal();
        showToast('Recarga registrada', 'success');
        loadMovimientos();
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

    document.getElementById('saldo-usuario-nombre').textContent = isAdmin ? targetNombre : '';

    try {
      movimientos = await getCajaMovimientos(targetCodigo);
    } catch (err) {
      movimientos = [];
      showToast('Error al cargar movimientos: ' + (err.message || err), 'error');
    }

    elLoad.style.display = 'none';

    // Rebuild month filter
    const meses = [...new Set(movimientos.map(m => m.fecha?.substring(0, 7)).filter(Boolean))].sort().reverse();
    const prevFilter = document.getElementById('filter-mes').value;
    const filterSel  = document.getElementById('filter-mes');
    filterSel.innerHTML = '<option value="">Todos los movimientos</option>';
    const MESES = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach(mes => {
      const [y, m] = mes.split('-');
      const o = document.createElement('option');
      o.value = mes;
      o.textContent = `${MESES[parseInt(m, 10)]} ${y}`;
      filterSel.appendChild(o);
    });
    if (prevFilter) filterSel.value = prevFilter;

    renderMovimientos();
  }

  function renderMovimientos() {
    const mesFilter = document.getElementById('filter-mes').value;
    const filtered  = mesFilter ? movimientos.filter(m => m.fecha?.startsWith(mesFilter)) : movimientos;

    // Balance always from full history
    const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const totalGastos   = movimientos.filter(m => m.tipo === 'gasto').reduce((s, m)  => s + (m.monto || 0), 0);
    const saldo         = totalIngresos - totalGastos;

    document.getElementById('val-ingresos').textContent = fmtMonto(totalIngresos);
    document.getElementById('val-gastos').textContent   = fmtMonto(totalGastos);
    const valSaldoEl = document.getElementById('val-saldo');
    valSaldoEl.textContent = fmtMonto(saldo);
    valSaldoEl.style.color = saldo >= 0 ? 'var(--success)' : 'var(--danger)';

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

  function attachDeleteListeners(container) {
    container.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', () => confirmDelete(btn.dataset.key));
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
        <td style="text-align:center;white-space:nowrap;">${driveLink(m)} ${deleteBtn(m.key)}</td>
      `;
      tbody.appendChild(tr);
    });
    attachDeleteListeners(tbody);
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
          <div style="display:flex;gap:4px;">${driveLink(m)} ${deleteBtn(m.key)}</div>
        </div>
      `;
      container.appendChild(div);
    });
    attachDeleteListeners(container);
  }

  async function confirmDelete(key) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await deleteCajaMovimiento(targetCodigo, key);
      showToast('Movimiento eliminado', 'success');
      loadMovimientos();
    } catch (_) {
      showToast('Error al eliminar', 'error');
    }
  }

  document.getElementById('filter-mes').addEventListener('change', renderMovimientos);
  window.addEventListener('resize', renderMovimientos);

  // ─── Gasto modal ─────────────────────────────────────
  let gastoFile = null;

  function openGastoModal() {
    gastoFile = null;
    document.getElementById('gasto-file').value        = '';
    document.getElementById('gasto-camera').value      = '';
    document.getElementById('gasto-file-name').classList.add('hidden');
    document.getElementById('gasto-extract-status').classList.add('hidden');
    document.getElementById('btn-gasto-analizar').disabled = true;
    document.getElementById('gasto-categoria').value   = '';
    document.getElementById('gasto-fecha').value       = new Date().toISOString().split('T')[0];
    document.getElementById('gasto-proveedor').value   = '';
    document.getElementById('gasto-descripcion').value = '';
    document.getElementById('gasto-monto').value       = '';
    document.getElementById('gasto-error').classList.add('hidden');
    if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      document.getElementById('btn-gasto-camera').style.display = '';
    }
    document.getElementById('modal-gasto').classList.remove('hidden');
  }

  function closeGastoModal() {
    document.getElementById('modal-gasto').classList.add('hidden');
    gastoFile = null;
  }

  document.getElementById('btn-nuevo-gasto').addEventListener('click', openGastoModal);
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
    document.getElementById('btn-gasto-analizar').disabled = false;
    document.getElementById('gasto-extract-status').classList.add('hidden');
  }

  document.getElementById('gasto-file').addEventListener('change',   e => handleFileSelected(e.target.files[0]));
  document.getElementById('gasto-camera').addEventListener('change', e => handleFileSelected(e.target.files[0]));

  document.getElementById('btn-gasto-analizar').addEventListener('click', async () => {
    if (!gastoFile) return;
    const statusEl = document.getElementById('gasto-extract-status');
    const btn      = document.getElementById('btn-gasto-analizar');
    btn.disabled = true;
    statusEl.className = 'extract-status loading';
    statusEl.classList.remove('hidden');
    statusEl.innerHTML = '<div class="spinner"></div> Analizando comprobante…';

    try {
      const r = await extractFromTicket(gastoFile);
      if (r.proveedor)   document.getElementById('gasto-proveedor').value   = r.proveedor;
      if (r.descripcion) document.getElementById('gasto-descripcion').value = r.descripcion;
      if (r.fecha)       document.getElementById('gasto-fecha').value       = r.fecha;
      if (r.monto_total) document.getElementById('gasto-monto').value       = r.monto_total.toFixed(2).replace('.', ',');
      if (r.categoria_sugerida) {
        const sel = document.getElementById('gasto-categoria');
        for (const opt of sel.options) {
          if (opt.value.toLowerCase() === r.categoria_sugerida.toLowerCase()) { sel.value = opt.value; break; }
        }
      }
      statusEl.className = 'extract-status success';
      statusEl.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Datos extraídos — revisá y confirmá.';
    } catch (err) {
      statusEl.className = 'extract-status error';
      statusEl.textContent = 'Error al analizar: ' + (err.message || 'Intentá de nuevo');
    }
    btn.disabled = false;
  });

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
        const res = await uploadToCajaDrive(gastoFile, {
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
      await saveCajaMovimiento(targetCodigo, mov);
      closeGastoModal();
      showToast('Gasto registrado', 'success');
      loadMovimientos();
    } catch (err) {
      errorEl.textContent = 'Error al guardar: ' + (err.message || err);
      errorEl.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Guardar Gasto';
  });

  // ─── Recarga modal ───────────────────────────────────
  function openRecargaModal() {
    document.getElementById('recarga-descripcion').value = '';
    document.getElementById('recarga-monto').value       = '';
    document.getElementById('recarga-error').classList.add('hidden');
    document.getElementById('modal-recarga').classList.remove('hidden');
  }

  function closeRecargaModal() {
    document.getElementById('modal-recarga').classList.add('hidden');
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

  // ─── Exportar Excel ──────────────────────────────────
  document.getElementById('btn-exportar-excel').addEventListener('click', exportarExcel);

  async function exportarExcel() {
    const btn = document.getElementById('btn-exportar-excel');
    btn.disabled = true;
    btn.textContent = 'Generando…';

    // Lazy-load SheetJS solo cuando se necesita
    if (!window.XLSX) {
      try {
        await new Promise((resolve, reject) => {
          const s    = document.createElement('script');
          s.src      = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
          s.onload  = resolve;
          s.onerror = () => reject(new Error('No se pudo cargar la librería de Excel. Verificá tu conexión.'));
          document.head.appendChild(s);
        });
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Exportar Excel';
        return;
      }
    }

    const MESES = ['', 'Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const mesFilter    = document.getElementById('filter-mes').value;
    const filtered     = mesFilter ? movimientos.filter(m => m.fecha?.startsWith(mesFilter)) : movimientos;
    const periodoLabel = mesFilter
      ? (() => { const [y, m] = mesFilter.split('-'); return `${MESES[parseInt(m, 10)]} ${y}`; })()
      : 'Todos los movimientos';

    // ─── Datos para la hoja ─────────────────────────────
    const rows = [];

    // Encabezado
    rows.push(['VIMECO S.A. — Caja Chica']);
    rows.push([`Usuario: ${targetNombre}`]);
    rows.push([`Período: ${periodoLabel}`]);
    rows.push([`Generado: ${new Date().toLocaleDateString('es-AR')}`]);
    rows.push([]);

    // Balance acumulado (siempre sobre total histórico)
    const totalIngresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const totalGastos   = movimientos.filter(m => m.tipo === 'gasto').reduce((s, m)  => s + (m.monto || 0), 0);
    rows.push(['BALANCE ACUMULADO']);
    rows.push(['Ingresos totales', totalIngresos]);
    rows.push(['Gastos totales',   totalGastos]);
    rows.push(['Saldo actual',     totalIngresos - totalGastos]);
    rows.push([]);

    // Gastos por categoría (período filtrado)
    const gastosFiltrados = filtered.filter(m => m.tipo === 'gasto');
    const porCategoria    = {};
    gastosFiltrados.forEach(m => {
      const c = m.categoria || 'Sin categoría';
      porCategoria[c] = (porCategoria[c] || 0) + (m.monto || 0);
    });
    const ingresosFiltrados = filtered.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
    const gastosTotalFiltrado = gastosFiltrados.reduce((s, m) => s + (m.monto || 0), 0);

    rows.push([`RESUMEN DEL PERÍODO — ${periodoLabel}`]);
    rows.push(['Ingresos del período', ingresosFiltrados]);
    rows.push([]);
    rows.push(['GASTOS POR CATEGORÍA']);
    rows.push(['Categoría', 'Monto ($)']);
    Object.entries(porCategoria)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, monto]) => rows.push([cat, monto]));
    rows.push(['TOTAL GASTOS', gastosTotalFiltrado]);
    rows.push([]);

    // Detalle de movimientos
    rows.push([`DETALLE DE MOVIMIENTOS — ${periodoLabel}`]);
    rows.push(['Fecha', 'Tipo', 'Categoría', 'Proveedor', 'Descripción', 'Monto ($)']);
    filtered.forEach(m => {
      rows.push([
        m.fecha        || '',
        m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        m.categoria    || '',
        m.proveedor    || '',
        m.descripcion  || '',
        m.tipo === 'ingreso' ? (m.monto || 0) : -(m.monto || 0)
      ]);
    });

    // ─── Crear libro y hoja ──────────────────────────────
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Ancho de columnas
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 28 }, { wch: 38 }, { wch: 15 }];

    // Negrita en filas de título/sección (filas impares de sección)
    const boldRows = [0, 5, 15, rows.length - filtered.length - 2]; // títulos principales
    boldRows.forEach(r => {
      const cellAddr = XLSX.utils.encode_cell({ r, c: 0 });
      if (ws[cellAddr]) {
        if (!ws[cellAddr].s) ws[cellAddr].s = {};
        ws[cellAddr].s.font = { bold: true };
      }
    });

    const sheetName = periodoLabel === 'Todos los movimientos' ? 'Caja Chica' : periodoLabel.substring(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // ─── Descargar localmente ────────────────────────────
    const safeName   = targetNombre.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const safePeriod = periodoLabel.replace(/\s+/g, '_');
    const fileName   = `Caja_${safeName}_${safePeriod}.xlsx`;
    XLSX.writeFile(wb, fileName);

    // ─── Subir a Drive ───────────────────────────────────
    if (typeof uploadToCajaDrive === 'function') {
      btn.textContent = 'Subiendo a Drive…';
      try {
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const file  = new File([blob], fileName, { type: blob.type });
        const fechaDrive = mesFilter ? mesFilter + '-01' : new Date().toISOString().split('T')[0];
        await uploadToCajaDrive(file, {
          userId:   targetCodigo,
          userName: targetNombre,
          fecha:    fechaDrive,
          tipo:     'planilla'
        });
        showToast('Planilla guardada en Drive', 'success');
      } catch (_) {
        showToast('Descargado localmente — no se pudo subir a Drive', 'warning');
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Exportar Excel';
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
