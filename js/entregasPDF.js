/* =====================================================
   VIMECO S.A. — PDF del control de entregas
   entregasPDF.js

   La versión para mirar de las planillas de entregas.js: lo mismo que el Excel
   pero de un vistazo, con barras de avance y colores por estado.
     - De una OC: qué se pidió, qué llegó, qué falta y cuánto, renglón por
       renglón, y los remitos que la fueron cubriendo.
     - De una obra: cuántas OC están entregadas, parciales o sin entregas, y
       de cada OC pendiente sólo lo que falta. Las entregadas van al final, en
       una línea cada una.

   Requiere: entregas.js (calcEntrega). jsPDF y el logo se cargan a demanda si
   la página no los trae.
   ===================================================== */

/* global LOGO_BASE64, calcEntrega */

(function () {
  'use strict';

  // ── Carga diferida de jsPDF y el logo ─────────────────────────────────────

  let _carga = null;
  function cargarScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }
  function ensureJsPDF() {
    if (!_carga) {
      _carga = (async () => {
        if (!(window.jspdf && window.jspdf.jsPDF)) await cargarScript('js/jspdf.umd.min.js');
        // Sin logo el PDF sale igual.
        if (typeof LOGO_BASE64 === 'undefined') await cargarScript('js/logoBase64.js').catch(() => {});
      })().catch(e => { _carga = null; throw e; });
    }
    return _carga;
  }

  // ── Paleta y geometría (A4 vertical) ──────────────────────────────────────

  const AZUL = [43, 57, 70], AZUL_MED = [61, 81, 102], AMARILLO = [225, 174, 58];
  const BLANCO = [255, 255, 255], TINTA = [33, 37, 41], GRIS = [110, 117, 125];
  const LINEA = [222, 226, 230], FONDO = [246, 247, 249], RIEL = [225, 229, 234];
  const ROJO = [198, 40, 40], ROJO_BG = [253, 230, 230];

  const EST = {
    completa: { fg: [46, 125, 50],   bg: [227, 245, 232], txt: 'Entregada',       enAzul: [150, 222, 160] },
    parcial:  { fg: [184, 115, 0],   bg: [255, 244, 224], txt: 'Entrega parcial', enAzul: AMARILLO },
    sin:      { fg: [110, 117, 125], bg: [238, 240, 243], txt: 'Sin entregas',    enAzul: [200, 214, 230] }
  };

  const P = { w: 210, h: 297, ml: 12, mt: 12, cw: 186, maxY: 281 };

  // ── Formato ───────────────────────────────────────────────────────────────

  const qty = n => (parseFloat(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fechaTxt = d => {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d || '');
  };
  const ahora = () => new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  // Estado de un renglón: lo mismo que la OC entera, pero de a uno.
  const estadoItem = (ped, rec) => rec >= ped && ped > 0 ? 'completa' : rec > 0 ? 'parcial' : 'sin';
  const pctItem = (ped, rec) => ped > 0 ? Math.round(Math.min(1, rec / ped) * 100) : (rec > 0 ? 100 : 0);

  // Recorta el texto con «…» para que entre en `w` mm con la fuente actual.
  function fit(doc, s, w) {
    s = String(s || '');
    if (doc.getTextWidth(s) <= w) return s;
    while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  function font(doc, size, estilo = 'normal', color = TINTA) {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }

  // ── Piezas ────────────────────────────────────────────────────────────────

  function nuevoDoc() {
    return new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  }

  // Franja azul de la primera página. A la derecha, el número grande.
  function encabezado(doc, sub, grande, debajo, colorDebajo) {
    const x0 = P.ml, y = P.mt, H = 26;
    doc.setFillColor(...AZUL);
    doc.rect(x0, y, P.cw, H, 'F');

    // Logo sobre placa blanca (el PNG es de tinta oscura y sobre el azul se pierde).
    const logo = typeof LOGO_BASE64 !== 'undefined' ? LOGO_BASE64 : null;
    if (logo) {
      try {
        const lw = 34, lh = lw * (82 / 400);
        doc.setFillColor(...BLANCO);
        doc.rect(x0 + 3, y + 3, lw + 6, H - 6, 'F');
        doc.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', x0 + 6, y + (H - lh) / 2, lw, lh);
      } catch (_) {}
    }

    const xt = x0 + 49, xr = x0 + P.cw - 5;
    font(doc, 14, 'bold', BLANCO);
    doc.text('CONTROL DE ENTREGAS', xt, y + 11);
    font(doc, 10, 'normal', BLANCO);
    doc.text(fit(doc, sub, xr - xt - 34), xt, y + 18.5);

    font(doc, 21, 'bold', BLANCO);
    doc.text(grande, xr, y + 13, { align: 'right' });
    font(doc, 7.5, 'bold', colorDebajo || [200, 214, 230]);
    doc.text(debajo.toUpperCase(), xr, y + 19.5, { align: 'right' });
    return y + H;
  }

  // Encabezado chico de las páginas que siguen.
  function encabezadoCorto(doc, titulo) {
    font(doc, 8, 'bold', GRIS);
    doc.text(fit(doc, 'Control de entregas — ' + titulo, P.cw), P.ml, P.mt + 2);
    doc.setDrawColor(...LINEA);
    doc.setLineWidth(0.3);
    doc.line(P.ml, P.mt + 4, P.ml + P.cw, P.mt + 4);
    return P.mt + 9;
  }

  function pies(doc) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      font(doc, 7, 'normal', GRIS);
      doc.text(`VIMECO S.A. · Generado el ${ahora()} con lo cargado en Remitos`, P.ml, P.h - 8);
      doc.text(`Página ${i} de ${n}`, P.ml + P.cw, P.h - 8, { align: 'right' });
    }
  }

  function barra(doc, x, y, w, h, pct, estado) {
    doc.setFillColor(...RIEL);
    doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
    if (pct <= 0) return;
    const fw = Math.max(h, w * Math.min(100, pct) / 100);
    doc.setFillColor(...EST[estado].fg);
    doc.roundedRect(x, y, fw, h, h / 2, h / 2, 'F');
  }

  function titulo(doc, y, txt, extra) {
    font(doc, 10.5, 'bold', AZUL);
    doc.text(txt, P.ml, y);
    if (extra) {
      const w = doc.getTextWidth(txt);
      font(doc, 8.5, 'normal', GRIS);
      doc.text(extra, P.ml + w + 2.5, y);
    }
    return y + 3;
  }

  // Celdas tipo ficha: rótulo chico arriba, valor abajo.
  function datos(doc, y, celdas) {
    let x = P.ml;
    celdas.forEach(([lbl, val, w]) => {
      font(doc, 6.8, 'bold', GRIS);
      doc.text(lbl.toUpperCase(), x, y);
      font(doc, 9.5, 'bold', TINTA);
      doc.text(fit(doc, val || '—', w - 4), x, y + 5);
      x += w;
    });
    return y + 9;
  }

  // Tabla genérica con salto de página. `cols` = [{ t, w, a }]; `filas` =
  // [{ celdas: [{ v (string|string[]), color, bold }], bg, acento }].
  function tabla(doc, y, cols, filas, ctx, x0 = P.ml) {
    const W = cols.reduce((s, c) => s + c.w, 0);
    const cabecera = yy => {
      doc.setFillColor(...AZUL_MED);
      doc.rect(x0, yy, W, 6.5, 'F');
      font(doc, 7.3, 'bold', BLANCO);
      let x = x0;
      cols.forEach(c => {
        const tx = c.a === 'right' ? x + c.w - 2 : c.a === 'center' ? x + c.w / 2 : x + 2;
        doc.text(c.t, tx, yy + 4.4, { align: c.a || 'left' });
        x += c.w;
      });
      return yy + 6.5;
    };
    y = cabecera(y);
    font(doc, 8.3);
    filas.forEach((f, fi) => {
      font(doc, 8.3);
      // Las celdas de texto largo se parten en renglones.
      const celdas = f.celdas.map((c, i) => {
        if (c.dibujar) return c;
        const lineas = c.wrap ? doc.splitTextToSize(String(c.v || ''), cols[i].w - 4) : [String(c.v ?? '')];
        return { ...c, lineas };
      });
      const nl = Math.max(1, ...celdas.map(c => (c.lineas || ['']).length));
      const h = Math.max(7, nl * 3.7 + 3.4);
      if (y + h > P.maxY) {
        doc.addPage();
        y = cabecera(encabezadoCorto(doc, ctx));
      }
      doc.setFillColor(...(f.bg || (fi % 2 ? FONDO : BLANCO)));
      doc.rect(x0, y, W, h, 'F');
      if (f.acento) { doc.setFillColor(...f.acento); doc.rect(x0, y, 1.2, h, 'F'); }
      doc.setDrawColor(...LINEA);
      doc.setLineWidth(0.2);
      doc.line(x0, y + h, x0 + W, y + h);

      let x = x0;
      celdas.forEach((c, i) => {
        const col = cols[i];
        if (c.dibujar) c.dibujar(x, y, col.w, h);
        else {
          font(doc, c.size || 8.3, c.bold ? 'bold' : 'normal', c.color || TINTA);
          const tx = col.a === 'right' ? x + col.w - 2 : col.a === 'center' ? x + col.w / 2 : x + 2 + (i === 0 && f.acento ? 0.8 : 0);
          const ty = y + (h - (c.lineas.length - 1) * 3.7) / 2 + 1.1;
          doc.text(c.lineas, tx, ty, { align: col.a || 'left', lineHeightFactor: 1.25 });
        }
        x += col.w;
      });
      y += h;
    });
    return y;
  }

  // Celda con barrita y porcentaje.
  const celdaAvance = (doc, pct, estado) => ({
    dibujar: (x, y, w, h) => {
      const bw = w - 15;
      barra(doc, x + 2, y + h / 2 - 1.3, bw, 2.6, pct, estado);
      font(doc, 7.6, 'bold', EST[estado].fg);
      doc.text(pct + '%', x + w - 2, y + h / 2 + 1.2, { align: 'right' });
    }
  });

  // Qué falta de un renglón, o cuánto llegó de más.
  function celdaFalta(ped, rec) {
    const falta = ped - rec;
    if (falta > 0) return { v: qty(falta), bold: true, color: rec > 0 ? EST.parcial.fg : ROJO };
    if (falta < 0) return { v: '+' + qty(-falta) + ' de más', bold: true, color: ROJO, size: 7.3 };
    return { v: '—', color: EST.completa.fg, bold: true };
  }

  // ── PDF de una OC ─────────────────────────────────────────────────────────

  function docOC(oc, remitos) {
    const doc = nuevoDoc();
    const e = calcEntrega(oc, remitos);
    const items = oc.items || [];
    const ctx = 'OC ' + oc.nroOC;
    const est = EST[e.estado];

    let y = encabezado(doc, `OC ${oc.nroOC}`, e.pct + '%', est.txt, est.enAzul);

    y = datos(doc, y + 8, [
      ['Proveedor', oc.proveedor?.nombre, 70],
      ['Obra', oc.obra || 'Sin obra', 58],
      ['Fecha OC', fechaTxt(oc.fecha), 28],
      ['Remitos', String(e.remitos.length), 30]
    ]);

    // Avance general
    const completos = e.pedido.filter((p, i) => e.recibido[i] >= p).length;
    const faltan = items.length - completos;
    y += 3;
    font(doc, 8, 'bold', TINTA);
    doc.text('Avance de la entrega', P.ml, y);
    font(doc, 8, 'normal', GRIS);
    doc.text(`${completos} de ${items.length} renglones completos${faltan ? ` · faltan ${faltan}` : ''}`, P.ml + P.cw, y, { align: 'right' });
    barra(doc, P.ml, y + 2.5, P.cw, 4.5, e.pct, e.estado);
    y += 13;

    // Renglones
    y = titulo(doc, y, 'Ítems de la OC', `${items.length}`) + 1;
    const cols = [
      { t: 'Ítem', w: 74 }, { t: 'Un.', w: 14, a: 'center' }, { t: 'Pedido', w: 19, a: 'right' },
      { t: 'Llegó', w: 19, a: 'right' }, { t: 'Falta', w: 24, a: 'right' }, { t: 'Avance', w: 36 }
    ];
    const filas = items.map((it, i) => {
      const ped = e.pedido[i], rec = e.recibido[i];
      const ei = estadoItem(ped, rec);
      return {
        bg: rec > ped ? ROJO_BG : EST[ei].bg, acento: EST[ei].fg,
        celdas: [
          { v: it.desc || '(sin descripción)', wrap: true },
          { v: it.unidad || '', color: GRIS },
          { v: qty(ped) },
          { v: qty(rec), bold: rec > 0 },
          celdaFalta(ped, rec),
          celdaAvance(doc, pctItem(ped, rec), ei)
        ]
      };
    });
    y = tabla(doc, y, cols, filas, ctx);

    // Leyenda de colores
    y += 4;
    if (y + 6 > P.maxY) { doc.addPage(); y = encabezadoCorto(doc, ctx); }
    let lx = P.ml;
    [['completa', 'Llegó todo'], ['parcial', 'Llegó una parte'], ['sin', 'No llegó nada']].forEach(([k, t]) => {
      doc.setFillColor(...EST[k].fg);
      doc.rect(lx, y - 2.4, 2.6, 2.6, 'F');
      font(doc, 7.3, 'normal', GRIS);
      doc.text(t, lx + 4, y);
      lx += doc.getTextWidth(t) + 10;
    });
    y += 8;

    // Remitos
    if (y + 20 > P.maxY) { doc.addPage(); y = encabezadoCorto(doc, ctx); }
    y = titulo(doc, y, 'Remitos recibidos', `${e.remitos.length}`) + 1;
    if (!e.remitos.length) {
      doc.setFillColor(...FONDO);
      doc.rect(P.ml, y, P.cw, 10, 'F');
      font(doc, 8.5, 'normal', GRIS);
      doc.text('Todavía no llegó ningún remito para esta OC.', P.ml + 4, y + 6.2);
    } else {
      const rcols = [{ t: 'N° remito', w: 30 }, { t: 'Fecha', w: 20, a: 'center' }, { t: 'Recibió', w: 34 }, { t: 'Qué trajo', w: 102 }];
      const rfilas = e.remitos.slice().reverse().map(r => {
        let trajo = (r.items || []).map(it => `${it.desc || '?'}: ${qty(it.cantidad)}${it.unidad ? ' ' + it.unidad : ''}`).join('  ·  ');
        if (r.observaciones) trajo += (trajo ? '\n' : '') + 'Obs.: ' + r.observaciones;
        return {
          celdas: [
            { v: r.nro || '—', bold: true },
            { v: fechaTxt(r.fecha) },
            { v: r.recibidoPor?.nombre || '—', wrap: true },
            { v: trajo || '(sin ítems)', wrap: true, size: 7.8 }
          ]
        };
      });
      tabla(doc, y, rcols, rfilas, ctx);
    }

    pies(doc);
    return doc;
  }

  // ── PDF de una obra ───────────────────────────────────────────────────────

  function docObra(obra, ocs, remitos) {
    const doc = nuevoDoc();
    const ctx = obra;
    const filas = ocs.map(oc => ({ oc, e: calcEntrega(oc, remitos.filter(r => r.nroOC === oc.nroOC)) }));
    const cuenta = k => filas.filter(f => f.e.estado === k).length;
    const impPed = filas.reduce((s, f) => s + f.e.impPedido, 0);
    const impRec = filas.reduce((s, f) => s + f.e.impRecib, 0);
    const pct = impPed > 0 ? Math.round(impRec / impPed * 100)
      : filas.length ? Math.round(filas.reduce((s, f) => s + f.e.pct, 0) / filas.length) : 0;

    let y = encabezado(doc, obra, pct + '%', 'Avance de la obra');

    // Tarjetas de conteo
    y += 6;
    const tiles = [
      [String(filas.length), 'Órdenes de compra', AZUL],
      [String(cuenta('completa')), 'Entregadas', EST.completa.fg],
      [String(cuenta('parcial')), 'Con entrega parcial', EST.parcial.fg],
      [String(cuenta('sin')), 'Sin entregas', EST.sin.fg]
    ];
    const tw = (P.cw - 3 * 4) / 4;
    tiles.forEach(([n, lbl, color], i) => {
      const x = P.ml + i * (tw + 4);
      doc.setFillColor(...FONDO);
      doc.roundedRect(x, y, tw, 17, 2, 2, 'F');
      doc.setFillColor(...color);
      doc.rect(x, y + 3, 1.2, 11, 'F');
      font(doc, 16, 'bold', color);
      doc.text(n, x + 5, y + 9.5);
      font(doc, 7.3, 'normal', GRIS);
      doc.text(lbl, x + 5, y + 14);
    });
    y += 25;

    // Pendientes: las parciales primero (ya empezaron a llegar), después las
    // que no recibieron nada; dentro de cada grupo, las más nuevas arriba.
    const orden = { parcial: 0, sin: 1 };
    const pend = filas.filter(f => f.e.estado !== 'completa')
      .sort((a, b) => orden[a.e.estado] - orden[b.e.estado] || (b.oc.timestamp || 0) - (a.oc.timestamp || 0));
    const listas = filas.filter(f => f.e.estado === 'completa')
      .sort((a, b) => (b.oc.timestamp || 0) - (a.oc.timestamp || 0));

    if (pend.length) {
      y = titulo(doc, y, 'Lo que falta llegar', `${pend.length} OC`) + 2;
      const icols = [
        { t: 'Ítem', w: 96 }, { t: 'Un.', w: 14, a: 'center' }, { t: 'Pedido', w: 22, a: 'right' },
        { t: 'Llegó', w: 22, a: 'right' }, { t: 'Falta', w: 26, a: 'right' }
      ];
      pend.forEach(({ oc, e }) => {
        const faltan = (oc.items || []).map((it, i) => ({ it, ped: e.pedido[i], rec: e.recibido[i] })).filter(x => x.rec < x.ped);
        // La cabecera de la OC no queda sola al pie de la página.
        if (y + 13 + (faltan.length ? 13.5 : 0) > P.maxY) { doc.addPage(); y = encabezadoCorto(doc, ctx); }
        const est = EST[e.estado];

        doc.setFillColor(...est.bg);
        doc.rect(P.ml, y, P.cw, 12, 'F');
        doc.setFillColor(...est.fg);
        doc.rect(P.ml, y, 1.2, 12, 'F');
        font(doc, 9.5, 'bold', TINTA);
        const nro = 'OC ' + oc.nroOC;
        doc.text(nro, P.ml + 4, y + 5);
        const wn = doc.getTextWidth(nro);
        font(doc, 8.5, 'normal', TINTA);
        doc.text(fit(doc, '· ' + (oc.proveedor?.nombre || 'Sin proveedor'), 120 - wn), P.ml + 5.5 + wn, y + 5);
        const ult = e.remitos[0];
        font(doc, 7.3, 'normal', GRIS);
        doc.text([`Fecha OC ${fechaTxt(oc.fecha) || '—'}`,
          e.remitos.length ? `${e.remitos.length} remito${e.remitos.length !== 1 ? 's' : ''} · último ${ult.nro || ''} del ${fechaTxt(ult.fecha)}` : 'Ningún remito todavía']
          .join('  ·  '), P.ml + 4, y + 9.4);

        const xr = P.ml + P.cw - 3;
        font(doc, 7.5, 'bold', est.fg);
        doc.text(est.txt.toUpperCase(), xr, y + 4.6, { align: 'right' });
        barra(doc, xr - 46, y + 7, 36, 2.8, e.pct, e.estado);
        font(doc, 8.5, 'bold', est.fg);
        doc.text(e.pct + '%', xr, y + 9.4, { align: 'right' });
        y += 12;

        if (faltan.length) {
          y = tabla(doc, y, icols, faltan.map(({ it, ped, rec }) => ({
            bg: BLANCO,
            celdas: [
              { v: it.desc || '(sin descripción)', wrap: true },
              { v: it.unidad || '', color: GRIS },
              { v: qty(ped), color: GRIS },
              { v: qty(rec), color: rec > 0 ? TINTA : GRIS },
              { v: qty(ped - rec), bold: true, color: rec > 0 ? EST.parcial.fg : ROJO }
            ]
          })), ctx, P.ml + 4);
        }
        y += 5;
      });
    }

    if (listas.length) {
      if (y + 22 > P.maxY) { doc.addPage(); y = encabezadoCorto(doc, ctx); }
      y += 2;
      y = titulo(doc, y, 'Entregadas', `${listas.length} OC`) + 2;
      const lcols = [
        { t: 'N° OC', w: 32 }, { t: 'Proveedor', w: 70 }, { t: 'Fecha OC', w: 22, a: 'center' },
        { t: 'Remitos', w: 18, a: 'center' }, { t: 'Último remito', w: 44 }
      ];
      tabla(doc, y, lcols, listas.map(({ oc, e }) => {
        const ult = e.remitos[0];
        return {
          acento: EST.completa.fg,
          celdas: [
            { v: oc.nroOC, bold: true },
            { v: oc.proveedor?.nombre || '—', wrap: true },
            { v: fechaTxt(oc.fecha) },
            { v: String(e.remitos.length) },
            { v: ult ? `${ult.nro || '—'} · ${fechaTxt(ult.fecha)}` : '—' }
          ]
        };
      }), ctx);
    }

    if (!filas.length) {
      font(doc, 9, 'normal', GRIS);
      doc.text('Esta obra no tiene órdenes de compra.', P.ml, y);
    }

    pies(doc);
    return doc;
  }

  // ── API ───────────────────────────────────────────────────────────────────

  // Las dos devuelven un Blob application/pdf.
  window.entregasPdfOC = async function (oc, remitos) {
    await ensureJsPDF();
    return docOC(oc, (remitos || []).filter(r => r.nroOC === oc.nroOC)).output('blob');
  };

  window.entregasPdfObra = async function (obra, ocs, remitos) {
    await ensureJsPDF();
    return docObra(obra, ocs || [], remitos || []).output('blob');
  };
})();
