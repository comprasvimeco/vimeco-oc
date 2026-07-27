/* VIMECO S.A. — Control de entregas: cálculo y planillas Excel a Drive
 *
 * Dos libros, los dos se pisan a sí mismos en cada sincronización:
 *   COMPRAS/OBRAS/{Obra}/Control de entregas - {Obra}.xlsx   (Resumen / Detalle / Remitos)
 *   …/{fecha | Proveedor}/Entregas - OC {nro}.xlsx           (detalle de esa OC)
 *
 * Requiere: drive.js (uploadOrUpdateFile, getObraFolderId). XLSX se carga
 * diferido desde CDN, igual que en caja.js y personal-obra.js.
 */
(function () {
  'use strict';

  // ── Cálculo (única implementación: la usa también la pantalla) ────────────

  // Estado de entrega de una OC contra sus remitos. El vínculo remito↔renglón
  // es el índice dentro de oc.items: los ítems del historial no tienen id
  // propio y desde v138 las OC no se editan, así que el índice es estable.
  // Los ítems del historial usan la forma {desc, unidad, cant, unitario}.
  window.calcEntrega = function (oc, remitosDeLaOC) {
    const items    = oc.items || [];
    const pedido   = items.map(it => parseFloat(it.cant) || 0);
    const recibido = items.map(() => 0);

    const remitos = (remitosDeLaOC || [])
      .slice()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    remitos.forEach(r => (r.items || []).forEach(it => {
      const i = Number(it.idx);
      if (Number.isInteger(i) && i >= 0 && i < recibido.length)
        recibido[i] += parseFloat(it.cantidad) || 0;
    }));

    const pendiente = pedido.map((p, i) => Math.max(0, p - recibido[i]));
    const completo  = pedido.every((p, i) => recibido[i] >= p);
    const estado    = !remitos.length ? 'sin' : (completo ? 'completa' : 'parcial');

    // Importes valorizados al precio de la OC. El entregado se topea en lo
    // pedido: una sobre-entrega no puede hacer que "llegó" supere al 100%.
    const impPedido = items.reduce((s, it, i) => s + pedido[i] * (parseFloat(it.unitario) || 0), 0);
    const impRecib  = items.reduce((s, it, i) =>
      s + Math.min(recibido[i], pedido[i]) * (parseFloat(it.unitario) || 0), 0);

    // Avance valorizado (una bolsa de cemento y una viga no pesan igual). Sin
    // importes válidos cae a la proporción de renglones completos.
    let pct;
    if (impPedido > 0)        pct = Math.round((impRecib / impPedido) * 100);
    else if (pedido.length)   pct = Math.round((pedido.filter((p, i) => recibido[i] >= p).length / pedido.length) * 100);
    else                      pct = completo ? 100 : 0;

    return { pedido, recibido, pendiente, estado, pct, impPedido, impRecib, remitos };
  };

  // ── Utilidades ────────────────────────────────────────────────────────────

  const ESTADO_TXT = { sin: 'Sin entregas', parcial: 'Parcial', completa: 'Entregada' };

  const isoADisplay = d => {
    const p = String(d || '').split('-');
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (d || '');
  };

  // Nombre de archivo seguro para Drive.
  const limpio = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim();

  async function ensureXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // xlsx-js-style: fork de SheetJS que sí escribe estilos al exportar .xlsx
      s.src     = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar la librería de Excel'));
      document.head.appendChild(s);
    });
  }

  // ── Estilos (mismos colores que las otras planillas de la app) ────────────

  const A     = h => 'FF' + h;
  const NAVY  = A('1A3A5C'), LBLUE = A('D6E4F0'), WHITE = A('FFFFFF');
  const LGRAY = A('F5F7FA'), GREEN = A('E3F5E8'), AMBER = A('FFF4E0'), RED = A('FDE6E6');
  const DARK  = '333333',    BORDC = A('B0BEC5');
  const MONEY = '"$"#,##0.00';
  const QTY   = '#,##0.##';

  const bord  = { style: 'thin', color: { rgb: BORDC } };
  const allb  = () => ({ top: bord, bottom: bord, left: bord, right: bord });
  const solid = rgb => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { indexed: 64 } });

  const stTitulo = () => ({
    font: { bold: true, sz: 13, color: { rgb: WHITE } },
    fill: solid(NAVY), alignment: { horizontal: 'left', vertical: 'center' }
  });
  const stHead = () => ({
    font: { bold: true, sz: 9, color: { rgb: WHITE } },
    fill: solid(NAVY), border: allb(),
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
  });
  const stCell = (bg, opts = {}) => ({
    font: { sz: 10, color: { rgb: DARK }, bold: !!opts.bold },
    fill: bg ? solid(bg) : undefined, border: allb(),
    alignment: { horizontal: opts.align || 'left', vertical: 'center' },
    numFmt: opts.fmt
  });

  const colorEstado = e => (e === 'completa' ? GREEN : e === 'parcial' ? AMBER : null);

  // Escribe una hoja a partir de filas + un mapa de estilos "r,c" → estilo.
  function armarHoja(rows, stmap, cols, merges) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']   = cols;
    if (merges?.length) ws['!merges'] = merges;
    Object.entries(stmap).forEach(([k, s]) => {
      const [r, c] = k.split(',').map(Number);
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = s;
    });
    return ws;
  }

  // ── Datos derivados ───────────────────────────────────────────────────────

  // Qué remitos cubrieron cada renglón: "0012 (12/07: 50) · 0031 (20/07: 30)".
  function detalleRemitos(remitos, idx) {
    return remitos
      .slice()
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .map(r => {
        const it = (r.items || []).find(x => Number(x.idx) === idx);
        return it ? `${r.nro} (${isoADisplay(r.fecha)}: ${it.cantidad})` : null;
      })
      .filter(Boolean)
      .join(' · ');
  }

  function filasDetalle(oc, remitos) {
    const e = calcEntrega(oc, remitos);
    return (oc.items || []).map((it, i) => ({
      nroOC:      oc.nroOC,
      fechaOC:    oc.fecha || '',
      proveedor:  oc.proveedor?.nombre || '',
      item:       it.desc || '',
      unidad:     it.unidad || '',
      pedido:     e.pedido[i],
      entregado:  e.recibido[i],
      diferencia: e.pedido[i] - e.recibido[i],
      impPedido:  e.pedido[i]   * (parseFloat(it.unitario) || 0),
      impEntreg:  Math.min(e.recibido[i], e.pedido[i]) * (parseFloat(it.unitario) || 0),
      remitos:    detalleRemitos(e.remitos, i)
    }));
  }

  // ── Hojas ─────────────────────────────────────────────────────────────────

  function hojaResumen(obra, ocs, porOC) {
    const rows = [[`Control de entregas — ${obra}`], [`Actualizado: ${new Date().toLocaleString('es-AR')}`], []];
    const st   = { '0,0': stTitulo(), '1,0': { font: { italic: true, sz: 9, color: { rgb: DARK } } } };

    const head = ['N° OC', 'Fecha', 'Proveedor', '$ Pedido', '$ Entregado', '% Entregado', 'Estado', 'Último remito', 'Fecha remito'];
    const hr   = rows.push(head) - 1;
    head.forEach((_, c) => { st[`${hr},${c}`] = stHead(); });

    let totPed = 0, totEnt = 0;
    ocs.forEach(oc => {
      const e    = porOC.get(oc.nroOC);
      const ult  = e.remitos[0];
      totPed += e.impPedido; totEnt += e.impRecib;
      const r = rows.push([
        oc.nroOC, oc.fecha || '', oc.proveedor?.nombre || '',
        e.impPedido, e.impRecib, e.pct / 100,
        ESTADO_TXT[e.estado], ult?.nro || '', ult ? isoADisplay(ult.fecha) : ''
      ]) - 1;
      const bg = colorEstado(e.estado);
      st[`${r},0`] = stCell(bg, { bold: true });
      st[`${r},1`] = stCell(bg, { align: 'center' });
      st[`${r},2`] = stCell(bg);
      st[`${r},3`] = stCell(bg, { align: 'right', fmt: MONEY });
      st[`${r},4`] = stCell(bg, { align: 'right', fmt: MONEY });
      st[`${r},5`] = stCell(bg, { align: 'center', fmt: '0%' });
      st[`${r},6`] = stCell(bg, { align: 'center', bold: true });
      st[`${r},7`] = stCell(bg, { align: 'center' });
      st[`${r},8`] = stCell(bg, { align: 'center' });
    });

    const tr = rows.push(['TOTAL', '', '', totPed, totEnt, totPed > 0 ? totEnt / totPed : 0, '', '', '']) - 1;
    for (let c = 0; c <= 8; c++) st[`${tr},${c}`] = stCell(LBLUE, { bold: true, align: c >= 3 ? 'right' : 'left' });
    st[`${tr},3`] = stCell(LBLUE, { bold: true, align: 'right', fmt: MONEY });
    st[`${tr},4`] = stCell(LBLUE, { bold: true, align: 'right', fmt: MONEY });
    st[`${tr},5`] = stCell(LBLUE, { bold: true, align: 'center', fmt: '0%' });

    const cols = [{ wch: 16 }, { wch: 11 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }];
    return armarHoja(rows, st, cols, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }]);
  }

  function hojaDetalle(filas, titulo) {
    const rows = [[titulo], []];
    const st   = { '0,0': stTitulo() };

    const head = ['N° OC', 'Fecha OC', 'Proveedor', 'Ítem', 'Un.', 'Pedido', 'Entregado', 'Diferencia', '$ Pedido', '$ Entregado', 'Remitos'];
    const hr   = rows.push(head) - 1;
    head.forEach((_, c) => { st[`${hr},${c}`] = stHead(); });

    filas.forEach((f, i) => {
      const r  = rows.push([
        f.nroOC, f.fechaOC, f.proveedor, f.item, f.unidad,
        f.pedido, f.entregado, f.diferencia, f.impPedido, f.impEntreg, f.remitos
      ]) - 1;
      // Sólo se pinta lo que hay que mirar: falta (ámbar) o llegó de más (rojo).
      const bg = f.diferencia > 0 ? AMBER : (f.diferencia < 0 ? RED : (i % 2 ? LGRAY : null));
      st[`${r},0`]  = stCell(bg, { bold: true });
      st[`${r},1`]  = stCell(bg, { align: 'center' });
      st[`${r},2`]  = stCell(bg);
      st[`${r},3`]  = stCell(bg);
      st[`${r},4`]  = stCell(bg, { align: 'center' });
      st[`${r},5`]  = stCell(bg, { align: 'right', fmt: QTY });
      st[`${r},6`]  = stCell(bg, { align: 'right', fmt: QTY });
      st[`${r},7`]  = stCell(bg, { align: 'right', fmt: QTY, bold: true });
      st[`${r},8`]  = stCell(bg, { align: 'right', fmt: MONEY });
      st[`${r},9`]  = stCell(bg, { align: 'right', fmt: MONEY });
      st[`${r},10`] = stCell(bg);
    });

    const cols = [{ wch: 16 }, { wch: 11 }, { wch: 26 }, { wch: 40 }, { wch: 6 },
                  { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
    return armarHoja(rows, st, cols, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }]);
  }

  // Movimientos crudos: una fila por (remito, ítem). Es la hoja para filtrar y
  // hacer tablas dinámicas sin depender de lo que calculó la app.
  function hojaRemitos(remitos) {
    const rows = [['Remitos recibidos'], []];
    const st   = { '0,0': stTitulo() };

    const head = ['N° Remito', 'Fecha', 'N° OC', 'Proveedor', 'Ítem', 'Un.', 'Cantidad', 'Recibió', 'Observaciones'];
    const hr   = rows.push(head) - 1;
    head.forEach((_, c) => { st[`${hr},${c}`] = stHead(); });

    remitos
      .slice()
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .forEach(rem => {
        const items = (rem.items || []).length ? rem.items : [{ desc: '(sin ítems)', unidad: '', cantidad: '' }];
        items.forEach((it, i) => {
          const r = rows.push([
            rem.nro || '', isoADisplay(rem.fecha), rem.nroOC || '', rem.proveedor?.nombre || '',
            it.desc || '', it.unidad || '', it.cantidad === '' ? '' : (parseFloat(it.cantidad) || 0),
            rem.recibidoPor?.nombre || '', i === 0 ? (rem.observaciones || '') : ''
          ]) - 1;
          for (let c = 0; c <= 8; c++) st[`${r},${c}`] = stCell(null, { align: c === 1 || c === 5 ? 'center' : 'left' });
          st[`${r},6`] = stCell(null, { align: 'right', fmt: QTY });
        });
      });

    const cols = [{ wch: 16 }, { wch: 11 }, { wch: 16 }, { wch: 26 }, { wch: 40 }, { wch: 6 }, { wch: 10 }, { wch: 20 }, { wch: 30 }];
    return armarHoja(rows, st, cols, [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }]);
  }

  // ── Libros ────────────────────────────────────────────────────────────────

  function libroObra(obra, ocs, remitos) {
    const porOC   = new Map();
    const detalle = [];
    ocs.forEach(oc => {
      const rs = remitos.filter(r => r.nroOC === oc.nroOC);
      porOC.set(oc.nroOC, calcEntrega(oc, rs));
      detalle.push(...filasDetalle(oc, rs));
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hojaResumen(obra, ocs, porOC), 'Resumen');
    XLSX.utils.book_append_sheet(wb, hojaDetalle(detalle, `Detalle por ítem — ${obra}`), 'Detalle');
    XLSX.utils.book_append_sheet(wb, hojaRemitos(remitos.filter(r => ocs.some(o => o.nroOC === r.nroOC))), 'Remitos');
    return wb;
  }

  function libroOC(oc, remitos) {
    const rs = remitos.filter(r => r.nroOC === oc.nroOC);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hojaDetalle(filasDetalle(oc, rs),
      `OC ${oc.nroOC} — ${oc.proveedor?.nombre || ''}`), 'Detalle');
    XLSX.utils.book_append_sheet(wb, hojaRemitos(rs), 'Remitos');
    return wb;
  }

  function aBlob(wb) {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ── Sincronización a Drive ────────────────────────────────────────────────

  /*
   * Regenera y sube las dos planillas de una OC recién actualizada:
   *   - la de su obra (todas las OC de esa obra)
   *   - la de la OC (su carpeta en OBRAS y en PROVEEDORES)
   *
   * `ocs` son todas las OC elegibles; `remitos`, todos los remitos. Devuelve
   * { obra: bool, oc: bool } con qué se pudo subir: el llamador la invoca en
   * segundo plano y no debería romperse porque falle Drive.
   */
  window.sincronizarEntregas = async function ({ oc, ocs, remitos }) {
    await ensureXLSX();
    const obra    = oc.obra || 'Sin obra';
    const deObra  = (ocs || []).filter(o => (o.obra || 'Sin obra') === obra);
    const hecho   = { obra: false, oc: false };

    // Planilla de la obra
    try {
      const blob = aBlob(libroObra(obra, deObra, remitos || []));
      const fid  = await getObraFolderId(obra);
      await uploadOrUpdateFile(blob, `Control de entregas - ${limpio(obra)}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fid);
      hecho.obra = true;
    } catch (e) { console.error('planilla de obra:', e); }

    // Planilla de la OC, en las dos carpetas donde vive la orden
    const carpetas = [oc.drive_folder_obras_id, oc.drive_folder_proveedores_id].filter(Boolean);
    if (carpetas.length) {
      const blob   = aBlob(libroOC(oc, remitos || []));
      const nombre = `Entregas - OC ${limpio(oc.nroOC)}.xlsx`;
      const res = await Promise.allSettled(carpetas.map(fid => uploadOrUpdateFile(
        blob, nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fid)));
      hecho.oc = res.some(r => r.status === 'fulfilled');
      res.filter(r => r.status === 'rejected').forEach(r => console.error('planilla de OC:', r.reason));
    }

    return hecho;
  };
})();
