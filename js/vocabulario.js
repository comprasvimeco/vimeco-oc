/* Vocabulario de cada empresa: las palabras con que la app nombra lo que por
   dentro siempre se llama igual.

     Por dentro         Lo que se ve (por empresa)
     /obras, obraKey    centro       obra / local / planta / sucursal / proyecto…
     /equipos           activo       equipo / vehículo / máquina…
     jefeObra           responsable  jefe de obra / encargado de local…

   Los nodos y las claves NO cambian (ver PLAN-SAAS.md, «Leva para cualquier
   rubro»): sólo el texto. Vive en /vocabulario (aparte de /empresa, que se
   guarda con un PUT entero desde los datos fiscales) y se edita en
   Administración → Empresa → «Rubro de la empresa».

   Como EMPRESA, window.VOC queda listo SINCRÓNICAMENTE al cargar el script
   (caché de localStorage, o el preset de construcción), y loadVocabulario() lo
   actualiza en segundo plano: el PDF de la OC sale offline.

   USO — se escribe la frase en genérico y en masculino; voc() pone las
   palabras de la empresa y concuerda lo que tiene alrededor:

     voc('centro')                 'obra'
     voc('centro.p')               'obras'
     voc('Centro.p')               'Obras'        (la mayúscula de la clave se respeta)
     voc('Nuevo centro')           'Nueva obra'   | comercio: 'Nuevo local'
     voc('del centro')             'de la obra'   | 'del local'
     voc('los centros asignados')  'las obras asignadas'
     voc('el activo del centro')   'la máquina de la planta' (cada artículo va con el sustantivo que le sigue)
     voc('OBRA / MOTIVO')          no: escribí voc('CENTRO') + ' / MOTIVO' (todo en mayúsculas sale en mayúsculas)

   Lo que concuerda está en dos listas cerradas (DET, antes del sustantivo;
   ADJ, después). Una palabra que no está no se toca: mejor una frase sin
   flexionar que una concordancia inventada. «activo» es siempre el sustantivo:
   para el adjetivo, otra palabra («habilitado»).

   «responsable» ya trae el centro adentro («jefe de obra»): no escribas
   «responsable del centro». Y dentro de voc() siempre es esa palabra: para
   quien emite la OC, otra («persona», «quien la pidió»).

   En HTML: <span data-voc="Nuevo centro"></span> y aplicarVoc() (corre solo
   al cargar la página y cuando llega el vocabulario de la base). Para un
   atributo: data-voc-placeholder="Elegí el centro", data-voc-aria-label="Ver
   centros", data-voc-title="…". Un adjetivo suelto, sin el sustantivo al lado:
   data-voc-gen="activo:Activos|Activas" (o vocGen('activo', 'Activos', 'Activas') en JS).

   El ícono del centro también depende del rubro (VOC_ICONO): icSvg('centro') en JS,
   <svg data-voc-icono="centro"> en HTML. */

const VOC_PRESETS = {
  construccion: {
    nombre: 'Construcción',
    centro:      { s: 'obra',     p: 'obras',     g: 'f' },
    activo:      { s: 'equipo',   p: 'equipos',   g: 'm' },
    responsable: { s: 'jefe de obra', p: 'jefes de obra', g: 'm' }
  },
  comercio: {
    nombre: 'Comercio',
    centro:      { s: 'local',    p: 'locales',   g: 'm' },
    activo:      { s: 'vehículo', p: 'vehículos', g: 'm' },
    responsable: { s: 'encargado de local', p: 'encargados de local', g: 'm' }
  },
  industria: {
    nombre: 'Industria',
    centro:      { s: 'planta',   p: 'plantas',   g: 'f' },
    activo:      { s: 'máquina',  p: 'máquinas',  g: 'f' },
    responsable: { s: 'jefe de planta', p: 'jefes de planta', g: 'm' }
  },
  transporte: {
    nombre: 'Transporte',
    centro:      { s: 'sucursal', p: 'sucursales', g: 'f' },
    activo:      { s: 'vehículo', p: 'vehículos', g: 'm' },
    responsable: { s: 'responsable de sucursal', p: 'responsables de sucursal', g: 'm' }
  },
  servicios: {
    nombre: 'Servicios',
    centro:      { s: 'proyecto', p: 'proyectos', g: 'm' },
    activo:      { s: 'equipo',   p: 'equipos',   g: 'm' },
    responsable: { s: 'responsable de proyecto', p: 'responsables de proyecto', g: 'm' }
  }
};
const VOC_DEFAULT = 'construccion';
const VOC_PALABRAS = ['centro', 'activo', 'responsable'];

const VOC_SVG = {
  edificio: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  local: '<path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/>',
  fabrica: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1M12 18h1M7 18h1"/>',
  deposito: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12M6 14h12"/><path d="M6 22V10h12v12"/>',
  carpeta: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  lugar: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  camion: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  engranaje: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
  llave: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
};
// Qué ícono lleva cada palabra según el rubro (por defecto, el de «Otro»).
const VOC_ICONO = {
  centro: { construccion: 'edificio', comercio: 'local', industria: 'fabrica', transporte: 'deposito', servicios: 'carpeta', otro: 'lugar' },
  responsable: { otro: 'persona' },
  activo: { comercio: 'camion', industria: 'engranaje', transporte: 'camion', otro: 'llave' }
};
const vocIcono = (k, rubro) =>
  '<svg viewBox="0 0 24 24" aria-hidden="true">' + VOC_SVG[VOC_ICONO[k][rubro] || VOC_ICONO[k].otro] + '</svg>';

// Sólo el trazo, para meterlo en un <svg> que ya existe.
const vocTrazo = (k, rubro) => VOC_SVG[VOC_ICONO[k][rubro] || VOC_ICONO[k].otro];

// Arma la configuración completa a partir de lo guardado: cada palabra que
// falte o venga mal cae a la del preset de su rubro (o al de construcción).
function vocArmar(guardado) {
  const g = guardado && typeof guardado === 'object' ? guardado : {};
  const rubro = typeof g.rubro === 'string' && g.rubro ? g.rubro : VOC_DEFAULT;
  const base = VOC_PRESETS[rubro] || VOC_PRESETS[VOC_DEFAULT];
  const out = { rubro };
  VOC_PALABRAS.forEach(k => {
    const w = g[k];
    const ok = w && typeof w.s === 'string' && w.s.trim() && typeof w.p === 'string' && w.p.trim() && (w.g === 'm' || w.g === 'f');
    out[k] = ok ? { s: w.s.trim(), p: w.p.trim(), g: w.g } : { ...base[k] };
  });
  out.modulos = { activos: !(g.modulos && g.modulos.activos === false) };
  return out;
}

// Masculino → femenino de lo que va antes del sustantivo.
const VOC_DET = {
  el: 'la', los: 'las', un: 'una', unos: 'unas', del: 'de la', al: 'a la',
  este: 'esta', estos: 'estas', ese: 'esa', esos: 'esas', aquel: 'aquella', aquellos: 'aquellas',
  nuevo: 'nueva', nuevos: 'nuevas', otro: 'otra', otros: 'otras', todo: 'toda', todos: 'todas',
  ningún: 'ninguna', ninguno: 'ninguna', algún: 'alguna', alguno: 'alguna', algunos: 'algunas',
  mismo: 'misma', mismos: 'mismas', primer: 'primera', primero: 'primera', último: 'última', últimos: 'últimas',
  cada: 'cada', su: 'su', sus: 'sus', mi: 'mi', mis: 'mis', tu: 'tu', tus: 'tus', de: 'de', a: 'a',
  varios: 'varias', muchos: 'muchas', pocos: 'pocas', cuántos: 'cuántas', cuál: 'cuál', qué: 'qué'
};
// Adjetivos en -o/-os que pueden ir después: se cambia la terminación.
const VOC_ADJ = new Set([
  'asignado', 'seleccionado', 'elegido', 'cargado', 'cerrado', 'terminado', 'finalizado', 'propio',
  'nuevo', 'registrado', 'habilitado', 'deshabilitado', 'archivado', 'inactivo', 'vinculado', 'suyo',
  'mismo', 'otro', 'abierto', 'guardado', 'borrado', 'eliminado', 'creado', 'editado', 'usado',
  'renombrado', 'activado', 'desactivado', 'actualizado', 'dado', 'repetido'
]);

function _vocCaso(orig, txt) {
  if (orig.length > 1 && orig === orig.toUpperCase() && orig !== orig.toLowerCase()) return txt.toUpperCase();
  if (orig[0] !== orig[0].toLowerCase()) return txt[0].toUpperCase() + txt.slice(1);
  return txt;
}

function _vocAdjFem(w) {
  const m = /^(.*)o(s?)$/.exec(w);
  return m && VOC_ADJ.has(m[1] + 'o') ? m[1] + 'a' + m[2] : null;
}

// Arma la frase con la configuración cfg (la de vocArmar).
function vocFrase(frase, cfg) {
  const c = cfg || vocArmar(null);
  const s = String(frase == null ? '' : frase);

  // Atajo con punto: 'centro.p', 'Activo.s'.
  const atajo = /^(centro|activo|responsable)\.(s|p)$/i.exec(s);
  if (atajo) return _vocCaso(atajo[1], c[atajo[1].toLowerCase()][atajo[2].toLowerCase()]);

  // Palabras y lo que hay entre ellas, por separado: [sep, palabra, sep, palabra, …, sep].
  const partes = s.split(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/);
  const esPalabra = i => i % 2 === 1;
  // Una sola separación de espacios entre dos palabras = siguen en la misma frase nominal.
  const pegado = i => /^ +$/.test(partes[i]);

  const sust = [];
  for (let i = 1; i < partes.length; i += 2) {
    const m = /^(centro|activo|responsable)(s?)$/i.exec(partes[i]);
    if (m) sust.push({ i, k: m[1].toLowerCase(), pl: !!m[2] });
  }
  if (!sust.length) return s;
  const esSust = new Set(sust.map(x => x.i));

  const out = partes.slice();
  sust.forEach(({ i, k, pl }) => {
    const w = c[k];
    out[i] = _vocCaso(partes[i], pl ? w.p : w.s);
    if (w.g !== 'f') return;
    // Hacia atrás: determinantes de la lista, de corrido.
    for (let j = i - 2; j >= 1 && pegado(j + 1) && !esSust.has(j); j -= 2) {
      const f = VOC_DET[partes[j].toLowerCase()];
      if (f === undefined) break;
      out[j] = _vocCaso(partes[j], f);
    }
    // Hacia adelante: adjetivos de la lista, de corrido.
    for (let j = i + 2; j < partes.length && pegado(j - 1) && !esSust.has(j); j += 2) {
      const f = _vocAdjFem(partes[j].toLowerCase());
      if (!f) break;
      out[j] = _vocCaso(partes[j], f);
    }
  });
  return out.join('');
}

// ---- Plural y género de una palabra nueva (rubro «Otro») ----
// Se escribe sólo el singular; el plural y el género salen de acá. Manda la
// primera palabra («jefe de sede» → «jefes de sede», masculino). Lo que no se
// puede saber por la terminación ni está en la lista queda en duda: la pantalla
// pregunta «¿el X o la X?» en vez de adivinar.

// Palabras que la terminación no resuelve (o resuelve mal).
const VOC_GENERO = {
  f: ['sede', 'base', 'nave', 'calle', 'torre', 'fuente', 'llave', 'parte', 'clase', 'flota', 'sucursal', 'central',
    'terminal', 'cárcel', 'red', 'pared', 'luz', 'cruz', 'mano', 'foto', 'moto', 'radio', 'flor', 'labor', 'imagen',
    'gente', 'carne', 'noche', 'tarde', 'suerte', 'muerte', 'leche', 'nube', 'llanta', 'grúa', 'estación', 'oficina'],
  m: ['día', 'mapa', 'sistema', 'problema', 'tema', 'programa', 'clima', 'esquema', 'planeta', 'idioma', 'tranvía',
    'jefe', 'responsable', 'gerente', 'supervisor', 'encargado', 'coordinador', 'director', 'frente', 'parque',
    'puente', 'tanque', 'coche', 'auto', 'camión', 'tráiler', 'remolque', 'tractor', 'motor', 'generador', 'buque',
    'barco', 'avión', 'equipo', 'vehículo', 'local', 'hotel', 'hospital', 'taller', 'almacén', 'depósito', 'galpón',
    'club', 'bar', 'restaurante', 'comedor', 'colegio', 'consultorio', 'cliente', 'servicio', 'edificio', 'lote',
    'campo', 'establecimiento', 'yacimiento', 'pozo', 'puerto', 'dispositivo', 'instrumento', 'aparato', 'inmueble']
};
const _sinTilde = w => w.normalize('NFD').replace(/[̀-ͯ]/g, '');

function vocGenero(w) {
  const x = w.toLowerCase();
  if (VOC_GENERO.f.includes(x)) return { g: 'f', duda: false };
  if (VOC_GENERO.m.includes(x)) return { g: 'm', duda: false };
  if (/(ión|ion|dad|tad|tud|umbre|sis|itis)$/.test(x)) return { g: 'f', duda: false };
  if (/(aje|or|ón|o|os)$/.test(x)) return { g: 'm', duda: false };
  if (/(as?|ía)$/.test(x)) return { g: 'f', duda: false };
  if (/(e|es|l|n|r|z|d|s|i|í|u|ú|é)$/.test(x)) return { g: 'm', duda: true };
  return { g: 'm', duda: true };
}

function vocPluralPalabra(w) {
  if (/^[A-ZÁÉÍÓÚÑ0-9]{2,}$/.test(w)) return w;                       // una sigla
  if (/[aeiouáéó]$/i.test(w)) return w + 's';
  if (/[íú]$/i.test(w)) return w + 's';
  if (/z$/i.test(w)) return w.slice(0, -1) + 'ces';
  if (/[áéíóú][ns]$/i.test(w)) return w.slice(0, -2) + _sinTilde(w.slice(-2, -1)) + w.slice(-1) + 'es';
  if (/[sx]$/i.test(w)) return /[aeiou].*[aeiou]/i.test(_sinTilde(w)) ? w : w + 'es';   // «lunes» queda, «mes» → «meses»
  if (/y$/i.test(w)) return w + 'es';
  if (/[aeiou][nl]$/i.test(w) && /^[^áéíóú]*$/.test(w) && /[aeiou].*[aeiou]/i.test(w)) {
    // Grave terminada en -n sin tilde («examen», «imagen») gana la tilde al ser esdrújula.
    if (/n$/i.test(w)) {
      const m = /^(.*?)([aeiou])([^aeiou]*[aeiou][^aeiou]*)$/i.exec(w);
      if (m) return m[1] + { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' }[m[2].toLowerCase()] + m[3] + 'es';
    }
  }
  return w + 'es';
}

// 'sede' → { s: 'sede', p: 'sedes', g: 'f', duda: false }
function vocInferir(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const pals = t.split(' ');
  if (!pals[0]) return { s: '', p: '', g: 'm', duda: false };
  // Se pluraliza hasta la primera preposición: «nave industrial» → «naves industriales»,
  // «jefe de obra» → «jefes de obra».
  const corte = pals.findIndex((x, i) => i > 0 && /^(de|del|para|a|al|en|con|sin)$/i.test(x));
  const fin = corte < 0 ? pals.length : corte;
  const p = pals.map((x, i) => i < fin ? vocPluralPalabra(x) : x).join(' ');
  return { s: t, p, ...vocGenero(pals[0]) };
}

if (typeof module !== 'undefined') {
  module.exports = { VOC_PRESETS, VOC_DEFAULT, VOC_PALABRAS, vocArmar, vocFrase, vocInferir };
}

if (typeof window !== 'undefined') (function () {
  'use strict';

  function _tenant() {
    try { return (JSON.parse(localStorage.getItem('leva_session')) || {}).tenant || ''; } catch (_) { return ''; }
  }
  // Por empresa: en un mismo dispositivo puede entrar gente de dos empresas.
  const _key = () => 'leva_voc:' + _tenant();
  function _cached() {
    try { const r = localStorage.getItem(_key()); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  function _cache(v) { try { localStorage.setItem(_key(), JSON.stringify(v)); } catch (_) {} }

  window.VOC = vocArmar(_cached());
  // Módulo de activos apagado: <html class="sin-activos"> esconde todo lo marcado
  // data-modulo="activos" (styles.css). Los datos quedan.
  const _modulos = () => document.documentElement.classList.toggle('sin-activos', !window.VOC.modulos.activos);
  _modulos();
  window.voc = frase => vocFrase(frase, window.VOC);
  window.vocActivos = () => window.VOC.modulos.activos;
  // Para un adjetivo suelto, sin el sustantivo al lado: vocGen('centro', 'activo', 'activa').
  window.vocGen = (k, m, f) => window.VOC[k].g === 'f' ? f : m;
  // El trazo del ícono de la palabra, según el rubro de la empresa (lo usa icSvg('centro')).
  window.vocIconoTrazo = k => vocTrazo(k, window.VOC.rubro);

  const _ATTRS = ['placeholder', 'aria-label', 'title'];
  window.aplicarVoc = function (root) {
    const r = root || document;
    r.querySelectorAll('[data-voc]').forEach(el => { el.textContent = window.voc(el.dataset.voc); });
    // Un adjetivo suelto: data-voc-gen="activo:Activos|Activas".
    r.querySelectorAll('[data-voc-gen]').forEach(el => {
      const m = /^(centro|activo|responsable):([^|]*)\|(.*)$/.exec(el.dataset.vocGen);
      if (m) el.textContent = window.vocGen(m[1], m[2], m[3]);
    });
    _ATTRS.forEach(a => r.querySelectorAll('[data-voc-' + a + ']').forEach(el => {
      el.setAttribute(a, window.voc(el.getAttribute('data-voc-' + a)));
    }));
    r.querySelectorAll('[data-voc-icono]').forEach(el => { el.innerHTML = window.vocIconoTrazo(el.dataset.vocIcono); });
    // En el teléfono el texto de ayuda largo de un buscador queda cortado: va el corto.
    if (window.pantallaAngosta()) r.querySelectorAll('[data-placeholder-corto]').forEach(el => {
      el.placeholder = el.dataset.placeholderCorto;
    });
  };
  window.pantallaAngosta = () => !!window.matchMedia && matchMedia('(max-width: 560px)').matches;

  function _cambio(v) {
    const antes = JSON.stringify(window.VOC);
    window.VOC = vocArmar(v);
    if (JSON.stringify(window.VOC) === antes) return;
    _modulos();
    window.aplicarVoc();
    window.dispatchEvent(new CustomEvent('leva:voc', { detail: window.VOC }));
  }

  // Best-effort: sin red se queda con lo que tenía. Devuelve window.VOC.
  window.loadVocabulario = async function () {
    try {
      const r = await fetch(FIREBASE_CONFIG.databaseURL + '/vocabulario.json');
      if (r.ok) {
        const v = await r.json();
        _cache(v);
        _cambio(v);
      }
    } catch (_) {}
    return window.VOC;
  };

  // Sólo Administración → Empresa. Guarda la configuración completa.
  window.saveVocabulario = async function (datos) {
    const v = vocArmar(datos);
    const r = await _fetchConTope(FIREBASE_CONFIG.databaseURL + '/vocabulario.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    _cache(v);
    _cambio(v);
    return v;
  };

  document.addEventListener('DOMContentLoaded', () => window.aplicarVoc());
  // Con empresa en la sesión, se pide una vez por página (el login no tiene empresa todavía).
  if (_tenant() && window.levaListo) window.loadVocabulario();

  // Una pantalla ya abierta no vuelve a cargar sus scripts: el botón Volver la restaura
  // tal como estaba (y en el iPhone instalado no hay cómo recargar a mano). Primero lo
  // que dejó otra pantalla en este dispositivo, después lo que diga la base.
  async function _alVolver(restaurada) {
    if (!_tenant() || !window.levaListo) return;
    const antes = JSON.stringify(window.VOC);
    const c = _cached();
    if (c) _cambio(c);
    await window.loadVocabulario();
    // Restaurada, también quedó viejo lo que arma cada pantalla con voc(): se recarga.
    // Si sólo volvió de segundo plano no: puede estar a mitad de un formulario.
    if (restaurada && JSON.stringify(window.VOC) !== antes) location.reload();
  }
  window.addEventListener('pageshow', e => { if (e.persisted) _alVolver(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _alVolver(false);
  });
})();
