/* Presupuesto y plazo de un centro (obra), para Reportes.

     /obras/{k}/presupuesto = { moneda: 'ARS'|'USD', total, rubros?: { idRubro: monto } }
     /obras/{k}/plazo       = { inicio: 'AAAA-MM-DD', n, unidad: 'dias'|'meses' }

   Los dos son opcionales y van aparte: puede haber plazo sin presupuesto y al revés.
   Es presupuesto de COMPRAS (lo que pasa por OC), en pesos o en dólares y sin índice
   de actualización. Por rubro es opcional: lo que no se reparte queda como «Otros».
   La fecha de fin no se guarda: sale de inicio + plazo.

   Lo carga 0000 desde la ficha de la obra (obras.html) y, cuando esté, quien tenga
   Reportes desde la ficha de Reportes (database.rules.json deja escribir estos dos
   nodos a admin y reportes). El formulario es el mismo: presFormHtml + presOnInput /
   presOnClick sobre un objeto de edición (presEdicion). */

const PRES_MONEDAS = { ARS: 'Pesos', USD: 'Dólares' };
const PLAZO_UNIDADES = { dias: 'Días corridos', meses: 'Meses' };
const PLAZO_MAX = { dias: 7300, meses: 240 };   // 20 años

// "420.000.000", "$ 420000000", "1.500,50" → entero. Vacío o basura → 0.
function presNum(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.round(v) : 0;
  const s = String(v || '').replace(/[^\d,]/g, '').replace(/,.*$/, '');
  const n = Number(s);
  return isFinite(n) && n > 0 ? n : 0;
}
const presMiles = n => n ? Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
const presMonto = (n, moneda) => (moneda === 'USD' ? 'US$ ' : '$ ') + (presMiles(n) || '0');

const _fechaOk = s => typeof s === 'string' && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
function plazoFecha(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

// Fin del plazo. En meses, el mismo día del mes (o el último, si ese mes es más corto).
function plazoFin(inicio, n, unidad) {
  const d = plazoFecha(inicio);
  if (unidad === 'meses') {
    const m = d.getMonth() + n, ult = new Date(d.getFullYear(), m + 1, 0).getDate();
    return new Date(d.getFullYear(), m, Math.min(d.getDate(), ult));
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Cuánto del plazo pasó, en % (0 antes de empezar; más de 100 si ya venció).
function plazoAvance(plazo, hoy = new Date()) {
  const ini = plazoFecha(plazo.inicio).getTime(), fin = plazoFin(plazo.inicio, plazo.n, plazo.unidad).getTime();
  const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
  return Math.max(0, Math.round((h - ini) / (fin - ini) * 100));
}
const presDMA = d => [d.getDate(), d.getMonth() + 1].map(x => String(x).padStart(2, '0')).join('/') + '/' + d.getFullYear();

// De la obra guardada a lo que se edita. Lo roto se ignora.
function presEdicion(o) {
  const p = o && o.presupuesto, pl = o && o.plazo;
  const okP = p && PRES_MONEDAS[p.moneda] && presNum(p.total);
  const okPl = pl && _fechaOk(pl.inicio) && PLAZO_UNIDADES[pl.unidad] && presNum(pl.n);
  const rubros = {};
  if (okP && p.rubros) Object.entries(p.rubros).forEach(([id, v]) => { if (presNum(v)) rubros[id] = presNum(v); });
  return {
    moneda: okP ? p.moneda : 'ARS', total: okP ? presNum(p.total) : 0, rubros,
    inicio: okPl ? pl.inicio : '', n: okPl ? presNum(pl.n) : 0, unidad: okPl ? pl.unidad : 'meses'
  };
}
const presVacio = f => !f.total && !f.n && !f.inicio && !Object.values(f.rubros).some(Boolean);

// Lo que se guarda, o el error que lo impide. `ids`: los rubros que tiene la obra
// (el monto de un rubro que ya no está se descarta).
function presNodos(f, ids) {
  const rubros = {};
  ids.forEach(id => { if (f.rubros[id]) rubros[id] = f.rubros[id]; });
  const suma = Object.values(rubros).reduce((a, b) => a + b, 0);
  if (suma && !f.total) return { error: 'Falta el total: los rubros se comparan contra él.' };
  if (suma > f.total) return { error: 'Los rubros suman más que el total.' };
  if (f.n && !f.inicio) return { error: 'Falta la fecha de inicio del plazo.' };
  if (f.inicio && !f.n) return { error: 'Falta el plazo, en días corridos o en meses.' };
  if (f.inicio && !_fechaOk(f.inicio)) return { error: 'La fecha de inicio no es válida.' };
  if (f.n > PLAZO_MAX[f.unidad]) return { error: `El plazo puede ser de hasta ${PLAZO_MAX[f.unidad]} ${f.unidad === 'meses' ? 'meses' : 'días'}.` };
  return {
    presupuesto: f.total ? { moneda: f.moneda, total: f.total, ...(suma ? { rubros } : {}) } : null,
    plazo: f.n ? { inicio: f.inicio, n: f.n, unidad: f.unidad } : null
  };
}
// Para saber si algo cambió: lo que se guardaría (o lo escrito, si todavía no es válido).
const presClave = (f, ids) => JSON.stringify([f.total ? f.moneda : '', f.total,
  ids.filter(id => f.rubros[id]).map(id => [id, f.rubros[id]]), f.inicio, f.n, f.n ? f.unidad : '']);

// ---- Formulario ----
// `rubros`: [{ id, nombre }] de la obra. Todo lo que cambia mientras se escribe va
// en #pres-fin y #pres-suma (presCalcHtml), sin volver a pintar los campos.
function presFormHtml(f, rubros) {
  const e = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const seg = (campo, opciones) => `<div class="pres-seg" role="group">${Object.entries(opciones).map(([v, t]) =>
    `<button type="button" class="${f[campo] === v ? 'on' : ''}" data-pres-seg="${campo}" data-v="${v}" aria-pressed="${f[campo] === v}">${t}</button>`).join('')}</div>`;
  return `<div class="pres-two">
      <div class="pres-fld"><span class="lb">Moneda</span>${seg('moneda', PRES_MONEDAS)}</div>
      <div class="pres-fld"><label for="pres-total">Total de compras</label><input type="text" id="pres-total" class="form-control pres-num" data-pres="total" inputmode="numeric" autocomplete="off" value="${presMiles(f.total)}" placeholder="0"></div>
    </div>
    <div class="pres-hint">Sólo lo que se compra con OC. Si la mano de obra no se compra con OC, no la incluyas.</div>
    <div class="pres-two">
      <div class="pres-fld"><label for="pres-inicio">Inicio</label><input type="date" id="pres-inicio" class="form-control" data-pres="inicio" value="${e(f.inicio)}"></div>
      <div class="pres-fld"><label for="pres-n">Plazo</label><div class="pres-plazo"><input type="text" id="pres-n" class="form-control pres-num" data-pres="n" inputmode="numeric" autocomplete="off" value="${f.n || ''}" placeholder="0">${seg('unidad', PLAZO_UNIDADES)}</div></div>
    </div>
    <div class="pres-hint" id="pres-fin"></div>
    <div class="pres-rub">
      <div class="pres-rub-h"><b>Por rubro</b><small>opcional</small></div>
      ${rubros.length ? rubros.map(r => `<label class="pres-rub-r"><span>${e(r.nombre)}</span><input type="text" class="form-control pres-num" data-pres-rubro="${e(r.id)}" inputmode="numeric" autocomplete="off" value="${presMiles(f.rubros[r.id])}" placeholder="—" aria-label="Presupuesto de ${e(r.nombre)}"></label>`).join('')
        : `<div class="pres-hint">Con rubros cargados, el total se puede repartir entre ellos.</div>`}
      ${rubros.length ? '<div class="pres-hint" id="pres-suma"></div>' : ''}
    </div>`;
}

function presCalcHtml(f, rubros) {
  let fin = 'Cargá el inicio y el plazo para ver la fecha de fin.';
  if (f.n && _fechaOk(f.inicio)) {
    const pl = { inicio: f.inicio, n: Math.min(f.n, PLAZO_MAX[f.unidad]), unidad: f.unidad };
    const d = plazoFin(pl.inicio, pl.n, pl.unidad), av = plazoAvance(pl);
    fin = av >= 100 ? `Terminó el ${presDMA(d)}.`
      : `Termina el ${presDMA(d)}.` + (plazoFecha(f.inicio) <= new Date() ? ` Va el ${av}% del plazo.` : '');
  }
  const suma = rubros.reduce((a, r) => a + (f.rubros[r.id] || 0), 0);
  const sum = !suma ? 'Si no se reparte por rubro, se compara sólo el total.'
    : suma > f.total ? `<span class="pres-mal">Los rubros suman ${presMonto(suma, f.moneda)}, más que el total.</span>`
    : `Los rubros suman ${presMonto(suma, f.moneda)}. Otros: ${presMonto(f.total - suma, f.moneda)}.`;
  return { fin, sum };
}
function presPintarCalc(f, rubros, raiz = document) {
  const c = presCalcHtml(f, rubros);
  const fin = raiz.querySelector('#pres-fin'), sum = raiz.querySelector('#pres-suma');
  if (fin) fin.innerHTML = c.fin;
  if (sum) sum.innerHTML = c.sum;
}

// Eventos: devuelven true si el cambio era del formulario. Un toque en Moneda o en
// la unidad del plazo pide volver a pintar (lo hace quien llama).
function presOnInput(f, t) {
  if (t.dataset.pres === 'total') f.total = presNum(t.value);
  else if (t.dataset.pres === 'n') f.n = presNum(t.value);
  else if (t.dataset.pres === 'inicio') f.inicio = t.value || '';
  else if (t.dataset.presRubro != null) f.rubros[t.dataset.presRubro] = presNum(t.value);
  else return false;
  return true;
}
function presOnClick(f, b) {
  if (!b.dataset.presSeg) return false;
  f[b.dataset.presSeg] = b.dataset.v;
  return true;
}
// Al salir de un monto, con los puntos de miles.
function presOnBlur(t) {
  if (t.classList && t.classList.contains('pres-num') && t.dataset.pres !== 'n') t.value = presMiles(presNum(t.value));
}

if (typeof module !== 'undefined') {
  module.exports = { presNum, presMonto, plazoFin, plazoAvance, presEdicion, presVacio, presNodos, presClave, presCalcHtml };
}
