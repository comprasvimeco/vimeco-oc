/* =====================================================
   VIMECO S.A. — Informe en PDF de una comparativa de presupuestos
   cotizacionPDF.js

   Lo que muestra Cotizaciones de una comparativa, en papel: quién cotizó, las
   cuentas (mismo producto / con parecidos / todo lo cotizado), lo que avisó la
   IA, el cuadro renglón por renglón y las condiciones. Se arma con lo guardado
   en /cotizaciones/{id}; lo abre Archivo junto a la OC que salió de ella.

   Requiere: cotizacionCalc.js (cuadroDeCotizacion). jsPDF y el logo se cargan a
   demanda si la página no los trae.
   ===================================================== */

/* global LOGO_BASE64, cuadroDeCotizacion */

(function () {
  'use strict';

  // ── Carga diferida de jsPDF y el logo (como entregasPDF.js) ───────────────

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
        if (typeof LOGO_BASE64 === 'undefined') await cargarScript('js/logoBase64.js').catch(() => {});
      })().catch(e => { _carga = null; throw e; });
    }
    return _carga;
  }

  // ── Paleta y geometría (A4 apaisado: hasta seis presupuestos en columnas) ─

  const AZUL = [43, 57, 70], AZUL_MED = [61, 81, 102];
  const BLANCO = [255, 255, 255], TINTA = [33, 37, 41], GRIS = [110, 117, 125];
  const LINEA = [222, 226, 230], FONDO = [246, 247, 249];
  const VERDE = [46, 125, 50], VERDE_BG = [227, 245, 232];
  const AMBAR = [184, 115, 0], AMBAR_BG = [255, 244, 224];

  const P = { w: 297, h: 210, ml: 12, mt: 12, cw: 273, maxY: 194 };

  // ── Formato ───────────────────────────────────────────────────────────────

  const pad2 = n => String(n).padStart(2, '0');
  const fecha = ts => { const d = new Date(ts); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const pesos = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const enMoneda = (n, usd) => (usd ? 'US$ ' : '$ ') + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cant = n => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const pct = n => (n > 0 ? '+' : '') + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const ahora = () => new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
  // Sin el código de proveedor del principio («2448 CARIGNANI…»), como en la tarjeta.
  const nombrePresu = p => String((p && ((p.lectura && p.lectura.proveedor) || p.nombre)) || 'Presupuesto').replace(/^\d+\s*[-–]?\s+/, '');

  function font(doc, size, estilo = 'normal', color = TINTA) {
    doc.setFont('helvetica', estilo);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }

  function fit(doc, s, w) {
    s = String(s || '');
    if (doc.getTextWidth(s) <= w) return s;
    while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  // ── Piezas ────────────────────────────────────────────────────────────────

  function encabezado(doc, sub, grande, debajo) {
    const x0 = P.ml, y = P.mt, H = 26;
    doc.setFillColor(...AZUL);
    doc.rect(x0, y, P.cw, H, 'F');

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
    doc.text('COMPARATIVA DE PRESUPUESTOS', xt, y + 11);
    font(doc, 10, 'normal', BLANCO);
    doc.text(fit(doc, sub, xr - xt - 70), xt, y + 18.5);

    font(doc, 19, 'bold', BLANCO);
    doc.text(grande, xr, y + 13, { align: 'right' });
    font(doc, 7.5, 'bold', [200, 214, 230]);
    doc.text(debajo.toUpperCase(), xr, y + 19.5, { align: 'right' });
    return y + H;
  }

  function encabezadoCorto(doc, titulo) {
    font(doc, 8, 'bold', GRIS);
    doc.text(fit(doc, 'Comparativa de presupuestos — ' + titulo, P.cw), P.ml, P.mt + 2);
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
      doc.text(`VIMECO S.A. · Generado el ${ahora()} con lo guardado en Cotizaciones · Precios sin IVA, en pesos`, P.ml, P.h - 8);
      doc.text(`Página ${i} de ${n}`, P.ml + P.cw, P.h - 8, { align: 'right' });
    }
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

  // Si no entra `alto` en la página, sigue en otra.
  function lugar(doc, y, alto, ctx) {
    if (y + alto <= P.maxY) return y;
    doc.addPage();
    return encabezadoCorto(doc, ctx);
  }

  // Tabla con salto de página. `cols` = [{ t, w, a }]; `filas` = [{ celdas:
  // [{ v (string|string[]), color, bold, wrap, size, bg }], bg, acento, bold }].
  function tabla(doc, y, cols, filas, ctx) {
    const x0 = P.ml;
    const W = cols.reduce((s, c) => s + c.w, 0);
    const cabecera = yy => {
      doc.setFillColor(...AZUL_MED);
      doc.rect(x0, yy, W, 6.5, 'F');
      font(doc, 7.3, 'bold', BLANCO);
      let x = x0;
      cols.forEach(c => {
        const tx = c.a === 'right' ? x + c.w - 2 : c.a === 'center' ? x + c.w / 2 : x + 2;
        doc.text(fit(doc, c.t, c.w - 4), tx, yy + 4.4, { align: c.a || 'left' });
        x += c.w;
      });
      return yy + 6.5;
    };
    y = cabecera(y);
    filas.forEach((f, fi) => {
      const celdas = f.celdas.map((c, i) => {
        font(doc, c.size || 8.3, c.bold ? 'bold' : 'normal');
        const vs = [].concat(c.v ?? '');
        const lineas = c.wrap ? vs.flatMap(v => doc.splitTextToSize(String(v), cols[i].w - 4)) : vs.map(String);
        return { ...c, lineas };
      });
      const nl = Math.max(1, ...celdas.map(c => c.lineas.length));
      const h = Math.max(7, nl * 3.6 + 3.4);
      if (y + h > P.maxY) {
        doc.addPage();
        y = cabecera(encabezadoCorto(doc, ctx));
      }
      doc.setFillColor(...(f.bg || (fi % 2 ? FONDO : BLANCO)));
      doc.rect(x0, y, W, h, 'F');
      let x = x0;
      celdas.forEach((c, i) => {
        if (c.bg) { doc.setFillColor(...c.bg); doc.rect(x, y, cols[i].w, h, 'F'); }
        x += cols[i].w;
      });
      if (f.acento) { doc.setFillColor(...f.acento); doc.rect(x0, y, 1.2, h, 'F'); }
      doc.setDrawColor(...LINEA);
      doc.setLineWidth(0.2);
      doc.line(x0, y + h, x0 + W, y + h);

      x = x0;
      celdas.forEach((c, i) => {
        const col = cols[i];
        const tx = col.a === 'right' ? x + col.w - 2 : col.a === 'center' ? x + col.w / 2 : x + 2 + (i === 0 && f.acento ? 0.8 : 0);
        const ty = y + (h - (c.lineas.length - 1) * 3.6) / 2 + 1.1;
        // La primera línea con el estilo de la celda; las que siguen, chicas y grises.
        c.lineas.forEach((l, k) => {
          if (k === 0 || c.wrap) font(doc, c.size || 8.3, c.bold ? 'bold' : 'normal', c.color || TINTA);
          else font(doc, 6.6, 'normal', GRIS);
          doc.text(l, tx, ty + k * 3.6, { align: col.a || 'left' });
        });
        x += col.w;
      });
      y += h;
    });
    return y;
  }

  // ── El informe ────────────────────────────────────────────────────────────

  function docCotizacion(cot, { nroOC, tc } = {}) {
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const { comp, q } = cuadroDeCotizacion(cot, { tc });
    const c = cot.comparacion;
    const pids = q.pids;
    const nom = pid => nombrePresu(cot.presupuestos[pid]);
    const elegido = cot.oc && cot.oc.pid;
    const ctx = cot.titulo || '';
    const usdSinTc = pids.some(pid => (comp.presupuestos[pid] || {}).moneda === 'USD') && !tc;

    let y = encabezado(doc, `${cot.titulo || ''} · ${cot.obra || ''}`,
      nroOC ? 'OC ' + nroOC : `${pids.length} presupuestos`, nroOC ? `Elegido: ${elegido ? nom(elegido) : '—'}` : 'Sin OC');

    y = datos(doc, y + 8, [
      ['Obra', cot.obra || '—', 70],
      ['Creada por', ((cot.creadoPor && cot.creadoPor.nombre) || '—') + (cot.ts ? ' · ' + fecha(cot.ts) : ''), 70],
      ['Presupuestos', String(pids.length), 30],
      ['Comparada', (c.ts ? fecha(c.ts) : '—') + (c.modelo ? ' · ' + c.modelo : ''), 103]
    ]);

    // Resumen: una fila por presupuesto, del más barato al más caro.
    const cta = q.justa || q.amplia;
    const orden = cta ? cta.orden : pids;
    y = titulo(doc, y + 5, 'Resumen', 'sin IVA, a la misma cantidad') + 1;
    const colsRes = [{ t: 'Proveedor', w: 83 }];
    if (q.justa) colsRes.push({ t: `Mismo producto (${q.justa.filas.length} renglones)`, w: 52, a: 'right' }, { t: 'Diferencia', w: 22, a: 'right' });
    if (q.amplia) colsRes.push({ t: `Con parecidos (${q.amplia.filas.length} renglones)`, w: 52, a: 'right' }, { t: 'Diferencia', w: 22, a: 'right' });
    colsRes.push({ t: 'Todo lo cotizado', w: 42, a: 'right' });
    const resto = P.cw - colsRes.reduce((s, x) => s + x.w, 0);
    if (resto > 0) colsRes.push({ t: 'Notas', w: resto });
    y = tabla(doc, y, colsRes, orden.map(pid => {
      const t = q.totalDoc[pid];
      const celdas = [{ v: nom(pid), bold: true, wrap: true }];
      [q.justa, q.amplia].filter(Boolean).forEach(x => {
        const gana = x.mejor === pid;
        celdas.push({ v: pesos(x.totales[pid]), bold: gana, color: gana ? VERDE : TINTA },
          { v: gana ? 'el más barato' : x.dif[pid] ? pct(x.dif[pid]) : '', color: gana ? VERDE : GRIS, size: 7.6 });
      });
      celdas.push({ v: enMoneda(t.neto, t.usd) });
      const notas = [pid === elegido ? 'Elegido para la OC' : null, q.faltan[pid] ? `no cotiza ${q.faltan[pid]} ${q.faltan[pid] === 1 ? 'renglón' : 'renglones'}` : null].filter(Boolean).join(' · ');
      if (resto > 0) celdas.push({ v: notas, color: pid === elegido ? VERDE : GRIS, bold: pid === elegido, size: 7.6, wrap: true });
      return { celdas, acento: pid === elegido ? VERDE : null };
    }), ctx);
    if (!cta) {
      font(doc, 8, 'normal', GRIS);
      doc.text('No hay renglones que coticen todos: las cuentas van renglón por renglón.', P.ml, y + 4);
      y += 4;
    }
    if (usdSinTc) {
      font(doc, 8, 'normal', AMBAR);
      doc.text('Hay un presupuesto en dólares sin cotización guardada: queda afuera de las cuentas.', P.ml, y + 4);
      y += 4;
    }

    // Lo que avisó la IA
    if (comp.avisos.length) {
      y = lugar(doc, y + 8, 16, ctx);
      y = titulo(doc, y, 'Para revisar', 'lo que avisó la IA al emparejar') + 2;
      comp.avisos.forEach(a => {
        font(doc, 8.3, 'normal', TINTA);
        const ls = doc.splitTextToSize(String(a), P.cw - 6);
        y = lugar(doc, y, ls.length * 3.8 + 1, ctx);
        doc.setFillColor(...AMBAR);
        doc.circle(P.ml + 1.3, y + 1.6, 0.8, 'F');
        doc.text(ls, P.ml + 4, y + 2.6, { lineHeightFactor: 1.3 });
        y += ls.length * 3.8 + 1;
      });
    }

    // Cuadro renglón por renglón
    y = lugar(doc, y + 8, 30, ctx);
    y = titulo(doc, y, 'Renglón por renglón', 'precio unitario sin IVA, por la unidad del renglón') + 1;
    const wP = Math.min(42, (P.cw - 86 - 26) / pids.length);
    const tam = pids.length > 4 ? 7.6 : 8.3;
    const colsCua = [{ t: 'Renglón', w: P.cw - 26 - wP * pids.length }, { t: 'Cantidad', w: 26, a: 'right' },
      ...pids.map(pid => ({ t: nom(pid), w: wP, a: 'right' }))];
    const filas = q.filas.map(f => {
      const parecido = f.grado === 'parecido' && Object.keys(f.celdas).length > 1;
      return {
        celdas: [
          { v: [f.nombre, parecido ? 'Parecido' + (f.motivo ? ': ' + f.motivo : '') : null].filter(Boolean), wrap: true },
          { v: [cant(f.cant), f.unidad] },
          ...pids.map(pid => {
            const x = f.celdas[pid];
            if (!x) return { v: 'no cotiza', color: GRIS, size: 7.4 };
            const gana = f.mejor === pid;
            const sub = x.comun == null ? 'sin cotización del dólar'
              : x.distinto ? 'no es lo mismo'
              : x.usd ? `de US$ ${cant(x.neto)}`
              : x.factor !== 1 ? `${pesos(x.neto)} por ${x.unidadDoc}` : '';
            return { v: [x.comun == null ? enMoneda(x.neto, true) : pesos(x.comun), sub].filter(Boolean),
              bold: gana, color: gana ? VERDE : x.distinto ? AMBAR : TINTA, size: tam, bg: gana ? VERDE_BG : x.distinto ? AMBAR_BG : null };
          })
        ]
      };
    });
    const filaTot = (x, txt, sub) => x ? [{
      bg: FONDO, celdas: [{ v: [txt, sub], bold: true }, { v: '' },
        ...pids.map(pid => ({ v: [pesos(x.totales[pid]), x.mejor === pid ? 'el más barato' : x.dif[pid] ? pct(x.dif[pid]) : ''].filter(Boolean),
          bold: true, color: x.mejor === pid ? VERDE : TINTA, size: tam }))]
    }] : [];
    filas.push(...filaTot(q.justa, 'Mismo producto', 'renglones iguales en todos'),
      ...filaTot(q.amplia, 'Con parecidos', 'suma también otra marca o línea'),
      { bg: FONDO, celdas: [{ v: ['Todo lo cotizado', 'cantidades de cada presupuesto'], bold: true }, { v: '' },
        ...pids.map(pid => { const t = q.totalDoc[pid]; return { v: [enMoneda(t.neto, t.usd), t.documento ? 'documento ' + enMoneda(t.documento, t.usd) : ''].filter(Boolean), bold: true, size: tam }; })] });
    y = tabla(doc, y, colsCua, filas, ctx);

    // Condiciones
    const CONDS = [['pago', 'Pago'], ['entrega', 'Entrega'], ['validez', 'Validez'], ['flete', 'Flete'], ['percepciones', 'Percepciones'], ['otros', 'Otros']];
    const cond = (pid, k) => ((comp.presupuestos[pid] || {}).condiciones || {})[k];
    const filasCond = CONDS.filter(([k]) => pids.some(pid => cond(pid, k)))
      .map(([k, t]) => ({ celdas: [{ v: t, bold: true }, ...pids.map(pid => ({ v: cond(pid, k) || '—', wrap: true, size: 7.6 }))] }));
    if (pids.some(pid => (comp.presupuestos[pid] || {}).numero || (comp.presupuestos[pid] || {}).fecha))
      filasCond.push({ celdas: [{ v: 'Presupuesto', bold: true }, ...pids.map(pid => {
        const pr = comp.presupuestos[pid] || {};
        return { v: [pr.numero ? 'N° ' + pr.numero : null, pr.fecha].filter(Boolean).join(' · ') || '—', wrap: true, size: 7.6 };
      })] });
    if (filasCond.length) {
      y = lugar(doc, y + 8, 24, ctx);
      y = titulo(doc, y, 'Condiciones') + 1;
      const wC = (P.cw - 30) / pids.length;
      tabla(doc, y, [{ t: '', w: 30 }, ...pids.map(pid => ({ t: nom(pid), w: wC }))], filasCond, ctx);
    }

    pies(doc);
    return doc;
  }

  // ── API ───────────────────────────────────────────────────────────────────

  // Blob application/pdf. `nroOC`: la OC que salió de la comparativa; `tc`: el
  // dólar oficial para pasar a pesos lo cotizado en dólares.
  window.cotizacionPdf = async function (cot, opts) {
    await ensureJsPDF();
    return docCotizacion(cot, opts).output('blob');
  };

  window.nombreCotizacionPdf = cot =>
    ('Comparativa ' + (cot.titulo || '') + ' - ' + (cot.obra || '')).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
})();
