const test = require('node:test');
const assert = require('node:assert');
const { factorDescuento, unitarioNeto, normalizarComparacion, armarCuadro } = require('../js/cotizacionCalc.js');

// Los dos presupuestos de adhesivos de la prueba del 22/10/2026.
const contigiani = {
  proveedor: 'CONTIGIANI', precios_incluyen_iva: false, descuento: null, total_documento: 3771360.88,
  items: [
    { descripcion: 'WEBER PORCELLANATO FLEX ADHESIVO X 25 KG. (64)', unidad: 'UN', cantidad: 64, precio_unitario: 19542.53 },
    { descripcion: 'WEBER SUPERFLEX ADHESIVO X 25 KG. (64)', unidad: 'UN', cantidad: 64, precio_unitario: 28156.61 }
  ]
};
const carignani = {
  proveedor: 'CARIGNANI', precios_incluyen_iva: true, descuento: null, total_documento: 3906546.81,
  items: [
    { descripcion: 'PEGAMENTO FLEX TECTOR HOLCIM X 25KG (80)', unidad: 'u', cantidad: 80, precio_unitario: 21924.13 },
    { descripcion: 'PEGAMENTO SUPER FLEX TECTOR HOLCIM X 25KG (80)', unidad: 'u', cantidad: 80, precio_unitario: 26907.70 }
  ]
};
const crudo = {
  presupuestos: [
    { id: 'P1', moneda: 'ARS', condiciones: { pago: 'Contrareembolso', percepciones: 'IIBB Córdoba $ 77.539,72' } },
    { id: 'P2', moneda: 'ARS', condiciones: { pago: null } }
  ],
  renglones: [
    { nombre: 'Adhesivo flex 25 kg', unidad_comun: 'bolsa', grado: 'parecido', items: { P1: { idx: 0, factor: 1 }, P2: { idx: 0, factor: 1, iva_pct: 21 } } },
    { nombre: 'Adhesivo superflex 25 kg', unidad_comun: 'bolsa', grado: 'parecido', items: { P1: { idx: 1, factor: 1 }, P2: { idx: 1, factor: 1, iva_pct: 21 } } }
  ],
  avisos: ['Cada uno cotizó un pallet: 64 contra 80 bolsas.', '']
};

test('unitarioNeto saca el IVA incluido y aplica el descuento global', () => {
  assert.strictEqual(unitarioNeto(carignani, 0, 21), 18119.12);
  assert.strictEqual(unitarioNeto(carignani, 1, null), 22237.77);
  assert.strictEqual(unitarioNeto(contigiani, 0, null), 19542.53);
  const conDesc = { ...contigiani, descuento: { porcentaje: 10, monto: 0 } };
  assert.strictEqual(unitarioNeto(conDesc, 0, null), 17588.28);
  const porMonto = { items: [{ cantidad: 2, precio_unitario: 50 }, { cantidad: 1, precio_unitario: 100 }], descuento: { porcentaje: null, monto: 20 } };
  assert.strictEqual(factorDescuento(porMonto), 0.9);
});

test('normalizarComparacion descarta índices inventados o repetidos y agrega lo no nombrado', () => {
  const malo = {
    renglones: [
      { nombre: 'A', grado: 'igual', items: { P1: { idx: 0, factor: 1 }, P2: { idx: 7, factor: 1 } } },
      { nombre: 'B', grado: 'igual', items: { P1: { idx: 0, factor: 1 } } },   // repetido: sale
      { nombre: 'C', grado: 'raro', items: { P9: { idx: 0 } } }               // presupuesto que no existe
    ]
  };
  const c = normalizarComparacion(malo, ['a', 'b'], [contigiani, carignani]);
  assert.deepStrictEqual(c.renglones.map(r => r.nombre), ['A', contigiani.items[1].descripcion, carignani.items[0].descripcion, carignani.items[1].descripcion]);
  assert.deepStrictEqual(Object.keys(c.renglones[0].items), ['a']);
});

test('armarCuadro: con marcas distintas no hay cuenta justa, sí la amplia, a la misma cantidad', () => {
  const comp = normalizarComparacion(crudo, ['c', 'k'], [contigiani, carignani]);
  assert.deepStrictEqual(comp.avisos, ['Cada uno cotizó un pallet: 64 contra 80 bolsas.']);
  const q = armarCuadro(comp, [contigiani, carignani]);
  assert.strictEqual(q.justa, null);
  assert.ok(q.amplia);
  assert.strictEqual(q.filas[0].cant, 80);                  // la mayor cotizada
  assert.strictEqual(q.filas[0].mejor, 'k');
  assert.strictEqual(q.filas[1].mejor, 'k');
  assert.strictEqual(q.amplia.mejor, 'k');
  // A 64 bolsas de cada uno, como el presupuesto de Contigiani.
  const q64 = armarCuadro(comp, [contigiani, carignani], { cantidades: { 0: 64, 1: 64 } });
  assert.strictEqual(q64.amplia.totales.c, 3052744.96);
  assert.strictEqual(q64.amplia.totales.k, 2582840.96);
  assert.strictEqual(q64.amplia.dif.c, 18.19);
  assert.strictEqual(q.totalDoc.k.neto, 3228551.2);
});

test('armarCuadro: igual entra en la cuenta justa; distinto y dólares sin cotización quedan afuera', () => {
  const a = { precios_incluyen_iva: false, items: [{ descripcion: 'Ø8', unidad: 'u', cantidad: 10, precio_unitario: 9850 }, { descripcion: 'malla 4,2', unidad: 'u', cantidad: 2, precio_unitario: 50 }] };
  const b = { precios_incluyen_iva: false, items: [{ descripcion: 'hierro 8 x tn', unidad: 'tn', cantidad: 0.0474, precio_unitario: 2000000 }, { descripcion: 'malla 5', unidad: 'u', cantidad: 2, precio_unitario: 40 }] };
  const comp = normalizarComparacion({
    presupuestos: [{ id: 'P1' }, { id: 'P2', moneda: 'ARS' }],
    renglones: [
      { nombre: 'Hierro Ø8', unidad_comun: 'barra', grado: 'igual', items: { P1: { idx: 0, factor: 1 }, P2: { idx: 0, factor: 211 } } },
      { nombre: 'Malla', unidad_comun: 'u', grado: 'igual', items: { P1: { idx: 1, factor: 1 }, P2: { idx: 1, factor: 1, distinto: true, nota: 'Ø5' } } }
    ]
  }, ['a', 'b'], [a, b]);
  const q = armarCuadro(comp, [a, b]);
  assert.strictEqual(q.filas[0].celdas.b.comun, 9478.67);   // 2.000.000 / 211
  assert.strictEqual(q.filas[0].mejor, 'b');
  assert.strictEqual(q.filas[1].mejor, null);               // sólo una válida
  assert.deepStrictEqual(q.justa.filas, [0]);
  assert.strictEqual(q.amplia, null);                       // no agrega nada a la justa

  comp.presupuestos.b.moneda = 'USD';
  const sinTc = armarCuadro(comp, [a, b]);
  assert.strictEqual(sinTc.filas[0].celdas.b.comun, null);
  assert.strictEqual(sinTc.justa, null);
});
