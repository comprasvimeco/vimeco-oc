/* =====================================================
   Monto con cuentas — "=1500+230,50", "3*1200", "(10+5)/2".
   Sin DOM ni eval: la usan caja.js y tests/montoCalc.test.js.
   Cada número se lee con parseArgFloat (ocCalc.js, va antes):
   un punto solo es decimal, igual que la coma ("12.5" = 12,5);
   varios puntos son miles ("1.234.567").
   Operadores: + - * / (también x × ÷ y : ) y paréntesis.
   ===================================================== */

const _pfMonto = typeof parseArgFloat === 'function'
  ? parseArgFloat
  : require('./ocCalc.js').parseArgFloat;

// Devuelve el número, o NaN si la cuenta está incompleta o mal escrita.
function calcMonto(str) {
  let s = String(str == null ? '' : str).trim().replace(/^=+/, '').replace(/\s+/g, '').replace(/\$/g, '');
  if (!s) return NaN;
  s = s.replace(/[x×X]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-');

  // Tokens: números (dígitos con . y ,) y símbolos.
  const toks = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const txt = s.slice(i, j);
      if (!/[0-9]/.test(txt)) return NaN;
      toks.push(_pfMonto(txt));
      i = j;
    } else if ('+-*/()'.includes(c)) {
      toks.push(c); i++;
    } else {
      return NaN;
    }
  }

  // Descenso recursivo: expr = term (± term)*, term = factor (*/ factor)*, factor = ±factor | n | (expr)
  let p = 0;
  const expr = () => {
    let v = term();
    while (toks[p] === '+' || toks[p] === '-') { const op = toks[p++]; const w = term(); v = op === '+' ? v + w : v - w; }
    return v;
  };
  const term = () => {
    let v = factor();
    while (toks[p] === '*' || toks[p] === '/') { const op = toks[p++]; const w = factor(); v = op === '*' ? v * w : v / w; }
    return v;
  };
  const factor = () => {
    const t = toks[p++];
    if (typeof t === 'number') return t;
    if (t === '-') return -factor();
    if (t === '+') return factor();
    if (t === '(') { const v = expr(); if (toks[p++] !== ')') return NaN; return v; }
    return NaN;
  };
  const v = expr();
  if (p !== toks.length || !isFinite(v)) return NaN;
  return Math.round(v * 100) / 100;
}

// ¿Lo escrito es una cuenta (y no un número solo)?
function esCuentaMonto(str) {
  const s = String(str || '').trim();
  return /^=/.test(s) || /[0-9.,)]\s*[-+*/x×÷:]\s*[-+(0-9.,]/i.test(s);
}

if (typeof module !== 'undefined') {
  module.exports = { calcMonto, esCuentaMonto };
}
