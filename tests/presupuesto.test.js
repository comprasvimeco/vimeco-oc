const test = require('node:test');
const assert = require('node:assert');
const { presNum, presMonto, plazoFin, plazoAvance, presEdicion, presVacio, presNodos, presClave } = require('../js/presupuesto.js');

const dma = d => [d.getDate(), d.getMonth() + 1, d.getFullYear()].join('/');

test('presNum lee montos escritos a mano', () => {
  assert.strictEqual(presNum('420.000.000'), 420000000);
  assert.strictEqual(presNum('$ 1.500,75'), 1500);
  assert.strictEqual(presNum('US$ 180000'), 180000);
  assert.strictEqual(presNum(''), 0);
  assert.strictEqual(presNum('abc'), 0);
  assert.strictEqual(presNum(-5), 0);
  assert.strictEqual(presMonto(180000, 'USD'), 'US$ 180.000');
  assert.strictEqual(presMonto(0, 'ARS'), '$ 0');
});

test('plazoFin en días corridos y en meses (último día si el mes es más corto)', () => {
  assert.strictEqual(dma(plazoFin('2026-03-02', 14, 'meses')), '2/5/2027');
  assert.strictEqual(dma(plazoFin('2026-01-31', 1, 'meses')), '28/2/2026');
  assert.strictEqual(dma(plazoFin('2026-02-16', 300, 'dias')), '13/12/2026');
});

test('plazoAvance: 0 antes de empezar, más de 100 vencido', () => {
  const pl = { inicio: '2026-01-01', n: 10, unidad: 'dias' };
  assert.strictEqual(plazoAvance(pl, new Date(2025, 11, 20)), 0);
  assert.strictEqual(plazoAvance(pl, new Date(2026, 0, 6)), 50);
  assert.strictEqual(plazoAvance(pl, new Date(2026, 0, 21)), 200);
});

test('presEdicion ignora lo roto y presVacio lo detecta', () => {
  const f = presEdicion({ presupuesto: { moneda: 'EUR', total: 5 }, plazo: { inicio: 'ayer', n: 3, unidad: 'dias' } });
  assert.ok(presVacio(f));
  const g = presEdicion({ presupuesto: { moneda: 'USD', total: 1000, rubros: { a: 300, b: 'x' } }, plazo: { inicio: '2026-03-02', n: 14, unidad: 'meses' } });
  assert.deepStrictEqual(g, { moneda: 'USD', total: 1000, rubros: { a: 300 }, inicio: '2026-03-02', n: 14, unidad: 'meses' });
  assert.ok(!presVacio(g));
});

test('presNodos arma lo que se guarda y descarta rubros que ya no están', () => {
  const f = { moneda: 'ARS', total: 1000, rubros: { a: 300, viejo: 200 }, inicio: '', n: 0, unidad: 'meses' };
  assert.deepStrictEqual(presNodos(f, ['a', 'b']), { presupuesto: { moneda: 'ARS', total: 1000, rubros: { a: 300 } }, plazo: null });
  assert.deepStrictEqual(presNodos({ ...f, rubros: {} }, ['a']), { presupuesto: { moneda: 'ARS', total: 1000 }, plazo: null });
  const vacio = presEdicion(null);
  assert.deepStrictEqual(presNodos(vacio, []), { presupuesto: null, plazo: null });
  assert.deepStrictEqual(presNodos({ ...vacio, inicio: '2026-10-13', n: 90, unidad: 'dias' }, []).plazo, { inicio: '2026-10-13', n: 90, unidad: 'dias' });
});

test('presNodos rechaza lo que no cierra', () => {
  const f = { moneda: 'ARS', total: 1000, rubros: {}, inicio: '', n: 0, unidad: 'meses' };
  assert.match(presNodos({ ...f, rubros: { a: 1200 } }, ['a']).error, /más que el total/);
  assert.match(presNodos({ ...f, total: 0, rubros: { a: 10 } }, ['a']).error, /Falta el total/);
  assert.match(presNodos({ ...f, n: 3 }, []).error, /inicio/);
  assert.match(presNodos({ ...f, inicio: '2026-10-13' }, []).error, /Falta el plazo/);
  assert.match(presNodos({ ...f, inicio: '2026-10-13', n: 241 }, []).error, /240 meses/);
});

test('presClave: cambiar la moneda o la unidad sin monto ni plazo no es un cambio', () => {
  const a = presEdicion(null), b = { ...a, moneda: 'USD', unidad: 'dias' };
  assert.strictEqual(presClave(a, []), presClave(b, []));
  assert.notStrictEqual(presClave({ ...a, total: 5 }, []), presClave({ ...b, total: 5 }, []));
  // Quitar un rubro sin monto no cambia el presupuesto; uno con monto, sí.
  const c = { ...a, total: 10, rubros: { x: 4 } };
  assert.strictEqual(presClave(c, ['x', 'y']), presClave(c, ['x']));
  assert.notStrictEqual(presClave(c, ['x']), presClave(c, []));
});
