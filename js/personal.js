/* VIMECO S.A. — Personal: selección de obra (Jefe de Obra / Admin) */

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Misma categoría de obra (e íconos) que Reportes y Obras.
const OBRA_CATS = {
  arquitectura: { label: 'Arquitectura', icon: 'building' },
  vial:         { label: 'Vial',         icon: 'road' },
  oficina:      { label: 'Oficina',      icon: 'briefcase' },
};

const pad2 = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Días laborables (lun-vie no feriados) de la quincena de hoy, hasta hoy inclusive.
function laborablesHastaHoy(feriados) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth() + 1;
  const desde = hoy.getDate() <= 15 ? 1 : 16;
  const out = [];
  for (let d = desde; d <= hoy.getDate(); d++) {
    const iso = `${y}-${pad2(m)}-${pad2(d)}`;
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6 && !feriados[iso]) out.push(iso);
  }
  return out;
}

// Personal activo por obra: { obraKey: n } y total de personas distintas.
async function contarPorObra() {
  try {
    const personal = await getPersonal();
    const out = {};
    personal.forEach(p => {
      if (p.activo === false) return;
      Object.keys(p.obras || {}).forEach(k => { if (p.obras[k]) out[k] = (out[k] || 0) + 1; });
    });
    return { porObra: out, personal: personal.filter(p => p.activo !== false) };
  } catch (_) {
    return null;   // sin conteo: las tarjetas se muestran igual
  }
}

// Días de la quincena actual (hasta hoy) sin validar, por obra. null si no se pudo leer.
async function pendientesDe(obras, feriados) {
  const dias = laborablesHastaHoy(feriados);
  const hoyIso = isoLocal(new Date());
  const res = await Promise.all(obras.map(async o => {
    try {
      const meta = await getPartesMeta(o.key);
      const falta = dias.filter(iso => !(meta[iso] && meta[iso].validado));
      return [o.key, { n: falta.length, soloHoy: falta.length === 1 && falta[0] === hoyIso && !meta[hoyIso] }];
    } catch (_) { return [o.key, null]; }
  }));
  return Object.fromEntries(res);
}

function abrirObra(o) {
  window.location.href = `personal-obra.html?obra=${encodeURIComponent(o.key)}&nombre=${encodeURIComponent(o.nombre)}`;
}

function iconoObra(o) {
  const c = OBRA_CATS[o.categoria];
  return `<span class="pe-sq pe-sq--${c ? o.categoria : 'none'}">${icSvg(c ? c.icon : 'building')}</span>`;
}

function render(obras, conteo, pend) {
  const porObra = conteo ? conteo.porObra : null;
  const conGente = porObra ? obras.filter(o => porObra[o.key]) : obras;
  const sinGente = porObra ? obras.filter(o => !porObra[o.key]) : [];

  // Cabecera: personas en estas obras y días sin validar en total
  if (conteo) {
    const keys = new Set(obras.map(o => o.key));
    const n = conteo.personal.filter(p => Object.keys(p.obras || {}).some(k => p.obras[k] && keys.has(k))).length;
    $('pe-personas').innerHTML = `${icSvg('users')} ${n} ${n === 1 ? 'persona' : 'personas'}`;
    $('pe-personas').classList.remove('hidden');
  }
  const totPend = Object.values(pend || {}).reduce((s, p) => s + (p ? p.n : 0), 0);
  if (totPend) {
    $('pe-pend').textContent = `${totPend} ${totPend === 1 ? 'día' : 'días'} sin validar`;
    $('pe-pend').classList.remove('hidden');
  }

  const cont = $('obras-list');
  if (!obras.length) {
    cont.innerHTML = '<div class="pe-vacio">No tenés obras asignadas. Pedile a quien administra que te asigne una.</div>';
    return;
  }

  cont.innerHTML = conGente.map(o => {
    const n = porObra ? porObra[o.key] : null;
    const p = pend ? pend[o.key] : null;
    const cat = OBRA_CATS[o.categoria];
    const estado = !p ? ''
      : p.n === 0 ? `<span class="pe-ok">${icSvg('checkSm')}Al día</span>`
      : `<span class="pe-pendp">${p.soloHoy ? 'Hoy sin parte' : `${p.n} ${p.n === 1 ? 'día' : 'días'} sin validar`}</span>`;
    return `
      <button type="button" class="pe-card" data-key="${esc(o.key)}">
        <span class="pe-top">
          ${iconoObra(o)}
          <span class="pe-tx"><span class="pe-n">${esc(o.nombre)}</span>${o.lugar_entrega ? `<span class="pe-s">${esc(o.lugar_entrega)}</span>` : ''}</span>
          <span class="pe-chev">${icSvg('chevR')}</span>
        </span>
        <span class="pe-bot">
          ${cat ? `<span class="cat-tag cat-tag--${o.categoria}">${icSvg(cat.icon)}${cat.label}</span>` : ''}
          ${n != null ? `<span class="pe-mini">${n} en obra</span>` : ''}
          ${estado}
        </span>
      </button>`;
  }).join('') || '<div class="pe-vacio">Todavía no hay personal en ninguna obra. Elegí una de abajo para armar su cuadrilla.</div>';

  $('pe-sin').classList.toggle('hidden', !sinGente.length);
  $('pe-sin-n').textContent = sinGente.length;
  $('pe-sin-list').innerHTML = sinGente.map(o => {
    const c = OBRA_CATS[o.categoria];
    return `<button type="button" class="pe-chip" data-key="${esc(o.key)}">${c ? icSvg(c.icon) : ''}${esc(o.nombre)}</button>`;
  }).join('');

  const porKey = Object.fromEntries(obras.map(o => [o.key, o]));
  document.querySelectorAll('.pe-card, .pe-chip').forEach(el =>
    el.addEventListener('click', () => abrirObra(porKey[el.dataset.key])));
}

document.addEventListener('DOMContentLoaded', async () => {
  const _s = (() => { try { return JSON.parse(localStorage.getItem('vimeco_session')); } catch (_) { return null; } })();
  if (!_s?.codigo) { window.location.href = 'index.html'; return; }

  $('hdr-name').textContent = _s.nombre;
  $('btn-back').addEventListener('click', () => { window.location.href = 'menu.html'; });
  // Determinar rol: admin (0000 o flag admin) ve todas las obras; jefe ve las suyas.
  let esAdmin = _s.codigo === '0000';
  let esJefe  = false;
  if (!esAdmin) {
    try {
      const u = await getUsuario(_s.codigo);
      esAdmin = !!(u && u.admin);
      esJefe  = tienePersonal(u);
    } catch (_) {}
    if (!esAdmin && !esJefe) { window.location.href = 'menu.html'; return; }
  }

  try {
    const [obras, conteo, feriados] = await Promise.all([
      esAdmin ? getObrasActivas() : getObrasDeJefe(_s.codigo),
      contarPorObra(),
      getFeriados().catch(() => ({}))
    ]);
    // Un jefe con una sola obra entra directo (volver lo trae al menú).
    if (!esAdmin && obras.length === 1) {
      const o = obras[0];
      window.location.replace(`personal-obra.html?obra=${encodeURIComponent(o.key)}&nombre=${encodeURIComponent(o.nombre)}&unica=1`);
      return;
    }
    const conGente = conteo ? obras.filter(o => conteo.porObra[o.key]) : obras;
    render(obras, conteo, null);
    render(obras, conteo, await pendientesDe(conGente, feriados || {}));
  } catch (_) {
    $('obras-list').innerHTML = '<div class="pe-vacio">Error al cargar las obras.</div>';
  }
});
