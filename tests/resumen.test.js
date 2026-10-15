const test = require('node:test');
const assert = require('node:assert');
const { fraseVariacion, subasDePrecio } = require('../js/reportesResumen.js');

const DIA = 864e5;
const AHORA = new Date(2026, 9, 14, 12).getTime();
const norm = s => String(s || '').toLowerCase().trim();
const deps = { norm, prov: oc => oc.proveedor?.nombre || '—', ahora: AHORA };
const oc = (nro, prov, diasAtras, items, moneda) => ({
  nroOC: nro, proveedor: { nombre: prov }, timestamp: AHORA - diasAtras * DIA, moneda,
  items: items.map(([desc, unitario, cant, unidad]) => ({ desc, unitario: String(unitario), cant: String(cant || 1), unidad })),
});

test('fraseVariacion: sube y una obra explica casi todo', () => {
  const f = fraseVariacion(120, 100, [{ n: 'Galpón Pilar', d: 40, p: 20 }, { n: 'Belgrano', d: 80, p: 80 }]);
  assert.strictEqual(f.cuerpo, 'En los últimos 30 días compraste {M}, 20% más que en los 30 anteriores.');
  assert.strictEqual(f.explica, 'Casi todo el aumento es Galpón Pilar.');
});

test('fraseVariacion: baja repartida, parejo y sin compras', () => {
  const f = fraseVariacion(70, 100, [{ n: 'A', d: 10, p: 20 }, { n: 'B', d: 30, p: 40 }, { n: 'C', d: 30, p: 40 }]);
  assert.strictEqual(f.cuerpo, 'En los últimos 30 días compraste {M}, 30% menos que en los 30 anteriores.');
  assert.strictEqual(f.explica, 'Lo que más bajó fue A.');
  assert.strictEqual(fraseVariacion(102, 100, []).explica, '');
  assert.match(fraseVariacion(102, 100, []).cuerpo, /casi lo mismo/);
  assert.match(fraseVariacion(0, 0, []).cuerpo, /60 días/);
  assert.match(fraseVariacion(50, 0, []).cuerpo, /no hubo compras/);
  assert.match(fraseVariacion(0, 50, []).cuerpo, /^No hubo compras en los últimos 30 días/);
});

test('subasDePrecio: avisa desde 10%, contra la compra anterior al mismo proveedor', () => {
  const ocs = [
    oc('1', 'San Martín', 60, [['Cemento', 10000, 100, 'bolsa'], ['Arena', 100, 5, 'm3']]),
    oc('2', 'San Martín', 5, [['Cemento', 11400, 200, 'bolsa'], ['Arena', 105, 5, 'm3']]),
    oc('3', 'Rivadavia', 20, [['Cemento', 10850, 50, 'bolsa']]),
    oc('4', 'Otro', 10, [['Cemento', 9000, 10, 'kg']]),   // otra unidad: no compara
  ];
  const s = subasDePrecio(ocs, deps);
  assert.strictEqual(s.length, 1);
  const x = s[0];
  assert.strictEqual(x.ult.oc.nroOC, '2');
  assert.strictEqual(x.prev.oc.nroOC, '1');
  assert.strictEqual(Math.round(x.dif * 100), 14);
  assert.strictEqual(x.barato.pn, 'Rivadavia');
  assert.strictEqual(x.cantMes, 100);   // 300 bolsas en 90 días
  assert.strictEqual(x.ahorroMes, 100 * (11400 - 10850));
});

test('subasDePrecio: la suba vieja, la otra moneda y la que ya bajó no avisan', () => {
  const ocs = [
    oc('1', 'A', 100, [['Hierro', 100]]),
    oc('2', 'A', 50, [['Hierro', 130]]),                 // subió, pero hace 50 días
    oc('3', 'B', 40, [['Caño', 100]]),
    oc('4', 'B', 10, [['Caño', 150]], 'USD'),            // otra moneda
    oc('5', 'C', 40, [['Malla', 100]]),
    oc('6', 'C', 20, [['Malla', 130]]),
    oc('7', 'C', 3, [['Malla', 128]]),                   // la última compra no subió
    oc('8', 'D', 300, [['Cal', 100]]),
    oc('9', 'D', 2, [['Cal', 200]]),                     // la anterior está fuera de la ventana
  ];
  assert.deepStrictEqual(subasDePrecio(ocs, deps), []);
});
