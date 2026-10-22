/* Cuentas del cuadro comparativo de Cotizaciones.

     /cotizaciones/{id} = {
       titulo, obra, creadoPor: { codigo, nombre }, ts, estado: 'abierta'|'cerrada',
       presupuestos: { pid: { nombre, fileId, mime, size, ts, subidoPor, estado: 'leido'|'error', lectura, error? } },
       comparacion:  { ts, modelo, flojo, pids: [..], presupuestos: { pid: {...} }, renglones: [..], avisos: [..] },
       cantidades:   { nroRenglón: cantidad en la unidad común },
       oc:           { nroOC, pid, ts }   (al generar la OC)
     }

   `lectura` es lo que devuelve extractFromFile (lo mismo que precarga la OC). La IA
   sólo empareja renglones por índice y dice factor de unidad e IVA: todos los
   precios y totales salen de acá, con los números de cada lectura. */

const COT_IVA_DEF = 21;
const _r2 = n => Math.round(n * 100) / 100;

// Un descuento global que NO viene ya aplicado en los precios se reparte entre
// los ítems: por porcentaje tal cual, por monto en proporción a lo que suman.
function factorDescuento(lectura) {
  const d = lectura && lectura.descuento;
  if (!d) return 1;
  if (d.porcentaje > 0) return Math.max(0, 1 - d.porcentaje / 100);
  const suma = (lectura.items || []).reduce((s, it) => s + (it.cantidad || 0) * (it.precio_unitario || 0), 0);
  return d.monto > 0 && suma > 0 ? Math.max(0, 1 - d.monto / suma) : 1;
}

// Precio unitario sin IVA y con el descuento global, en la unidad del documento.
function unitarioNeto(lectura, idx, ivaPct) {
  const it = lectura && lectura.items && lectura.items[idx];
  if (!it) return null;
  let u = (it.precio_unitario || 0) * factorDescuento(lectura);
  if (lectura.precios_incluyen_iva === true) u /= 1 + (ivaPct > 0 ? ivaPct : COT_IVA_DEF) / 100;
  return _r2(u);
}

// Lo que devolvió el modelo, filtrado contra lo que existe: un índice inventado o
// repetido pondría un precio en el renglón equivocado. Los ítems que el modelo no
// nombró se agregan como renglones propios, para que nada se pierda del cuadro.
function normalizarComparacion(crudo, pids, lecturas) {
  const porId = {};
  pids.forEach((pid, i) => { porId['P' + (i + 1)] = pid; });
  const usados = pids.map(() => new Set());
  const renglones = [];

  for (const r of (crudo && crudo.renglones) || []) {
    const items = {};
    let n = 0;
    for (const [pId, it] of Object.entries(r.items || {})) {
      const pid = porId[pId];
      if (!pid || !it) continue;
      const i = pids.indexOf(pid);
      const idx = Number(it.idx);
      if (!Number.isInteger(idx) || idx < 0 || idx >= ((lecturas[i] && lecturas[i].items) || []).length) continue;
      if (usados[i].has(idx)) continue;
      usados[i].add(idx);
      const factor = Number(it.factor);
      items[pid] = {
        idx,
        factor:   factor > 0 && isFinite(factor) ? factor : 1,
        iva_pct:  Number(it.iva_pct) > 0 ? Number(it.iva_pct) : null,
        distinto: it.distinto === true,
        nota:     it.nota ? String(it.nota) : null
      };
      n++;
    }
    if (!n) continue;
    renglones.push({
      nombre:      String(r.nombre || '').trim() || 'Sin nombre',
      unidad:      String(r.unidad_comun || '').trim() || 'u',
      grado:       r.grado === 'igual' ? 'igual' : 'parecido',
      motivo:      r.motivo ? String(r.motivo) : null,
      items
    });
  }

  pids.forEach((pid, i) => {
    ((lecturas[i] && lecturas[i].items) || []).forEach((it, idx) => {
      if (usados[i].has(idx)) return;
      renglones.push({
        nombre: it.descripcion || 'Sin nombre', unidad: it.unidad || 'u', grado: 'igual', motivo: null,
        items: { [pid]: { idx, factor: 1, iva_pct: null, distinto: false, nota: null } }
      });
    });
  });

  const presupuestos = {};
  ((crudo && crudo.presupuestos) || []).forEach(p => {
    const pid = porId[p && p.id];
    if (!pid) return;
    const c = p.condiciones || {};
    const txt = v => (v == null || String(v).trim() === '' || String(v) === 'null') ? null : String(v).trim();
    presupuestos[pid] = {
      moneda: p.moneda === 'USD' ? 'USD' : 'ARS',
      fecha: txt(p.fecha), numero: txt(p.numero),
      condiciones: { pago: txt(c.pago), entrega: txt(c.entrega), validez: txt(c.validez),
                     flete: txt(c.flete), percepciones: txt(c.percepciones), otros: txt(c.otros) }
    };
  });

  const avisos = ((crudo && crudo.avisos) || []).map(a => String(a || '').trim()).filter(Boolean).slice(0, 8);
  return { pids: pids.slice(), presupuestos, renglones, avisos };
}

/* El cuadro: una fila por renglón y una celda por presupuesto, en pesos sin IVA
   y en la unidad común. `tc` pasa a pesos lo cotizado en dólares (sin tc, esas
   celdas quedan afuera de las cuentas). `cantidades` pisa la cantidad de cada
   renglón; si no, se toma la mayor cotizada.

   Dos cuentas, sobre los renglones que cotizan TODOS (y ninguno «distinto»):
   - justa: sólo los de grado «igual»: el único número que dice «es más barato».
   - amplia: también los «parecido» (otra marca): sirve, pero hay que mirarlo. */
function armarCuadro(comparacion, lecturas, { tc = null, cantidades = {} } = {}) {
  const pids = comparacion.pids;
  const lecDe = pid => lecturas[pids.indexOf(pid)];
  const monedaDe = pid => (comparacion.presupuestos[pid] && comparacion.presupuestos[pid].moneda) || 'ARS';

  const filas = comparacion.renglones.map((r, i) => {
    const celdas = {};
    let cantMax = 0;
    for (const pid of pids) {
      const c = r.items[pid];
      if (!c) continue;
      const lec = lecDe(pid);
      const it = lec.items[c.idx];
      const neto = unitarioNeto(lec, c.idx, c.iva_pct);
      const usd = monedaDe(pid) === 'USD';
      const enPesos = usd ? (tc ? neto * tc : null) : neto;
      const comun = enPesos == null ? null : _r2(enPesos / c.factor);
      cantMax = Math.max(cantMax, (it.cantidad || 0) * c.factor);
      celdas[pid] = {
        idx: c.idx, cita: it.descripcion, cantDoc: it.cantidad, unidadDoc: it.unidad,
        unitarioDoc: it.precio_unitario, neto, usd, comun, factor: c.factor,
        ivaIncluido: lec.precios_incluyen_iva === true, distinto: c.distinto, nota: c.nota
      };
    }
    const fijada = Number(cantidades && cantidades[i]);
    const cant = fijada > 0 ? fijada : _r2(cantMax);
    const validas = pids.filter(pid => celdas[pid] && !celdas[pid].distinto && celdas[pid].comun != null);
    let mejor = null;
    if (validas.length >= 2) {
      mejor = validas.reduce((a, b) => celdas[b].comun < celdas[a].comun ? b : a);
      // Un empate no tiene ganador.
      if (validas.filter(pid => celdas[pid].comun === celdas[mejor].comun).length > 1) mejor = null;
    }
    const completa = validas.length === pids.length;
    return { i, nombre: r.nombre, unidad: r.unidad, grado: r.grado, motivo: r.motivo, cant, cantFijada: fijada > 0, celdas, mejor, completa };
  });

  function cuenta(incluyeParecidos) {
    const fs = filas.filter(f => f.completa && (incluyeParecidos || f.grado === 'igual'));
    if (!fs.length || pids.length < 2) return null;
    const totales = {};
    pids.forEach(pid => { totales[pid] = _r2(fs.reduce((s, f) => s + f.celdas[pid].comun * f.cant, 0)); });
    const min = Math.min(...pids.map(pid => totales[pid]));
    const orden = pids.slice().sort((a, b) => totales[a] - totales[b]);
    const dif = {};
    pids.forEach(pid => { dif[pid] = min > 0 ? _r2((totales[pid] / min - 1) * 100) : 0; });
    return { filas: fs.map(f => f.i), totales, orden, dif, mejor: totales[orden[0]] < totales[orden[1]] ? orden[0] : null };
  }

  const justa = cuenta(false);
  const amplia = cuenta(true);
  const faltan = {};   // renglones que otro cotiza y este no
  pids.forEach(pid => { faltan[pid] = filas.filter(f => !f.celdas[pid] && Object.keys(f.celdas).length).length; });

  // Lo que dice cada documento, sin IVA, para el total de la columna.
  const totalDoc = {};
  pids.forEach(pid => {
    const lec = lecDe(pid);
    const items = (lec.items || []).reduce((s, it, idx) => s + (it.cantidad || 0) * (unitarioNeto(lec, idx, null) || 0), 0);
    totalDoc[pid] = { neto: _r2(items), documento: lec.total_documento || null, usd: monedaDe(pid) === 'USD' };
  });

  return { pids, filas, justa, amplia: amplia && justa && amplia.filas.length === justa.filas.length ? null : amplia, faltan, totalDoc };
}

// El cuadro de una comparativa tal como se guarda en /cotizaciones/{id}: RTDB no
// guarda nulls ni objetos vacíos, así que se rearma lo que armarCuadro espera.
// Lo usan la pantalla de Cotizaciones y el informe en PDF (cotizacionPDF.js).
function cuadroDeCotizacion(cot, { tc = null } = {}) {
  const c = cot.comparacion;
  const lecturas = c.pids.map(pid => cot.presupuestos[pid].lectura);
  const comp = {
    pids: c.pids,
    presupuestos: c.presupuestos || {},
    renglones: (c.renglones || []).map(r => ({ ...r, items: r.items || {} })),
    avisos: c.avisos || []
  };
  lecturas.forEach(l => { l.items = l.items || []; });
  return { comp, q: armarCuadro(comp, lecturas, { tc, cantidades: cot.cantidades || {} }) };
}

if (typeof module !== 'undefined') {
  module.exports = { factorDescuento, unitarioNeto, normalizarComparacion, armarCuadro, cuadroDeCotizacion };
}
