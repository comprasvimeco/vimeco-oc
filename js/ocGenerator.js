/* =====================================================
   VIMECO S.A. — Generador de PDF Orden de Compra
   ===================================================== */

/* global jspdf, LOGO_BASE64 */

// ─── Datos fijos ──────────────────────────────────────
const VIMECO = {
  cuit:            '30-50424533-7',
  ingBruto:        '904-230008-9',
  inicioActividad: '01/04/96',
  dir1:            'Bv. Rivadavia N° 3450',
  dir2:            'B° Los Boulevares',
  ciudad:          '(5147) Córdoba - Argentina',
  telFax:          'Tel. / Fax (0351) 4759009',
  email:           'matiaspes@vimeco.com.ar',
  iva:             'Responsable Inscripto'
};

// ─── Paleta [R,G,B] ──────────────────────────────────
const C = {
  azul:      [43,  57,  70],    // #2B3946
  azulMed:   [61,  81,  102],   // #3D5166
  amarillo:  [225, 174, 58],    // #E1AE3A
  gris:      [242, 242, 242],   // #F2F2F2
  fondoLogo: [246, 246, 246],   // #F6F6F6
  borde:     [170, 170, 170],   // #AAAAAA
  blanco:    [255, 255, 255],
  negro:     [20,  20,  20]
};

// ─── Geometría de página A4 ──────────────────────────
const PG = {
  w: 210, h: 297,
  ml: 10, mt: 10,
  get cw() { return this.w - 2 * this.ml; }  // 190mm
};

// ─── Anchos de columna en mm ─────────────────────────
const HDR_COLS  = [55.0, 80.0, 55.0];              // sum=190 
const PROV_COLS = [26.0, 102.0, 22.0, 40.0];       // sum=190
const ITM_COLS  = [95.0, 20.0, 20.0, 30.0, 25.0];  // sum=190 — DESC|UNID|CANT|PRECIO|IMP
const FTR_COLS  = [74.0, 57.0, 59.0];              // sum=190

const HDR_R1H = 20;   // fila 1 — logo + título  (ajustado a datos fiscales)
const HDR_R2H = 16;   // fila 2 — fecha / N° OC  (fila inferior compacta)

// ─── Función principal ───────────────────────────────
function generateOC(data) {
  let jsPDFClass = null;
  if (window.jspdf && window.jspdf.jsPDF) {
    jsPDFClass = window.jspdf.jsPDF;
  } else if (window.jsPDF) {
    jsPDFClass = window.jsPDF;
  } else {
    throw new Error('jsPDF no está disponible');
  }
  const doc = new jsPDFClass({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  let y = PG.mt;
  y = drawHeader(doc, data, y);
  y += 2;
  y = drawProveedorTable(doc, data, y);
  y += 2;
  y = drawItemsTable(doc, data.items, y);
  y = drawTotalsTable(doc, data, y);
  y += 2;
  y = drawAmountInWords(doc, data.totalLetras, y);
  y += 3;
  drawFooter(doc, data, y);

  const fname = `OC_${data.nroOC}_${sanitize(data.proveedor.nombre || 'SinProveedor')}.pdf`;
  doc.save(fname);
}

/* =====================================================
   1. HEADER
   Recuadro único con fondo gris claro.
   Una barra vertical separa col3 (datos fiscales + N°).
   Los datos fiscales tienen su propio recuadro fino.
   El bloque N° tiene relleno azul sin borde adicional.
   Sin línea horizontal interna.
   ===================================================== */
function drawHeader(doc, data, y) {
  const { ml } = PG;
  const x0     = ml;
  const x1     = x0 + HDR_COLS[0];
  const x2     = x1 + HDR_COLS[1];
  const totalH = HDR_R1H + HDR_R2H;

  // Fondo gris claro — todo el header
  fillRect(doc, x0, y, PG.cw, totalH, C.gris);

  // Relleno azul para bloque N° (sin borde propio)
  fillRect(doc, x2, y + HDR_R1H, HDR_COLS[2], HDR_R2H, C.azul);

  // Borde exterior del header + línea vertical divisoria
  setThinBorder(doc);
  doc.rect(x0, y, PG.cw, totalH, 'S');
  doc.line(x2, y, x2, y + totalH);

  // Caja para datos fiscales (col3 fila1)
  doc.rect(x2, y, HDR_COLS[2], HDR_R1H, 'S');

  // ── Logo col1 ────────────────────────────────────────
  const logoSrc = typeof LOGO_BASE64 !== 'undefined' ? LOGO_BASE64 : null;
  let logoH = 0;
  if (logoSrc) {
    try {
      const fmt  = logoSrc.startsWith('data:image/png') ? 'PNG' : 'JPEG';
	const maxW = HDR_COLS[0] - 1;   // ← ANCHO máximo en mm (actualmente 64mm)
 	const maxH = HDR_R1H - 4;       // ← ALTO máximo en mm (actualmente 19mm)      

	let lw = maxW, lh;
      if (window.__logoDims && window.__logoDims.w) {
        lh = lw * (window.__logoDims.h / window.__logoDims.w);
        if (lh > maxH) { lh = maxH; lw = lh * (window.__logoDims.w / window.__logoDims.h); }
      } else {
        lh = lw * 0.30;
      }
      lw = Math.round(lw * 10) / 10;
      lh = Math.round(lh * 10) / 10;
      logoH = lh;
      doc.addImage(logoSrc, fmt, x0 + 0.5, y + 1, lw, lh);
    } catch (_) {}
  }

  // ── Col1 fila inferior: dirección anclada abajo-izquierda ──────────
  // Se posiciona en la fila inferior (y+HDR_R1H), pegada al borde inferior del header.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.negro);
  const addrBottom = y + totalH - 2.5;
  [VIMECO.dir1, VIMECO.dir2, VIMECO.ciudad].forEach((ln, i) => {
    doc.text(ln, x0 + 1.5, addrBottom - (2 - i) * 3.6);
  });

  // ── Col2: "ORDEN DE COMPRA" — centrado en sección superior
  const midC2 = x1 + HDR_COLS[1] / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...C.azul);
  doc.text('ORDEN DE COMPRA', midC2, y + HDR_R1H / 2 + 2, { align: 'center' });

  // ── Col2: "FECHA:" bold + valor normal — centrado en sección inferior
  const r2Y = y + HDR_R1H + HDR_R2H / 2 + 2;
  doc.setFontSize(13);
  doc.setTextColor(...C.azul);
  doc.setFont('helvetica', 'bold');
  const lwFecha = doc.getTextWidth('FECHA: ');
  doc.setFont('helvetica', 'normal');
  const vwFecha = doc.getTextWidth(data.fecha);
  const fStartX = midC2 - (lwFecha + vwFecha) / 2;
  doc.setFont('helvetica', 'bold');
  doc.text('FECHA: ', fStartX, r2Y);
  doc.setFont('helvetica', 'normal');
  doc.text(data.fecha, fStartX + lwFecha, r2Y);

  // ── Col3 fila1: datos fiscales
  const midC3 = x2 + HDR_COLS[2] / 2;
  doc.setTextColor(...C.azul);
  let fy = y + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`CUIT N°: ${VIMECO.cuit}`, midC3, fy, { align: 'center' });
  fy += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Ing. Brutos Conv. Mult.: ${VIMECO.ingBruto}`, midC3, fy, { align: 'center' });
  fy += 4;
  doc.text(`Inicio Actividad: ${VIMECO.inicioActividad}`, midC3, fy, { align: 'center' });
  fy += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(VIMECO.iva, midC3, fy, { align: 'center' });

  // ── Col3 fila2: N° OC — blanco sobre azul ────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.blanco);
  doc.text(`N° ${data.nroOC}`, midC3, y + HDR_R1H + HDR_R2H / 2 + 2, { align: 'center' });

  return y + totalH;
}

/* =====================================================
   2. TABLA PROVEEDOR — 4 filas, bordes finos
   ===================================================== */
function drawProveedorTable(doc, data, y) {
  const { ml } = PG;
  const MIN_H  = 7.5;
  const LINE_H = 4.2;
  const p      = data.proveedor;
  const xs     = buildXs(ml, PROV_COLS);
  const fullW  = PROV_COLS.reduce((s, c) => s + c, 0);

  setThinBorder(doc);
  doc.setFontSize(8.5);

  const rows = [
    ['Proveedor:',  p.nombre    || '—', 'CUIT N°:', p.cuit     || '—'],
    ['Domicilio:',  p.domicilio || '—', 'I.V.A.:',  p.iva      || '—'],
    ['Teléfonos:',  p.telefonos || '—', 'Ref.:',    p.ref      || '—']
  ];

  let ry = y;

  rows.forEach(([l1, v1, l2, v2]) => {
    const v1Lines  = doc.splitTextToSize(v1, PROV_COLS[1] - 3);
    const v2Lines  = doc.splitTextToSize(v2, PROV_COLS[3] - 3);
    const maxLines = Math.max(v1Lines.length, v2Lines.length);
    const rowH     = Math.max(MIN_H, maxLines * LINE_H + 5);
    const ty       = maxLines === 1 ? ry + rowH / 2 + 1.5 : ry + 4.5;

    fillRect(doc, xs[0], ry, PROV_COLS[0], rowH, C.fondoLogo);
    fillRect(doc, xs[1], ry, PROV_COLS[1], rowH, C.blanco);
    fillRect(doc, xs[2], ry, PROV_COLS[2], rowH, C.fondoLogo);
    fillRect(doc, xs[3], ry, PROV_COLS[3], rowH, C.blanco);
    doc.rect(xs[0], ry, fullW, rowH, 'S');
    [xs[1], xs[2], xs[3]].forEach(cx => doc.line(cx, ry, cx, ry + rowH));

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.azul);
    doc.text(l1, xs[0] + 1.5, ty);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.negro);
    v1Lines.forEach((ln, i) => doc.text(ln, xs[1] + 1.5, ty + i * LINE_H));
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.azul);
    doc.text(l2, xs[2] + 1.5, ty);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.negro);
    v2Lines.forEach((ln, i) => doc.text(ln, xs[3] + 1.5, ty + i * LINE_H));

    ry += rowH;
  });

  // Fila 4: Ubicación / Motivo — alto variable según contenido
  const ubicW     = PROV_COLS[1] + PROV_COLS[2] + PROV_COLS[3];
  const ubicLines = doc.splitTextToSize(p.ubicacion || '—', ubicW - 3);
  const R4H       = Math.max(LINE_H * 2 + 5, ubicLines.length * LINE_H + 5);

  fillRect(doc, xs[0], ry, PROV_COLS[0], R4H, C.fondoLogo);
  fillRect(doc, xs[1], ry, ubicW,         R4H, C.blanco);
  doc.rect(xs[0], ry, fullW, R4H, 'S');
  doc.line(xs[1], ry, xs[1], ry + R4H);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.azul);
  doc.text('Ubicación /\nMotivo:', xs[0] + 1.5, ry + 4.5, { lineHeightFactor: 1.4 });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.negro);
  ubicLines.forEach((ln, i) => doc.text(ln, xs[1] + 1.5, ry + 4.5 + i * LINE_H));

  return ry + R4H;
}

/* =====================================================
   3. TABLA DE ÍTEMS
   5 columnas: DESCRIPCIÓN | UNIDAD | CANT. | P. UNITARIO | IMPORTE
   Alto de fila variable: se ajusta si la descripción es larga.
   ===================================================== */
function drawItemsTable(doc, items, y) {
  const { ml, cw } = PG;
  const HDR_H  = 8;
  const ROW_H  = 7;    // alto mínimo de fila
  const LINE_H = 4.5;  // alto por línea de texto
  const xs     = buildXs(ml, ITM_COLS);

  const headers = [
    { label: 'DESCRIPCIÓN', align: 'left'   },
    { label: 'UNIDAD',      align: 'center' },
    { label: 'CANT.',       align: 'center' },
    { label: 'P. UNITARIO', align: 'right'  },
    { label: 'IMPORTE',     align: 'right'  }
  ];

  // Encabezado
  fillRect(doc, ml, y, cw, HDR_H, C.azul);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.blanco);
  headers.forEach((h, i) => {
    doc.text(h.label, textX(xs[i], ITM_COLS[i], h.align), y + HDR_H / 2 + 1.5, { align: h.align });
  });
  setThinBorder(doc);
  doc.rect(ml, y, cw, HDR_H, 'S');
  xs.slice(1).forEach(cx => doc.line(cx, y, cx, y + HDR_H));
  y += HDR_H;

  // Filas con alto variable según largo de descripción
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  items.forEach(item => {
    const desc      = String(item.desc || '').trim() || '—';
    const descLines = doc.splitTextToSize(desc, ITM_COLS[0] - 4);
    const rowH      = Math.max(ROW_H, descLines.length * LINE_H + 3);

    fillRect(doc, ml, y, cw, rowH, C.blanco);
    setThinBorder(doc);
    doc.rect(ml, y, cw, rowH, 'S');
    xs.slice(1).forEach(cx => doc.line(cx, y, cx, y + rowH));

    const cant     = parseFloat(item.cant)    || 0;
    const unitario = parseFloat(item.unitario) || 0;
    const total    = parseFloat(item.total)    || cant * unitario;
    const cy       = y + rowH / 2 + 1.5;

    doc.setTextColor(...C.negro);
    // Descripción: alineada arriba, multilínea
    descLines.forEach((ln, li) => doc.text(ln, xs[0] + 2, y + 4.5 + li * LINE_H));
    // Resto: centrado verticalmente
    doc.text(String(item.unidad || '—'), textX(xs[1], ITM_COLS[1], 'center'), cy, { align: 'center' });
    doc.text(fmtQty(cant),               textX(xs[2], ITM_COLS[2], 'center'), cy, { align: 'center' });
    doc.text(`$ ${formatARS(unitario)}`, textX(xs[3], ITM_COLS[3], 'right'),  cy, { align: 'right'  });
    doc.text(`$ ${formatARS(total)}`,    textX(xs[4], ITM_COLS[4], 'right'),  cy, { align: 'right'  });

    y += rowH;
  });

  return y;
}

/* =====================================================
   4. TABLA DE TOTALES
   Filas normales: fondo gris #F2F2F2
   Fila TOTAL: fondo amarillo #E1AE3A, texto negro negrita
   Montos exactos, sin recalcular
   ===================================================== */
function drawTotalsTable(doc, data, y) {
  const { ml, cw } = PG;
  const impuestos = data.impuestos || [];
  if (!impuestos.length) return y;

  const ROW_H = 7.5;
  // Label: cols 1-4 = 95+20+20+30 = 165mm; valor: col5 = 25mm
  const LBL_W = ITM_COLS[0] + ITM_COLS[1] + ITM_COLS[2] + ITM_COLS[3];
  const sepX  = ml + LBL_W;

  setThinBorder(doc);
  impuestos.forEach((imp, i) => {
    const nombre    = imp.nombre.trim();
    const isTotal   = nombre.toUpperCase() === 'TOTAL';
    const isGravado = nombre === 'Gravado';
    const ry = y + i * ROW_H;
    const ty = ry + ROW_H / 2 + 1.5;

    const bg = isTotal ? C.amarillo : C.gris;
    fillRect(doc, ml, ry, cw, ROW_H, bg);
    doc.rect(ml, ry, cw, ROW_H, 'S');
    doc.line(sepX, ry, sepX, ry + ROW_H);

    const bold = isTotal || isGravado;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(isTotal ? 9.5 : 8.5);
    doc.setTextColor(...C.negro);
    doc.text(nombre, sepX - 2, ty, { align: 'right' });

    // Descuento: monto negativo → mostrar con signo
    const montoLabel = `$ ${formatARS(imp.monto)}`;
    doc.text(montoLabel, ml + cw - 2, ty, { align: 'right' });
  });

  return y + impuestos.length * ROW_H;
}

/* =====================================================
   5. MONTO EN LETRAS
   ===================================================== */
function drawAmountInWords(doc, totalLetras, y) {
  const { ml, cw } = PG;
  const text = `Son PESOS: ${totalLetras || ''}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.azul);
  const wrapped = doc.splitTextToSize(text, cw - 6);
  const blockH  = wrapped.length * 4.5 + 5;
  setThinBorder(doc);
  fillRect(doc, ml, y, cw, blockH, C.fondoLogo);
  doc.rect(ml, y, cw, blockH, 'S');
  wrapped.forEach((ln, i) => doc.text(ln, ml + 3, y + 4 + i * 4.5));
  return y + blockH;
}

/* =====================================================
   6. FOOTER — 3 columnas, bordes finos #AAAAAA
   Nombre del responsable: izquierda, arriba
   ===================================================== */
function drawFooter(doc, data, y) {
  const { ml, w } = PG;
  const COL_H = 38;
  const xs    = buildXs(ml, FTR_COLS);

  FTR_COLS.forEach((cw_col, i) => fillRect(doc, xs[i], y, cw_col, COL_H, C.blanco));
  setThinBorder(doc);
  FTR_COLS.forEach((cw_col, i) => doc.rect(xs[i], y, cw_col, COL_H, 'S'));

  doc.setFontSize(7.5);

  // Col 1 — Condiciones de pago / Plazo / Lugar de entrega
  const col1Items = [
    { label: 'Condiciones de Pago:', value: data.proveedor.pago  || '—' },
    { label: 'Plazo de entrega:',    value: data.proveedor.plazo || '—' },
    { label: 'Lugar de entrega:',    value: data.proveedor.lugar || '—' }
  ];
  col1Items.forEach(({ label, value }, i) => {
    const ly = y + 5.5 + i * 10.5;
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.azul);
    doc.text(label, xs[0] + 2.5, ly);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.negro);
    doc.text(
      doc.splitTextToSize(value, FTR_COLS[0] - 5)[0],
      xs[0] + 2.5, ly + 4.5
    );
  });

  // Col 2 — Conformidad del proveedor
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.azul);
  doc.text('Conformidad del Proveedor:', xs[1] + 2.5, y + 6);
  doc.setLineWidth(0.3);
  doc.setDrawColor(...C.borde);
  doc.line(xs[1] + 4, y + COL_H - 7, xs[1] + FTR_COLS[1] - 4, y + COL_H - 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.negro);
  doc.text('Firma y Aclaración', xs[1] + FTR_COLS[1] / 2, y + COL_H - 3, { align: 'center' });

  // Col 3 — Autorizado por VIMECO S.A.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.azul);
  doc.text('Autorizado por VIMECO S.A.:', xs[2] + 2.5, y + 6);
  if (data.ejecutor) {
    // Nombre alineado a la izquierda, posicionado arriba en la celda
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...C.negro);
    doc.text(data.ejecutor, xs[2] + 2.5, y + 12);
  }
  doc.setLineWidth(0.3);
  doc.setDrawColor(...C.borde);
  doc.line(xs[2] + 4, y + COL_H - 7, xs[2] + FTR_COLS[2] - 4, y + COL_H - 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...C.negro);
  doc.text('Firma y Sello', xs[2] + FTR_COLS[2] / 2, y + COL_H - 3, { align: 'center' });

  // Nota al pie
  const noteY = y + COL_H + 4;
  doc.setLineWidth(0.4);
  doc.setDrawColor(...C.azul);
  doc.line(ml, noteY, w - ml, noteY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.azul);
  doc.text(
    'NOTA: HACER MENCIÓN DE LA PRESENTE ORDEN EN SUS REMITOS Y FACTURAS',
    w / 2, noteY + 5.5, { align: 'center' }
  );
}

/* =====================================================
   NÚMERO EN LETRAS — español argentino
   ===================================================== */
function numberToWords(monto) {
  const entero   = Math.floor(Math.abs(monto));
  const centavos = Math.round((Math.abs(monto) - entero) * 100);

  const UNI = [
    '', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
    'diecisiete', 'dieciocho', 'diecinueve', 'veinte'
  ];
  const DEC = ['','','veinti','treinta','cuarenta','cincuenta',
               'sesenta','setenta','ochenta','noventa'];
  const CEN = ['','ciento','doscientos','trescientos','cuatrocientos',
               'quinientos','seiscientos','setecientos','ochocientos','novecientos'];

  function grupo(n) {
    if (!n)        return '';
    if (n <= 20)   return UNI[n];
    if (n < 30)    return n === 21 ? 'veintiún' : DEC[2] + UNI[n - 20];
    if (n < 100)   { const d = Math.floor(n / 10), u = n % 10; return DEC[d] + (u ? ' y ' + UNI[u] : ''); }
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100), r = n % 100;
    return CEN[c] + (r ? ' ' + grupo(r) : '');
  }

  function miles(n) {
    if (!n) return 'cero';
    const M = Math.floor(n / 1000000);
    const K = Math.floor((n % 1000000) / 1000);
    const R = n % 1000;
    let s = '';
    if (M) s += (M === 1 ? 'un millón' : grupo(M) + ' millones') + (K || R ? ' ' : '');
    if (K) s += (K === 1 ? 'mil'        : grupo(K) + ' mil')       + (R      ? ' ' : '');
    if (R) s += grupo(R);
    return s.trim();
  }

  let res = miles(entero);
  if (centavos > 0) res += ` con ${miles(centavos)} centavo${centavos === 1 ? '' : 's'}`;
  return res;
}

/* =====================================================
   HELPERS
   ===================================================== */

function fillRect(doc, x, y, w, h, color) {
  doc.setFillColor(...color);
  doc.rect(x, y, w, h, 'F');
}

function setThinBorder(doc) {
  doc.setLineWidth(0.3);
  doc.setDrawColor(...C.borde);  // #AAAAAA
}

function buildXs(startX, cols) {
  const xs = [startX];
  cols.slice(1).forEach((_, i) => xs.push(xs[i] + cols[i]));
  return xs;
}

function textX(colX, colW, align) {
  if (align === 'right')  return colX + colW - 2;
  if (align === 'center') return colX + colW / 2;
  return colX + 2;
}

function formatARS(num) {
  return (parseFloat(num) || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function fmtQty(n) {
  const v = parseFloat(n) || 0;
  return v % 1 === 0
    ? v.toLocaleString('es-AR')
    : v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9_\-À-ÿ]/g, '_').substring(0, 30);
}
