const test = require('node:test');
const assert = require('node:assert');
const { granoPara, preciosArticulos, frasePrecio } = require('../js/reportesPrecios.js');

const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const deps = { norm: s => normTxt(s).trim(), normTxt, prov: oc => oc.proveedor?.nombre || '—' };
const oc = (prov, t, items, moneda) => ({ proveedor: { nombre: prov }, timestamp: t, moneda, obra: 'Norte',
  items: items.map(([desc, unitario, unidad]) => ({ desc, unitario: String(unitario), cant: '1', unidad })) });

test('granoPara: el corte se acomoda a los días que hay', () => {
  assert.strictEqual(granoPara(12), 'dia');
  assert.strictEqual(granoPara(21), 'dia');
  assert.strictEqual(granoPara(31), 'semana');
  assert.strictEqual(granoPara(91), 'semana');
  assert.strictEqual(granoPara(182), 'quincena');
  assert.strictEqual(granoPara(304), 'mes');
});

test('preciosArticulos: compara entre proveedores y en el tiempo', () => {
  const [a] = preciosArticulos([
    oc('Corralón', 1, [['Cemento x 50', 100, 'bolsa']]),
    oc('Corralón', 2, [['Cemento x 50', 120, 'bolsa']]),
    oc('Ferretería', 3, [['CEMENTO X 50', 110, 'bolsa']]),
  ], ['cemento'], deps);
  assert.strictEqual(a.compras.length, 3);
  assert.deepStrictEqual(a.provs.map(p => p.pn), ['Ferretería', 'Corralón']);
  assert.strictEqual(a.provs[1].ult.pu, 120);
  assert.ok(Math.abs(a.provs[1].dif - .2) < 1e-9);
  assert.strictEqual(a.provs[0].dif, null);
});

test('preciosArticulos: no mezcla monedas ni unidades; sin unidad va con la usual', () => {
  const r = preciosArticulos([
    oc('A', 1, [['Arena', 10, 'm3']]), oc('B', 2, [['Arena', 12, 'm3']]), oc('C', 3, [['Arena', 11, '']]),
    oc('D', 4, [['Arena', 2, 'bolsa']]), oc('E', 5, [['Arena', 1], ['Otra cosa', 5, 'u']], 'USD'),
  ], ['arena'], deps);
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].compras.length, 3);
  assert.deepStrictEqual(r.map(a => a.cur), ['ARS', 'USD', 'ARS']);
});

test('preciosArticulos: términos del proveedor acotan; el proveedor solo no es un artículo', () => {
  const ocs = [oc('Corralón', 1, [['Cemento', 100, 'bolsa']]), oc('Ferretería', 2, [['Cemento', 90, 'bolsa']])];
  const [a] = preciosArticulos(ocs, ['cemento', 'corralon'], deps);
  assert.deepStrictEqual(a.provs.map(p => p.pn), ['Corralón']);
  assert.strictEqual(preciosArticulos(ocs, ['corralon'], deps).length, 0);
});

test('frasePrecio: dice qué conviene', () => {
  const f = (ocs) => frasePrecio(preciosArticulos(ocs, ['cemento'], deps)[0], v => '$' + v, t => 'd' + t);
  const c = (p, t, v) => oc(p, t, [['Cemento', v, 'bolsa']]);
  assert.strictEqual(f([c('A', 1, 100)]), 'Una sola compra, a $100 el d1.');
  assert.strictEqual(f([c('A', 1, 100), c('A', 2, 100)]), 'A A le pagás lo mismo desde el d1: $100.');
  assert.strictEqual(f([c('A', 1, 100), c('A', 2, 120)]), 'A A le pagabas $100 el d1; ahora, $120 (+20%).');
  assert.strictEqual(f([c('A', 1, 100), c('B', 2, 90)]), 'Lo último que compraste, a B, es el mejor precio que tenés: $90.');
  assert.strictEqual(f([c('A', 1, 90), c('B', 2, 120)]), 'Lo último se lo compraste a B a $120. A te lo vendió a $90 el d1: 25% menos.');
});

test('preciosArticulos: sin precio no cuenta', () => {
  assert.strictEqual(preciosArticulos([oc('A', 1, [['Cemento', 0, 'bolsa']])], ['cemento'], deps).length, 0);
});
