// Aritmética de la OC: lo que termina impreso en un documento que se le manda a un proveedor.
// Correr con: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { roundCents, parseArgFloat, numberToWords, OCCalc } = require('../js/ocCalc.js');

// Arma la OC como lo hace app.js: subtotal → descuento/no gravado → gravado → impuestos → total.
function oc({ items, desc = 0, ng = 0, impuestos = [] }) {
  const subtotal = OCCalc.subtotal(items);
  const gravado  = OCCalc.gravado(subtotal, desc, ng);
  const imps     = impuestos.map(imp => ({ ...imp, monto: OCCalc.montoImpuesto(imp, gravado) }));
  return { subtotal, gravado, impuestos: imps, total: OCCalc.total(gravado, ng, imps) };
}

const it = (cantidad, precio_unitario) => ({ cantidad, precio_unitario });

test('roundCents', () => {
  assert.equal(roundCents(1.005), 1);          // 1.005 es 1.00499… en binario
  assert.equal(roundCents(0.1 + 0.2), 0.3);
  assert.equal(roundCents(2.675), 2.68);
  assert.equal(roundCents(undefined), 0);
  assert.equal(roundCents('12.345'), 12.35);
});

test('renglón: cantidad × unitario redondeado a centavos', () => {
  assert.equal(OCCalc.totalItem(it(3, 0.1)), 0.3);
  assert.equal(OCCalc.totalItem(it(1.255, 1234.56)), 1549.37);
  assert.equal(OCCalc.totalItem(it('2', '10.5')), 21);
  assert.equal(OCCalc.totalItem(it('', null)), 0);
});

test('el subtotal es la suma de los renglones que imprime el PDF', () => {
  // Sin redondear por renglón daría 0.015 × 3 = 0.045 → 0,05; los renglones impresos suman 0,06.
  const items = [it(1, 0.015), it(1, 0.015), it(1, 0.015)];
  const impresos = items.map(OCCalc.totalItem).reduce((a, b) => a + b, 0);
  assert.equal(OCCalc.subtotal(items), roundCents(impresos));
  assert.equal(OCCalc.subtotal(items), 0.06);
  assert.equal(OCCalc.subtotal([]), 0);
  assert.equal(OCCalc.subtotal(undefined), 0);
});

test('OC simple con IVA 21%', () => {
  const r = oc({ items: [it(10, 1500), it(2.5, 830.4)], impuestos: [{ nombre: 'IVA', pct: 21 }] });
  assert.equal(r.subtotal, 17076);
  assert.equal(r.gravado, 17076);
  assert.equal(r.impuestos[0].monto, 3585.96);
  assert.equal(r.total, 20661.96);
});

test('descuento y percepción con monto fijo', () => {
  const r = oc({
    items: [it(1, 100000)],
    desc: 10000,
    impuestos: [{ nombre: 'IVA', pct: 21 }, { nombre: 'Perc. IIBB', pct: null, monto: 1234.5 }]
  });
  assert.equal(r.gravado, 90000);
  assert.equal(r.impuestos[0].monto, 18900);
  assert.equal(r.impuestos[1].monto, 1234.5);
  assert.equal(r.total, 110134.5);
});

test('el no gravado no paga IVA pero suma al total', () => {
  const r = oc({ items: [it(1, 1000)], ng: 200, impuestos: [{ nombre: 'IVA', pct: 21 }] });
  assert.equal(r.gravado, 800);
  assert.equal(r.impuestos[0].monto, 168);
  assert.equal(r.total, 1168);   // 800 + 200 + 168
});

test('descuento mayor al subtotal: gravado en cero, nunca negativo', () => {
  const r = oc({ items: [it(1, 500)], desc: 800, impuestos: [{ nombre: 'IVA', pct: 21 }] });
  assert.equal(r.gravado, 0);
  assert.equal(r.impuestos[0].monto, 0);
  assert.equal(r.total, 0);
});

test('impuesto con % se recalcula sobre el gravado; sin %, queda el monto cargado', () => {
  assert.equal(OCCalc.montoImpuesto({ pct: 10.5, monto: 999 }, 1000), 105);
  assert.equal(OCCalc.montoImpuesto({ pct: null, monto: 12.345 }, 1000), 12.35);
  assert.equal(OCCalc.montoImpuesto({ pct: 0, monto: 50 }, 1000), 50);
  assert.equal(OCCalc.montoImpuesto({}, 1000), 0);
});

test('montos grandes no pierden centavos', () => {
  const r = oc({ items: [it(1234.5, 98765.43), it(3, 0.01)], impuestos: [{ nombre: 'IVA', pct: 21 }] });
  assert.equal(r.subtotal, 121925923.37);
  assert.equal(r.impuestos[0].monto, 25604443.91);
  assert.equal(r.total, 147530367.28);
});

test('parseArgFloat: formatos argentinos', () => {
  assert.equal(parseArgFloat('1.234,56'), 1234.56);
  assert.equal(parseArgFloat('1.234.567,8'), 1234567.8);
  assert.equal(parseArgFloat('1.234.567'), 1234567);
  assert.equal(parseArgFloat('1234,5'), 1234.5);
  assert.equal(parseArgFloat('1,255'), 1.255);      // cantidad con tres decimales
  assert.equal(parseArgFloat('0,001'), 0.001);
  assert.equal(parseArgFloat('1.5'), 1.5);          // así muestran los campos de la tabla
  assert.equal(parseArgFloat('1,234.56'), 1234.56);
  assert.equal(parseArgFloat(' 2 500,00 '), 2500);
  assert.equal(parseArgFloat(42.1), 42.1);
  assert.equal(parseArgFloat(''), 0);
  assert.equal(parseArgFloat('abc'), 0);
  assert.equal(parseArgFloat(null), 0);
});

test('numberToWords: unidades, decenas y centenas', () => {
  const casos = {
    0: 'cero', 1: 'uno', 15: 'quince', 16: 'dieciséis', 20: 'veinte', 21: 'veintiuno',
    22: 'veintidós', 23: 'veintitrés', 26: 'veintiséis', 29: 'veintinueve', 30: 'treinta',
    31: 'treinta y uno', 45: 'cuarenta y cinco', 99: 'noventa y nueve', 100: 'cien',
    101: 'ciento uno', 115: 'ciento quince', 121: 'ciento veintiuno', 200: 'doscientos',
    555: 'quinientos cincuenta y cinco', 999: 'novecientos noventa y nueve'
  };
  for (const [n, txt] of Object.entries(casos)) assert.equal(numberToWords(Number(n)), txt, `n=${n}`);
});

test('numberToWords: miles y millones', () => {
  const casos = {
    1000: 'mil', 1001: 'mil uno', 1100: 'mil cien', 2000: 'dos mil',
    21000: 'veintiún mil', 31000: 'treinta y un mil', 100000: 'cien mil',
    101000: 'ciento un mil', 121000: 'ciento veintiún mil', 999999: 'novecientos noventa y nueve mil novecientos noventa y nueve',
    1000000: 'un millón', 1000001: 'un millón uno', 2500000: 'dos millones quinientos mil',
    21000000: 'veintiún millones', 101000000: 'ciento un millones',
    1000000000: 'mil millones', 1500000000: 'mil quinientos millones',
    21000000000: 'veintiún mil millones',
    1234567: 'un millón doscientos treinta y cuatro mil quinientos sesenta y siete'
  };
  for (const [n, txt] of Object.entries(casos)) assert.equal(numberToWords(Number(n)), txt, `n=${n}`);
});

test('numberToWords: centavos', () => {
  assert.equal(numberToWords(0.01), 'cero con un centavo');
  assert.equal(numberToWords(1.5), 'uno con cincuenta centavos');
  assert.equal(numberToWords(21.21), 'veintiuno con veintiún centavos');
  assert.equal(numberToWords(1234.57), 'mil doscientos treinta y cuatro con cincuenta y siete centavos');
  assert.equal(numberToWords(20661.96), 'veinte mil seiscientos sesenta y uno con noventa y seis centavos');
  // Centavos que en binario quedan un pelo abajo: no se pierden ni llegan a "cien centavos".
  assert.equal(numberToWords(0.29), 'cero con veintinueve centavos');
  assert.equal(numberToWords(1.999), 'dos');
  assert.equal(numberToWords(147530367.28),
    'ciento cuarenta y siete millones quinientos treinta mil trescientos sesenta y siete con veintiocho centavos');
});

test('numberToWords: entradas raras', () => {
  assert.equal(numberToWords(undefined), 'cero');
  assert.equal(numberToWords('1500'), 'mil quinientos');
  assert.equal(numberToWords(-250), 'doscientos cincuenta');
});
