/* =====================================================
   VIMECO S.A. — PDF de la Caja Chica de un mes
   cajaPDF.js

   A4 vertical: encabezado con la caja y el período, franja con el balance
   (excedente anterior, ingresos, egresos, saldo), egresos por obra y por
   categoría, y el detalle de movimientos con saldo corrido. Si el mes está
   cerrado, el documento lo dice y lleva las firmas de rendición.

   Recibe los montos como números y los formatea acá (ver generateCajaBlob).
   ===================================================== */

/* global LOGO_BASE64 */

(function () {
  const AZUL = [43, 57, 70], AZUL_MED = [61, 81, 102], GRIS = [242, 242, 242], BORDE = [170, 170, 170];
  const BLANCO = [255, 255, 255], NEGRO = [20, 20, 20], VERDE = [26, 127, 60], ROJO = [176, 42, 42], TENUE = [120, 128, 138];
  const CUIT = '30-50424533-7';

  const P = { w: 210, h: 297, ml: 12, mt: 12, mb: 16, get cw() { return this.w - 2 * this.ml; }, get maxY() { return this.h - this.mb; } };

  // Detalle: suman 186 mm (P.cw)
  const COLS  = [17, 52, 38, 26, 13, 20, 20];
  const HEAD  = ['Fecha', 'Descripción', 'Obra', 'Categoría', 'Comp.', 'Monto', 'Saldo'];
  const ALIGN = ['left', 'left', 'left', 'left', 'center', 'right', 'right'];
  const ROW_H = 5.6;

  // $ 1.234,56 — con "-" ASCII: el "−" tipográfico no está en la fuente estándar del PDF.
  function money(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const s = Math.abs(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (v < 0 ? '-' : '') + '$ ' + s;
  }
  const fecha = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  /*  data = {
        caja:       'Nombre de quien tiene la caja',
        periodo:    'Octubre 2026',
        excedente, ingresos, egresos, saldo,          // números
        porObra:    [[label, monto]], porCat: [[label, monto]],
        movs:       [{ fecha, tipo, descripcion, obra, categoria, proveedor, monto, comp }]  // orden ascendente
        cierre:     null | { por: 'Nombre', fecha: '09/10/2026 14:32' },
        generado:   '09/10/2026 14:32'
      }  */
  function build(data) {
    const J = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!J) throw new Error('jsPDF no está disponible');
    const doc = new J({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    let y = header(doc, data);
    y = kpis(doc, data, y + 4);
    y = tops(doc, data, y + 5);
    y = tabla(doc, data, y + 6);
    if (data.cierre) firmas(doc, data, y + 6);
    pies(doc, data);
    return doc;
  }

  function header(doc, data) {
    const x0 = P.ml, y = P.mt, H = 24;
    doc.setFillColor(...AZUL);
    doc.rect(x0, y, P.cw, H, 'F');

    const logo = typeof LOGO_BASE64 !== 'undefined' ? LOGO_BASE64 : null;
    if (logo) {
      try {
        const lw = 40, lh = lw * 82 / 400;
        doc.setFillColor(...BLANCO);
        doc.rect(x0 + 3, y + 3, lw + 6, H - 6, 'F');
        doc.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', x0 + 6, y + (H - lh) / 2, lw, lh);
      } catch (_) {}
    }

    const xt = x0 + 55;
    doc.setTextColor(...BLANCO);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(data.cierre ? 'CIERRE DE CAJA CHICA' : 'CAJA CHICA', xt, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(fit(doc, `Caja de ${data.caja}`, P.cw - 60), xt, y + 15);
    doc.text(`Período: ${data.periodo}`, xt, y + 20);

    if (data.cierre) {
      // Sello "CERRADO" a la derecha de la franja
      const w = 34, xs = x0 + P.cw - w - 4;
      doc.setDrawColor(...BLANCO);
      doc.setLineWidth(0.5);
      doc.rect(xs, y + 5, w, 14, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('CERRADO', xs + w / 2, y + 11, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(String(data.cierre.fecha).substring(0, 10), xs + w / 2, y + 16, { align: 'center' });
    }
    return y + H;
  }

  function kpis(doc, data, y) {
    const items = [
      { lbl: 'Excedente anterior', val: data.excedente, color: data.excedente < 0 ? ROJO : AZUL },
      { lbl: 'Ingresos del mes',   val: data.ingresos,  color: VERDE },
      { lbl: 'Egresos del mes',    val: -data.egresos,  color: ROJO },
      { lbl: 'Saldo',              val: data.saldo,     color: data.saldo < 0 ? ROJO : AZUL, fuerte: true }
    ];
    const gap = 3, w = (P.cw - gap * 3) / 4, H = 16;
    items.forEach((k, i) => {
      const x = P.ml + i * (w + gap);
      doc.setFillColor(...(k.fuerte ? [214, 228, 240] : GRIS));
      doc.rect(x, y, w, H, 'F');
      doc.setFillColor(...k.color);
      doc.rect(x, y, 1.4, H, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...TENUE);
      doc.text(k.lbl.toUpperCase(), x + 4, y + 5.5);
      doc.setFontSize(12);
      doc.setTextColor(...k.color);
      doc.text(fit(doc, money(k.val), w - 6), x + 4, y + 12);
    });
    return y + H;
  }

  function tops(doc, data, y) {
    const cols = [{ t: 'Egresos por obra', rows: data.porObra }, { t: 'Egresos por categoría', rows: data.porCat }];
    if (!cols.some(c => c.rows.length)) return y;
    const gap = 5, w = (P.cw - gap) / 2;
    const filas = Math.max(1, ...cols.map(c => c.rows.length));
    const H = 6 + filas * 5 + 1.5;
    cols.forEach((col, i) => {
      const x = P.ml + i * (w + gap);
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.3);
      doc.rect(x, y, w, H, 'S');
      doc.setFillColor(...AZUL);
      doc.rect(x, y, w, 6, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...BLANCO);
      doc.text(col.t.toUpperCase(), x + 3, y + 4.1);
      if (!col.rows.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...TENUE);
        doc.text('Sin egresos en el mes.', x + 3, y + 9.6);
      }
      col.rows.forEach(([label, val], j) => {
        const ry = y + 6 + j * 5;
        if (j % 2) { doc.setFillColor(248, 249, 251); doc.rect(x + 0.4, ry, w - 0.8, 5, 'F'); }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...NEGRO);
        doc.text(fit(doc, label, w - 34), x + 3, ry + 3.6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...AZUL);
        doc.text(money(val), x + w - 3, ry + 3.6, { align: 'right' });
      });
    });
    return y + H;
  }

  function tabla(doc, data, y) {
    const xs = [P.ml];
    COLS.slice(1).forEach((_, i) => xs.push(xs[i] + COLS[i]));
    const movs = data.movs || [];

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...AZUL);
    doc.text(`Movimientos del mes (${movs.length})`, P.ml, y);
    y += 3;

    // Primera fila: el excedente que viene de los meses anteriores
    y = cabecera(doc, xs, y);
    let saldo = data.excedente;
    fila(doc, xs, y, ['', 'Excedente anterior', '', '', '', '', money(saldo)], false, true);
    y += ROW_H;

    if (!movs.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TENUE);
      doc.text('No hay movimientos en el mes.', P.ml + 1.5, y + 4);
      y += ROW_H;
    }

    movs.forEach((m, i) => {
      if (y + ROW_H > P.maxY) { doc.addPage(); y = cabecera(doc, xs, P.mt); }
      const ing = m.tipo === 'ingreso';
      saldo += ing ? m.monto : -m.monto;
      const desc = ing ? (m.descripcion || 'Ingreso') : [m.descripcion, m.proveedor].filter(Boolean).join(' · ') || '—';
      fila(doc, xs, y, [
        fecha(m.fecha), desc, ing ? '' : (m.obra || 'Sin obra'), ing ? 'Ingreso' : (m.categoria || '—'),
        ing ? '' : (m.comp ? 'Sí' : 'No'), money(ing ? m.monto : -m.monto), money(saldo)
      ], i % 2 === 1, false, ing);
      y += ROW_H;
    });

    if (y + 7 > P.maxY) { doc.addPage(); y = P.mt; }
    doc.setFillColor(...AZUL);
    doc.rect(P.ml, y, P.cw, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLANCO);
    doc.text(`SALDO AL CIERRE DE ${data.periodo.toUpperCase()}`, P.ml + 3, y + 4.7);
    doc.setFontSize(10);
    doc.text(money(data.saldo), P.ml + P.cw - 3, y + 4.8, { align: 'right' });
    return y + 7;
  }

  function cabecera(doc, xs, y) {
    doc.setFillColor(...AZUL_MED);
    doc.rect(P.ml, y, P.cw, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BLANCO);
    HEAD.forEach((h, c) => doc.text(h.toUpperCase(), tx(xs[c], COLS[c], ALIGN[c]), y + 4, { align: ALIGN[c] }));
    return y + 6;
  }

  function fila(doc, xs, y, vals, par, gris, ing) {
    if (par || gris) { doc.setFillColor(...(gris ? GRIS : [248, 249, 251])); doc.rect(P.ml, y, P.cw, ROW_H, 'F'); }
    vals.forEach((v, c) => {
      doc.setFont('helvetica', c >= 5 || gris ? 'bold' : 'normal');
      doc.setFontSize(7.5);
      if (c === 5) doc.setTextColor(...(ing ? VERDE : ROJO));
      else if (c === 4 && v === 'No') doc.setTextColor(...ROJO);
      else if (c === 6 && String(v).startsWith('-')) doc.setTextColor(...ROJO);
      else doc.setTextColor(...NEGRO);
      doc.text(fit(doc, String(v ?? ''), COLS[c] - 3), tx(xs[c], COLS[c], ALIGN[c]), y + 3.8, { align: ALIGN[c] });
    });
    doc.setDrawColor(225, 229, 234);
    doc.setLineWidth(0.2);
    doc.line(P.ml, y + ROW_H, P.ml + P.cw, y + ROW_H);
  }

  function firmas(doc, data, y) {
    if (y + 30 > P.maxY) { doc.addPage(); y = P.mt + 10; }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...TENUE);
    doc.text(`Mes cerrado por ${data.cierre.por} el ${data.cierre.fecha}.`, P.ml, y);
    const w = 70, yl = y + 22;
    [['Rindió', data.caja], ['Controló', '']].forEach(([t, n], i) => {
      const x = i ? P.ml + P.cw - w : P.ml;
      doc.setDrawColor(...NEGRO);
      doc.setLineWidth(0.3);
      doc.line(x, yl, x + w, yl);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...NEGRO);
      doc.text(t, x + w / 2, yl + 4.5, { align: 'center' });
      if (n) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...TENUE);
        doc.text(fit(doc, n, w), x + w / 2, yl + 8.5, { align: 'center' });
      }
    });
  }

  function pies(doc, data) {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      const y = P.h - 9;
      doc.setDrawColor(...BORDE);
      doc.setLineWidth(0.3);
      doc.line(P.ml, y - 3, P.ml + P.cw, y - 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...TENUE);
      doc.text(fit(doc, `VIMECO S.A. · CUIT ${CUIT} · Caja de ${data.caja} · ${data.periodo} · generado el ${data.generado}`, 150), P.ml, y);
      doc.text(`Página ${p} de ${total}`, P.ml + P.cw, y, { align: 'right' });
    }
  }

  function fit(doc, txt, w) {
    const s = String(txt ?? '');
    if (!s || doc.getTextWidth(s) <= w) return s;
    let out = doc.splitTextToSize(s, w)[0] || s;
    while (out.length > 1 && doc.getTextWidth(out + '…') > w) out = out.slice(0, -1);
    return out + '…';
  }

  function tx(x, w, align) {
    return align === 'right' ? x + w - 1.5 : align === 'center' ? x + w / 2 : x + 1.5;
  }

  window.generateCajaBlob = data => build(data).output('blob');
})();
