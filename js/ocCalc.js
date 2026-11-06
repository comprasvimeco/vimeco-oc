/* =====================================================
   Aritmética de la OC — sin DOM, la usan app.js y los
   tests (tests/ocCalc.test.js). Va antes de ocGenerator.js,
   fichaOC.js y driveBackup.js en toda página que los cargue.
   ===================================================== */

function roundCents(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Subtotal, gravado y total. Nombres cortos dentro de OCCalc: app.js tiene sus
// propios calcSubtotal()/calcGravado()/calcTotal() que leen el estado de la pantalla.
const OCCalc = {
  // Cada renglón se redondea a centavos antes de sumar: es lo que imprime el PDF,
  // y así el subtotal coincide con la suma de los renglones que se ven.
  totalItem(it) {
    return roundCents((parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0));
  },

  subtotal(items) {
    return roundCents((items || []).reduce((s, it) => s + OCCalc.totalItem(it), 0));
  },

  // Base de los impuestos: subtotal − descuento − no gravado (nunca negativa).
  gravado(subtotal, descMonto, ngMonto) {
    return roundCents(Math.max(0, subtotal - roundCents(descMonto) - roundCents(ngMonto)));
  },

  // El no gravado no paga impuestos pero se paga: vuelve a sumarse al total.
  total(gravado, ngMonto, impuestos) {
    const sumImp = (impuestos || []).reduce((s, imp) => s + roundCents(imp.monto), 0);
    return roundCents(gravado + roundCents(ngMonto) + sumImp);
  },

  // Un renglón con % se calcula sobre el gravado; sin %, queda el monto cargado.
  montoImpuesto(imp, gravado) {
    return (imp.pct != null && imp.pct > 0) ? roundCents(gravado * imp.pct / 100) : roundCents(imp.monto);
  },

  // Precios con IVA incluido → unitarios netos. Se reparte el neto total en centavos
  // entre los renglones (los que más perdieron al redondear se llevan el que sobra) y
  // cada unitario sale de su renglón: redondearlo a él y multiplicar por la cantidad
  // es lo que corría el total unos pesos.
  netosSinIVA(items, pct) {
    const factor = 1 + pct / 100;
    const conIVA = OCCalc.subtotal(items);
    // El neto cuyo neto + IVA más se acerca al total. Puede quedar a un centavo: al
    // redondear el IVA, hay totales a los que ningún neto llega.
    const base = Math.round(conIVA / factor * 100);
    const totalDe = c => roundCents(c / 100 + roundCents(c / 100 * pct / 100));
    const neto = [base, base - 1, base + 1]
      .reduce((a, c) => Math.abs(totalDe(c) - conIVA) < Math.abs(totalDe(a) - conIVA) ? c : a);

    const filas = (items || []).map(it => {
      const exacto = OCCalc.totalItem(it) / factor * 100;
      return { it, cents: Math.floor(exacto), resto: exacto - Math.floor(exacto) };
    });
    const conLinea = filas.filter(f => OCCalc.totalItem(f.it) !== 0);
    const faltan = neto - conLinea.reduce((s, f) => s + f.cents, 0);
    const orden = [...conLinea].sort((a, b) => faltan > 0 ? b.resto - a.resto : a.resto - b.resto);
    for (let i = 0; i < Math.abs(faltan) && orden.length; i++) orden[i % orden.length].cents += Math.sign(faltan);

    return filas.map(f => OCCalc.totalItem(f.it) !== 0
      ? f.cents / 100 / parseFloat(f.it.cantidad)
      : (parseFloat(f.it.precio_unitario) || 0) / factor);
  }
};

// Números como los escribe la gente en Argentina. Con punto y coma, el último
// que aparece es el decimal ("1.234,56", "1,234.56"). Con uno solo de los dos:
// repetido son miles ("1.234.567"), una sola coma es decimal ("1,255"), un solo
// punto también ("1.5": así los muestran los campos de la tabla).
function parseArgFloat(val) {
  if (typeof val === 'number') return val;
  let s = String(val || '').trim().replace(/\s/g, '');
  const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (commas) {
    s = commas > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (dots > 1) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* =====================================================
   NÚMERO EN LETRAS — español argentino
   Va después de "Son PESOS:", así que el número queda
   solo: "veintiuno", no "veintiún". Antes de "mil",
   "millones" o "centavos" sí se apocopa ("veintiún mil").
   ===================================================== */
function numberToWords(monto) {
  const cents    = Math.round(Math.abs(Number(monto) || 0) * 100);
  const entero   = Math.floor(cents / 100);
  const centavos = cents % 100;

  const UNI = [
    '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
    'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
    'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
    'veintiocho', 'veintinueve'
  ];
  const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta',
               'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos',
               'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  // 1–999
  function grupo(n) {
    if (n < 30)    return UNI[n];
    if (n < 100)   { const d = Math.floor(n / 10), u = n % 10; return DEC[d] + (u ? ' y ' + UNI[u] : ''); }
    if (n === 100) return 'cien';
    const r = n % 100;
    return CEN[Math.floor(n / 100)] + (r ? ' ' + grupo(r) : '');
  }

  // "uno" → "un" al final, cuando sigue un sustantivo: "veintiún mil", "un millón".
  function apocope(s) {
    return s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');
  }

  // 1–999.999
  function hastaMillon(n) {
    const K = Math.floor(n / 1000), R = n % 1000;
    const partes = [];
    if (K) partes.push(K === 1 ? 'mil' : apocope(grupo(K)) + ' mil');
    if (R) partes.push(grupo(R));
    return partes.join(' ');
  }

  function letras(n) {
    if (!n) return 'cero';
    const M = Math.floor(n / 1000000), R = n % 1000000;
    const partes = [];
    if (M) partes.push(M === 1 ? 'un millón' : apocope(hastaMillon(M)) + ' millones');
    if (R) partes.push(hastaMillon(R));
    return partes.join(' ');
  }

  let res = letras(entero);
  if (centavos > 0) res += ` con ${apocope(letras(centavos))} centavo${centavos === 1 ? '' : 's'}`;
  return res;
}

if (typeof module !== 'undefined') {
  module.exports = { roundCents, parseArgFloat, numberToWords, OCCalc };
}
