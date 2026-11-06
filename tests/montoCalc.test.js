// Monto con cuentas de Caja. Correr con: node --test "tests/*.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcMonto, esCuentaMonto } = require('../js/montoCalc.js');

test('números solos: el punto cuenta como coma', () => {
  assert.equal(calcMonto('1500'), 1500);
  assert.equal(calcMonto('1500,50'), 1500.5);
  assert.equal(calcMonto('1500.50'), 1500.5);
  assert.equal(calcMonto('12.5'), 12.5);
  assert.equal(calcMonto('1.234.567'), 1234567);
  assert.equal(calcMonto('1.234,56'), 1234.56);
  assert.equal(calcMonto('$ 2.000,00'), 2000);
});

test('cuentas', () => {
  assert.equal(calcMonto('=1500+230,50'), 1730.5);
  assert.equal(calcMonto('=1500+230.50'), 1730.5);
  assert.equal(calcMonto('100+50'), 150);
  assert.equal(calcMonto('= 3 * 1200'), 3600);
  assert.equal(calcMonto('3x1200'), 3600);
  assert.equal(calcMonto('3×1200'), 3600);
  assert.equal(calcMonto('10+5*2'), 20);
  assert.equal(calcMonto('(10+5)*2'), 30);
  assert.equal(calcMonto('1000/3'), 333.33);
  assert.equal(calcMonto('1000÷4'), 250);
  assert.equal(calcMonto('=5000-1200.5'), 3799.5);
  assert.equal(calcMonto('=-100+300'), 200);
  assert.equal(calcMonto('0.1+0.2'), 0.3);
});

test('incompletas o mal escritas dan NaN', () => {
  for (const s of ['', '=', '=100+', '(1+2', '1+2)', '10/0', 'abc', '=1500+a', '.', '1++']) {
    assert.ok(Number.isNaN(calcMonto(s)), s);
  }
});

test('esCuentaMonto', () => {
  assert.equal(esCuentaMonto('=100'), true);
  assert.equal(esCuentaMonto('100+50'), true);
  assert.equal(esCuentaMonto('3x200'), true);
  assert.equal(esCuentaMonto('1500,50'), false);
  assert.equal(esCuentaMonto('1.500'), false);
  assert.equal(esCuentaMonto(''), false);
});
