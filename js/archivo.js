/* VIMECO — Archivo: los archivos de Compras, en carpetas (traída de Leva).

   Tres niveles fijos:
     1. Carpetas por mes, por obra o por proveedor.
     2. El listado de OC de esa carpeta, ordenable y con lo que le falta.
     3. Los archivos de la OC en orden fijo: OC, presupuesto, facturas,
        remitos y el resto, con un hueco para lo que falta.
   En el teléfono se ve un nivel por vez; en la compu, los tres en columnas.
   Dónde estás va en la URL (`?v=obra&f=…&oc=oc:000700000382`), así el botón
   Atrás sube un nivel y un link deja abierta la carpeta.

   A diferencia de Leva no hay índice propio: los archivos siguen en el Drive de
   VIMECO (js/drive.js) y la pantalla se arma con lo que Firebase ya sabe de cada
   OC — `/historial` (carpetas de Drive, `fuenteUrl`, `adjuntos`) y `/remitos`
   (`drive`). Drive se consulta sólo para la carpeta de las OC que se miran:
   ahí se encuentran el PDF de la OC y el presupuesto, que no tienen id guardado.
   La carpeta `{fecha} | {proveedor}` la comparten las OC del mismo proveedor y
   día: lo que no se puede atribuir a una OC se muestra aparte.

   La pantalla es para 0000 y para quien tenga el permiso `archivo`. */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = s => escHtml(s == null ? '' : String(s));

  const NOMBRE_TIPO = { oc: 'OC', presupuesto: 'Presupuesto', factura: 'Factura', remito: 'Remito', otro: 'Otro', planilla: 'Planilla' };
  // Lo que tiene que tener una OC, en el orden en que se muestra.
  const DOCS = [['oc', 'OC'], ['presupuesto', 'Presupuesto'], ['factura', 'Factura'], ['remito', 'Remito']];
  const DIMS = { mes: 'Por mes', obra: 'Por obra', prov: 'Por proveedor' };
  const ICONO_DIM = { mes: 'calendar', obra: 'building', prov: 'store' };
  // Estados en los que la OC no tiene PDF emitido o ya no espera factura ni remito.
  const SIN_PDF = ['pendiente', 'rechazada', 'cancelada'];
  const CERRADA = ['anulada', 'pendiente', 'rechazada', 'cancelada'];
  const PAGINA = 100;
  const KEY_DIM = 'vimeco_archivo_dim';

  let historial = {};   // histKey → registro de /historial
  let remitosOC = {};   // nroOC → [remitos]
  let ocs = new Map();  // oc:{histKey} → { id, key, nro, obra, prov, ts, estado, h, folder, docs, extras }
  let porCarpeta = new Map(); // folderId de Drive → [id de OC]
  let docsReg = new Map();    // id de doc → doc (para los clicks)
  let st = { v: 'mes', f: '', oc: '', orden: 'fecha', inc: false };
  let limite = PAGINA;
  const ancho = window.matchMedia('(min-width: 960px)');

  let sesion = {};
  try { sesion = JSON.parse(localStorage.getItem('vimeco_session')) || {}; } catch (_) {}
  const codigo = sessionStorage.getItem('responsable_code') || sesion.codigo;
  const nombreUsuario = sessionStorage.getItem('responsable_name') || sesion.nombre;
  if (!codigo || !nombreUsuario) { location.href = 'index.html'; return; }
  sessionStorage.setItem('responsable_code', codigo);
  sessionStorage.setItem('responsable_name', nombreUsuario);
  $('hdr-name').textContent = nombreUsuario;

  function estado(html) {
    $('ar-estado').innerHTML = html;
    $('ar-estado').classList.remove('hidden');
  }

  async function puedeVer() {
    if (codigo === '0000') return true;
    try { const u = await getUsuario(codigo); return !!(u && u.archivo); } catch (_) { return false; }
  }

  // ---- Formato ----

  function tile(a) {
    const m = a.mime || '', n = (a.nombre || '').toLowerCase();
    if (m === 'application/pdf' || n.endsWith('.pdf')) return ['pdf', 'PDF'];
    if (m.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/.test(n)) return ['img', 'IMG'];
    if (/sheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/.test(n)) return ['xls', 'XLS'];
    if (/word|document/.test(m) || /\.docx?$/.test(n)) return ['doc', 'DOC'];
    const ext = (n.match(/\.([a-z0-9]{1,4})$/) || [])[1];
    return ['otro', ext ? ext.toUpperCase() : '—'];
  }

  function fmtPeso(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' MB';
  }

  const fecha = ts => ts ? new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const claveMes = ts => { const d = new Date(ts || 0); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const nombreMes = k => {
    const [y, m] = k.split('-');
    const s = new Date(+y, +m - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const plural = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

  function resaltar(s, q) {
    s = String(s || '');
    if (!q) return esc(s);
    const i = s.toLowerCase().indexOf(q);
    return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<mark class="ar-hl">' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
  }

  // Qué es un archivo de la carpeta, por el prefijo que le ponen al subirlo
  // (nombreArchivoDrive en ui.js) y el nombre del PDF de la OC.
  function tipoPorNombre(n) {
    if (/^OC_/.test(n)) return 'oc';
    if (/^Factura\b/i.test(n)) return 'factura';
    if (/^Remito\b/i.test(n)) return 'remito';
    if (/^Presupuesto\b/i.test(n)) return 'presupuesto';
    if (/\.(xlsx?|csv)$/i.test(n)) return 'planilla';
    return 'otro';
  }

  const idDeLink = url => (String(url || '').match(/\/d\/([\w-]{10,})/) || [])[1] || '';

  // ---- Modelo: de /historial y /remitos a carpetas ----

  function armar() {
    ocs = new Map(); porCarpeta = new Map(); docsReg = new Map();
    Object.entries(historial).forEach(([key, h]) => {
      if (!h || !h.nroOC) return;
      const p = h._payload || {};
      const o = {
        id: 'oc:' + key, key, h,
        nro: h.nroOC,
        obra: h.obra || p.obra || '',
        prov: (h.proveedor && h.proveedor.nombre) || (p.proveedor && p.proveedor.nombre) || '',
        ts: h.timestamp || 0,
        estado: h.estado || '',
        folder: h.drive_folder_obras_id || h.drive_folder_proveedores_id || h.drive_folder_id || '',
        docs: [], extras: []
      };
      // OC de prueba (obra o proveedor «X», como esObraPrueba en driveBackup.js): no son compras.
      if (o.obra.trim().toLowerCase() === 'x' || o.prov.trim().toLowerCase() === 'x') return;
      if (o.folder) {
        if (!porCarpeta.has(o.folder)) porCarpeta.set(o.folder, []);
        porCarpeta.get(o.folder).push(o.id);
      }
      let n = 0;
      const doc = d => { d.id = d.fileId || key + '_' + (n++); d.ocId = o.id; o.docs.push(d); docsReg.set(d.id, d); };

      if (o.folder && !SIN_PDF.includes(o.estado))
        doc({ tipo: 'oc', nombre: 'OC ' + o.nro + '.pdf', prefijo: 'OC_' + o.nro + '_', folderId: o.folder, ts: o.ts, mime: 'application/pdf', porNombre: true });
      const fuente = idDeLink(h.fuenteUrl);
      if (fuente) doc({ tipo: 'presupuesto', nombre: 'Presupuesto', fileId: fuente, ts: o.ts });
      Object.values(h.adjuntos || {}).forEach(a => {
        if (!a || !a.nombre) return;
        doc({ tipo: a.tipo === 'factura' ? 'factura' : tipoPorNombre(a.nombre) === 'oc' ? 'otro' : tipoPorNombre(a.nombre),
          nombre: a.nombre, ts: a.ts, por: a.por, fileId: a.fileId || null, folderId: a.folderId || o.folder });
      });
      (remitosOC[h.nroOC] || []).forEach(r => {
        const d = r.drive || {};
        const tiene = d.fileId || (d.folderId && d.archivo);
        doc({ tipo: 'remito', nombre: d.archivo || ('Remito ' + (r.nro || '')), ts: r.timestamp, por: r.recibidoPor && r.recibidoPor.nombre,
          fileId: d.fileId || null, folderId: d.folderId || null, sinArchivo: !tiene });
      });
      if (_carpetas.has(o.folder) && _carpetas.get(o.folder).files) completarDocs(o, _carpetas.get(o.folder).files);
      ocs.set(o.id, o);
    });
    // Con la carpeta ya listada, se reparten los archivos sin dueño.
    ocs.forEach(o => { if (_carpetas.has(o.folder) && _carpetas.get(o.folder).files) repartir(o, _carpetas.get(o.folder).files); });
    ocs.forEach(o => o.docs.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  }

  const docsDe = (o, t) => o.docs.filter(a => a.tipo === t && !a.noEsta);
  const archivosDe = o => o.docs.filter(a => !a.noEsta && !a.sinArchivo);
  // Incompleta = le falta la factura o el remito: lo que llega después de
  // emitir. Las anuladas o sin emitir no esperan nada.
  const incompleta = o => !CERRADA.includes(o.estado) && (!docsDe(o, 'factura').length || !docsDe(o, 'remito').length);

  // ---- Drive: la carpeta de cada OC ----

  // Una carpeta que no se pudo listar queda marcada (`error`) y no se vuelve a
  // pedir hasta recargar: sin eso, cada repintado la reintentaría.
  const _carpetas = new Map();   // folderId → { prom, files, error }
  function listarCarpeta(folderId) {
    let c = _carpetas.get(folderId);
    if (!c) {
      c = { files: null, error: false };
      c.prom = listDriveFolderFiles(folderId)
        .then(files => { c.files = files; return files; })
        .catch(e => { c.error = true; throw e; });
      _carpetas.set(folderId, c);
    }
    return c.prom;
  }

  // Completa lo que Firebase no sabe: el id del PDF y de los archivos viejos
  // (sólo nombre y carpeta), el tamaño y el tipo.
  function completarDocs(o, files) {
    o.docs.forEach(d => {
      let f = null;
      if (d.porNombre) {
        f = files.filter(x => x.name.startsWith(d.prefijo)).sort((a, b) => String(b.createdTime).localeCompare(String(a.createdTime)))[0] || null;
        d.noEsta = !f;
      } else if (d.fileId) f = files.find(x => x.id === d.fileId) || null;
      else if (!d.sinArchivo && d.folderId === o.folder) f = files.find(x => x.name === d.nombre) || null;
      if (!f) return;
      d.fileId = d.fileId || f.id;
      d.nombre = f.name; d.size = Number(f.size) || d.size; d.mime = f.mimeType || d.mime;
      if (!d.ts && f.createdTime) d.ts = Date.parse(f.createdTime);
      docsReg.set(d.fileId, d);
    });
  }

  // Lo que hay en la carpeta y no es de ninguna OC conocida. Si la carpeta es
  // sólo de esta OC, es suyo; si la comparte, va aparte (`extras`).
  function repartir(o, files) {
    const otras = (porCarpeta.get(o.folder) || []).filter(id => id !== o.id).map(id => ocs.get(id)).filter(Boolean);
    const conocidos = new Set();
    [o, ...otras].forEach(x => x.docs.forEach(d => { if (d.fileId) conocidos.add(d.fileId); }));
    const sueltos = files.filter(f => !conocidos.has(f.id) && !/^OC_/.test(f.name) && !f.name.startsWith('_'));
    o.extras = [];
    o.compartida = otras.map(x => x.nro);
    sueltos.forEach(f => {
      const d = { id: f.id, fileId: f.id, ocId: o.id, tipo: tipoPorNombre(f.name), nombre: f.name, size: Number(f.size) || 0,
        mime: f.mimeType, ts: Date.parse(f.createdTime) || 0, folderId: o.folder, deDrive: true };
      docsReg.set(d.id, d);
      if (otras.length) o.extras.push(d);
      else o.docs.push(d);
    });
  }

  // Lista la carpeta de las OC que se ven y vuelve a pintar cuando llegan.
  let _pendientes = [], _activas = 0, _repintar = 0;
  function pedirCarpetas(lista) {
    lista.forEach(o => { if (o.folder && !_carpetas.has(o.folder) && !_pendientes.includes(o)) _pendientes.push(o); });
    while (_activas < 3 && _pendientes.length) {
      const o = _pendientes.shift();
      if (_carpetas.has(o.folder)) continue;
      _activas++;
      listarCarpeta(o.folder).catch(e => console.warn('listarCarpeta:', e)).finally(() => {
        _activas--;
        clearTimeout(_repintar);
        _repintar = setTimeout(() => { armar(); pintarUso(); pintar(true); }, 250);
        pedirCarpetas([]);
      });
    }
  }

  function claveOC(o, v) {
    if (v === 'mes')  return claveMes(o.ts);
    if (v === 'obra') return o.obra || 'Sin obra';
    return o.prov || 'Sin proveedor';
  }
  const nombreCarpeta = (k, v) => v === 'mes' ? nombreMes(k) : k;

  // Carpetas de nivel 1: [clave, [ocs]]
  function carpetas(v) {
    const m = new Map();
    ocs.forEach(o => { const k = claveOC(o, v); if (!m.has(k)) m.set(k, []); m.get(k).push(o); });
    const out = [...m.entries()];
    if (v === 'mes') out.sort((a, b) => b[0].localeCompare(a[0]));
    else out.sort((a, b) => (a[0].startsWith('Sin ') - b[0].startsWith('Sin ')) || a[0].localeCompare(b[0], 'es'));
    return out;
  }

  // ---- Navegación ----

  function url(s) {
    const p = new URLSearchParams();
    p.set('v', s.v);
    if (s.f)  p.set('f', s.f);
    if (s.oc) p.set('oc', s.oc);
    return 'archivo.html?' + p.toString();
  }
  function ir(cambios) {
    st = { ...st, ...cambios };
    if ('f' in cambios && !('orden' in cambios)) { st.orden = 'fecha'; st.inc = false; limite = PAGINA; }
    try { localStorage.setItem(KEY_DIM, st.v); } catch (_) {}
    history.pushState({ archivo: 1 }, '', url(st));
    pintar();
    window.scrollTo(0, 0);
  }
  function leerUrl() {
    const p = new URLSearchParams(location.search);
    let v = p.get('v');
    if (!DIMS[v]) { try { v = localStorage.getItem(KEY_DIM); } catch (_) { v = ''; } }
    st.v = DIMS[v] ? v : 'mes';
    st.f = p.get('f') || '';
    st.oc = p.get('oc') || '';
    // Link a una OC (`?nro=0007-00000382`): se abre en su lugar del árbol.
    const nro = p.get('nro');
    if (nro) {
      const o = ocs.get('oc:' + nro.replace(/-/g, ''));
      if (o) { st.oc = o.id; st.f = claveOC(o, st.v); }
      history.replaceState(null, '', url(st));
    }
  }

  // ---- Pintar ----

  // `suave`: repintado porque llegó una carpeta de Drive; no mueve el scroll de
  // las columnas.
  function pintar(suave) {
    const q = $('ar-q').value.trim().toLowerCase();
    $('ar-dim').querySelectorAll('[data-dim]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dim === st.v)));
    $('ar-cols').classList.toggle('hidden', !!q);
    $('ar-crumbs').classList.toggle('hidden', !!q || !st.f);
    $('ar-res').classList.toggle('hidden', !q);
    if (q) { pintarBusqueda(q); return; }

    if (st.oc && !ocs.has(st.oc)) st.oc = '';
    const lista1 = carpetas(st.v);
    if (st.f && !lista1.some(([k]) => k === st.f)) { st.f = ''; st.oc = ''; }
    // En la compu siempre hay una carpeta abierta: la primera.
    const f = st.f || (ancho.matches ? (lista1[0] || [''])[0] : '');

    const scroll = suave ? ['ar-c1', 'ar-c2', 'ar-c3'].map(id => $(id).scrollTop) : null;
    $('ar-cols').dataset.nivel = st.oc ? '3' : st.f ? '2' : '1';
    pintarMigas(f);
    $('ar-c1').innerHTML = nivel1(lista1, f);
    $('ar-c2').innerHTML = f ? nivel2(f) : '';
    $('ar-c3').innerHTML = st.oc ? nivel3(st.oc) : `<div class="ar-ph">${f ? 'Elegí una OC para ver sus archivos.' : ''}</div>`;
    if (scroll) ['ar-c1', 'ar-c2', 'ar-c3'].forEach((id, i) => { $(id).scrollTop = scroll[i]; });
    if (st.oc) pedirCarpetas([ocs.get(st.oc)]);
  }

  function pintarMigas(f) {
    const p = [`<button type="button" data-nav="raiz">Archivo</button>`];
    if (f) p.push(st.oc ? `<button type="button" data-nav="f">${esc(nombreCarpeta(f, st.v))}</button>` : `<span>${esc(nombreCarpeta(f, st.v))}</span>`);
    if (st.oc) p.push(`<span>${esc('OC ' + ocs.get(st.oc).nro)}</span>`);
    $('ar-crumbs').innerHTML = p.join('<i>›</i>');
  }

  function nivel1(lista, f) {
    let h = `<div class="ar-lbl">${DIMS[st.v]}<i>${plural(lista.length, 'carpeta', 'carpetas')}</i></div>`;
    h += lista.length ? `<div class="ar-fgrid">` + lista.map(([k, l]) => {
      const inc = l.filter(incompleta).length;
      const n = l.reduce((s, o) => s + archivosDe(o).length, 0);
      return `<button type="button" class="ar-fd" data-f="${esc(k)}" aria-current="${k === f}"><span class="ar-fd-ic">${icSvg(ICONO_DIM[st.v])}</span>
        <b>${esc(nombreCarpeta(k, st.v))}</b><small>${plural(l.length, 'OC', 'OC')} · ${plural(n, 'archivo', 'archivos')}</small>
        <em class="${inc ? '' : 'ok'}">${inc ? plural(inc, 'sin factura o remito', 'sin factura o remito') : 'Todo cargado'}</em></button>`;
    }).join('') + `</div>` : `<div class="ar-ph">Todavía no hay OC.</div>`;
    return h;
  }

  function ordenar(l) {
    const r = l.slice();
    if (st.orden === 'nro') r.sort((a, b) => String(b.nro).localeCompare(String(a.nro), 'es', { numeric: true }));
    else if (st.orden === 'obra') r.sort((a, b) => (a.obra || '').localeCompare(b.obra || '', 'es') || b.ts - a.ts);
    else if (st.orden === 'prov') r.sort((a, b) => (a.prov || '').localeCompare(b.prov || '', 'es') || b.ts - a.ts);
    else r.sort((a, b) => b.ts - a.ts);
    return r;
  }

  const dots = o => `<span class="ar-dots" title="${DOCS.map(([t, n]) => n + (docsDe(o, t).length ? ': sí' : ': falta')).join(' · ')}">` +
    DOCS.map(([t]) => `<span class="ar-dot ${t} ${docsDe(o, t).length ? 'on' : ''}"></span>`).join('') + `</span>`;
  const leyenda = `<div class="ar-ley">${DOCS.map(([t, n]) => `<span><span class="ar-dot on ${t}"></span>${n}</span>`).join('')}<span><span class="ar-dot"></span>Falta</span></div>`;
  const etiquetaEstado = o => CERRADA.includes(o.estado)
    ? `<span class="ar-est ${o.estado === 'pendiente' ? 'ar-est--pend' : ''}">${esc(o.estado.charAt(0).toUpperCase() + o.estado.slice(1))}</span>` : '';

  function nivel2(f) {
    const todas = [...ocs.values()].filter(o => claveOC(o, st.v) === f);
    let l = st.inc ? todas.filter(incompleta) : todas;
    l = ordenar(l);
    // La otra dimensión es la que distingue a una OC de otra en esta carpeta.
    const otra = st.v === 'prov' ? 'obra' : 'prov';
    const opciones = [['fecha', 'Fecha'], ['nro', 'N°'], [otra, otra === 'obra' ? 'Obra' : 'Proveedor']];
    const n = todas.reduce((s, o) => s + archivosDe(o).length, 0);
    const vis = l.slice(0, limite);
    pedirCarpetas(vis);
    return `<div class="ar-fh"><h2>${esc(nombreCarpeta(f, st.v))}</h2>
        <p>${plural(todas.length, 'OC', 'OC')} · ${plural(n, 'archivo', 'archivos')}</p></div>
      <div class="ar-bar"><div class="ar-seg ar-seg--sm" role="group" aria-label="Ordenar OC">${opciones.map(([k, nom]) =>
        `<button type="button" data-orden="${k}" aria-pressed="${k === st.orden}">${nom}</button>`).join('')}</div>
        <button type="button" class="ar-tog" data-inc aria-pressed="${st.inc}">Sin factura o remito</button></div>
      ${vis.length ? `<div class="ar-rows">` + vis.map(o => {
        const sub = [st.v === 'mes' ? o.obra : '', fecha(o.ts), plural(archivosDe(o).length, 'archivo', 'archivos')].filter(Boolean).join(' · ');
        return `<button type="button" class="ar-r" data-oc="${esc(o.id)}" aria-current="${o.id === st.oc}">
          <span class="ar-r-n">${esc(o.nro)}</span>
          <span class="ar-r-tx"><b>${esc((otra === 'obra' ? o.obra : o.prov) || '—')}${etiquetaEstado(o)}</b><small>${esc(sub)}</small></span>
          ${dots(o)}${icSvg('chevron', 'ar-chev')}</button>`;
      }).join('') + `</div>` : `<div class="ar-ph">Todas las OC de esta carpeta tienen factura y remito.</div>`}
      ${l.length > limite ? `<button type="button" class="ar-mas" id="ar-mas">Ver ${Math.min(PAGINA, l.length - limite)} más</button>` : ''}
      ${vis.length ? leyenda : ''}`;
  }

  function itemHtml(a, conOC) {
    const [cls, lbl] = tile(a);
    const o = conOC && ocs.get(a.ocId);
    const meta = [o ? 'OC ' + o.nro : '', fecha(a.ts), a.size ? fmtPeso(a.size) : '', a.por].filter(Boolean).join(' · ');
    return `<div class="ar-item">
      <button type="button" class="ar-open" data-id="${esc(a.id)}" ${a.sinArchivo ? 'disabled title="Se cargó sin archivo"' : ''}>
        <span class="ar-tile ar-tile--${cls}">${esc(a.sinArchivo ? '—' : lbl)}</span>
        <span class="ar-r-tx"><b>${esc(a.nombre)}</b>
          <small><span class="ar-tipo ar-tipo--${esc(a.tipo)}">${esc(NOMBRE_TIPO[a.tipo] || 'Otro')}</span>${esc(a.sinArchivo ? 'sin archivo' : meta)}</small></span>
      </button>
    </div>`;
  }

  function nivel3(id) {
    const o = ocs.get(id);
    const c = o.folder && _carpetas.get(o.folder);
    const listada = !o.folder || (c && (c.files || c.error));
    let h = '';
    DOCS.forEach(([t, n]) => {
      const ds = docsDe(o, t);
      if (ds.length) { h += ds.map(a => itemHtml(a)).join(''); return; }
      if (t === 'oc') {
        if (SIN_PDF.includes(o.estado)) h += `<div class="ar-falta ar-falta--info">${icSvg('info')}La OC no tiene PDF: está ${esc(o.estado)}.</div>`;
        else h += `<div class="ar-falta ar-falta--info">${icSvg('info')}${o.folder ? 'El PDF de la OC no está en su carpeta de Drive.' : 'La OC no tiene respaldo en Drive.'}</div>`;
      }
      else if (t === 'presupuesto') h += listada
        ? `<button type="button" class="ar-falta" data-subir="presupuesto">${icSvg('plus')}Sin presupuesto<b>Subir</b></button>`
        : `<div class="ar-falta ar-falta--info">${icSvg('search')}Buscando el presupuesto en Drive…</div>`;
      else if (!CERRADA.includes(o.estado))
        h += `<a class="ar-falta" href="${t === 'factura' ? 'facturas.html' : 'remitos.html'}">${icSvg('plus')}Falta ${n.toLowerCase()}<b>Cargar en ${t === 'factura' ? 'Facturas' : 'Remitos'}</b></a>`;
    });
    h += o.docs.filter(a => !a.noEsta && !DOCS.some(([t]) => t === a.tipo)).map(a => itemHtml(a)).join('');
    const ext = o.extras && o.extras.length ? `<div class="ar-lbl">En la misma carpeta de Drive<i>${plural(o.extras.length, 'archivo', 'archivos')}</i></div>
      <div class="ar-rows">${o.extras.map(a => itemHtml(a)).join('')}</div>
      <p class="ar-nota">La carpeta «${esc(fechaCarpeta(o))} | ${esc(o.prov || 'Sin proveedor')}» la comparte con ${o.compartida.length === 1 ? 'la OC' : 'las OC'} ${esc(o.compartida.join(', '))}: estos archivos pueden ser de cualquiera.</p>` : '';
    const t = Number(o.h.total) || 0;
    const total = t ? (o.h.moneda === 'USD' ? 'US$ ' : '$ ') + t.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    const extra = [o.h.fecha || fecha(o.ts), total, o.h.responsable && o.h.responsable.nombre ? 'emitió ' + o.h.responsable.nombre : ''].filter(Boolean).join(' · ');
    const nArch = archivosDe(o).length;
    const peso = archivosDe(o).reduce((s, a) => s + (Number(a.size) || 0), 0);
    return `<div class="ar-fh"><h2>OC ${esc(o.nro)}${etiquetaEstado(o)}</h2>
        <p><b>${esc(o.prov || 'Sin proveedor')}</b> · ${esc(o.obra || 'Sin obra')}</p>
        <p>${esc(extra)}</p>
        <div class="ar-acts"><button type="button" class="ar-act" data-subir="otro">${icSvg('plus')}Agregar archivo</button>
          ${o.folder ? `<a class="ar-act" href="https://drive.google.com/drive/folders/${esc(o.folder)}" target="_blank" rel="noopener">${icSvg('folder')}Carpeta en Drive</a>` : ''}</div></div>
      <div class="ar-lbl">${plural(nArch, 'archivo', 'archivos')}<i>${peso ? fmtPeso(peso) : ''}</i></div>
      <div class="ar-rows">${h}</div>${ext}
      ${c && c.error ? `<p class="ar-nota">No se pudo mirar la carpeta en Drive: el PDF y el presupuesto pueden estar y no figurar.</p>` : ''}`;
  }

  // Día con el que se nombró la carpeta de Drive de la OC (UTC, como al emitirla).
  const fechaCarpeta = o => new Date(o.ts || Date.now()).toISOString().slice(0, 10);

  function textoOC(o) {
    return ['oc ' + o.nro, o.nro, o.prov, o.obra].join(' ').toLowerCase();
  }

  function pintarBusqueda(q) {
    const terms = q.split(/\s+/).filter(Boolean);
    const hay = txt => terms.every(t => txt.includes(t));
    const res = [];
    ocs.forEach(o => {
      const files = archivosDe(o).filter(a => hay(textoOC(o) + ' ' + (a.nombre || '').toLowerCase() + ' ' + (NOMBRE_TIPO[a.tipo] || '').toLowerCase()));
      if (hay(textoOC(o)) || files.length) res.push({ o, files: hay(textoOC(o)) ? [] : files });
    });
    res.sort((a, b) => b.o.ts - a.o.ts);
    if (!res.length) {
      $('ar-res').innerHTML = `<div class="ar-vacio">${icSvg('search')}<span>No hay nada que coincida.</span></div>`;
      return;
    }
    const t0 = terms[0];
    $('ar-res').innerHTML = `<div class="ar-lbl">${plural(res.length, 'OC', 'OC')}</div><div class="ar-rows">` + res.slice(0, limite).map(({ o, files }) => {
      const camino = nombreCarpeta(claveOC(o, st.v), st.v) + ' › OC ' + o.nro;
      return `<button type="button" class="ar-r" data-ir-oc="${esc(o.id)}">
        <span class="ar-r-n">${resaltar(o.nro, t0)}</span>
        <span class="ar-r-tx"><b>${resaltar(o.prov || '—', t0)}</b>
          <small>${files.length ? files.map(a => resaltar(a.nombre, t0)).join(', ') : esc(camino) + (o.obra && st.v !== 'obra' ? ' · ' + resaltar(o.obra, t0) : '')}</small></span>
        ${dots(o)}${icSvg('chevron', 'ar-chev')}</button>`;
    }).join('') + `</div>` +
      (res.length > limite ? `<button type="button" class="ar-mas" id="ar-mas">Ver ${Math.min(PAGINA, res.length - limite)} más</button>` : '');
  }

  function pintarUso() {
    let n = 0;
    ocs.forEach(o => { n += archivosDe(o).length; });
    $('ar-uso').textContent = `${plural(ocs.size, 'OC', 'OC')} · ${plural(n, 'archivo', 'archivos')}`;
  }

  // ---- Subir a la OC abierta ----
  // El presupuesto (queda anotado en la OC como `fuenteUrl`, igual que al pedir
  // autorización) u otro archivo (queda en `adjuntos`, igual que en Facturas).
  // Facturas y remitos se cargan en sus pantallas, que además guardan los datos
  // del comprobante.

  let _subiendo = null;
  function elegirArchivo(tipo) {
    if (!ocs.has(st.oc)) return;
    _subiendo = { tipo, oc: st.oc };
    $('ar-file').value = '';
    $('ar-file').click();
  }
  async function subir(file) {
    const s = _subiendo; _subiendo = null;
    const o = s && ocs.get(s.oc);
    if (!o || !file) return;
    const h = o.h;
    const meta = {
      drive_folder_obras_id: h.drive_folder_obras_id, drive_folder_proveedores_id: h.drive_folder_proveedores_id,
      drive_folder_id: h.drive_folder_id, obra: o.obra || 'Sin obra', fecha: fechaCarpeta(o),
      proveedor: o.prov || 'Sin proveedor', nroOC: o.nro
    };
    toast('Subiendo ' + file.name + '…', 'info');
    try {
      if (s.tipo === 'presupuesto') {
        const f = new File([file], nombreArchivoDrive('Presupuesto', file.name), { type: file.type });
        const r = await attachToDriveOC(f, meta);
        if (!r.fileId) throw new Error('Drive no devolvió el archivo');
        h.fuenteUrl = `https://drive.google.com/file/d/${r.fileId}/view`;
        await patchHistorialEntry(o.key, { fuenteUrl: h.fuenteUrl });
      } else {
        const r = await attachToDriveOC(file, meta);
        const registro = { tipo: 'otro', nombre: file.name, ts: Date.now(), por: nombreUsuario, fileId: r.fileId || null, folderId: r.folderId || null };
        h.adjuntos = h.adjuntos || {};
        h.adjuntos['local_' + registro.ts] = registro;
        await registrarAdjuntoOC(o.nro, registro).catch(e => console.warn('registrarAdjunto:', e));
      }
      if (o.folder) _carpetas.delete(o.folder);
      armar(); pintarUso(); pintar(true);
      toast('Archivo guardado.', 'success');
    } catch (e) {
      console.error('subir:', e);
      toast('No se pudo subir el archivo. ' + (e.message || ''), 'error');
    }
  }

  // ---- Visor ----
  // Pantalla completa encima de la página: imagen, PDF (con pdf.js, porque ni
  // Chrome de Android ni iOS muestran bien un PDF en un iframe) o, para el
  // resto, el nombre y un botón para bajarlo. El botón Atrás del teléfono lo
  // cierra.

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let _pdfjs = null;
  function cargarPdfjs() {
    if (_pdfjs) return _pdfjs;
    _pdfjs = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { _pdfjs = null; reject(new Error('No se pudo cargar el visor de PDF')); };
      document.head.appendChild(s);
    });
    return _pdfjs;
  }

  function descargar(blob, nombre) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = nombre || 'archivo';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  }

  const _bajados = new Map();   // fileId → { blob, nombre, mime } mientras la página esté abierta
  let _abierto = null;

  async function abrirArchivo(d) {
    if (!d || d.sinArchivo) return;
    cerrarVisor(true);
    const el = document.createElement('div');
    el.className = 'vis';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="vis-hd">
        <div class="vis-t"><b>${esc(d.nombre)}</b><span></span></div>
        <button type="button" class="vis-b hidden" data-a="share" title="Compartir" aria-label="Compartir">${icSvg('share')}</button>
        <button type="button" class="vis-b hidden" data-a="down" title="Descargar" aria-label="Descargar"><svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <a class="vis-b hidden" data-a="drive" target="_blank" rel="noopener" title="Abrir en Drive" aria-label="Abrir en Drive">${icSvg('maximize')}</a>
        <button type="button" class="vis-b" data-a="x" title="Cerrar" aria-label="Cerrar">${icSvg('x')}</button>
      </div>
      <div class="vis-c"><div class="vis-msg"><span>Abriendo…</span><div class="vis-bar"><i></i></div></div></div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    const est = { el, urls: [] };
    _abierto = est;
    try { history.pushState({ visor: 1, archivo: 1 }, ''); est.conHistoria = true; } catch (_) {}

    const $t = el.querySelector('.vis-t'), $c = el.querySelector('.vis-c');
    el.querySelector('[data-a="x"]').onclick = () => cerrarVisor();
    try {
      // Los archivos viejos sólo tienen carpeta y nombre: se lo busca.
      if (!d.fileId && d.folderId && d.nombre) d.fileId = await findFileInFolder(d.folderId, d.nombre);
      if (!d.fileId) throw new Error('no existe');
      const bDrive = el.querySelector('[data-a="drive"]');
      bDrive.href = `https://drive.google.com/file/d/${d.fileId}/view`;
      bDrive.classList.remove('hidden');

      let x = _bajados.get(d.fileId);
      if (!x) { x = await bajarDriveArchivo(d.fileId); if (!x.nativo) _bajados.set(d.fileId, x); }
      if (_abierto !== est) return;
      $t.querySelector('b').textContent = x.nombre;
      if (x.nativo) {
        $c.innerHTML = `<div class="vis-msg"><span>Es un documento de Google: se abre en Drive.</span>
          <a class="vis-dl" href="${esc(bDrive.href)}" target="_blank" rel="noopener">Abrir en Drive</a></div>`;
        return;
      }
      const { blob, nombre, mime } = x;
      $t.querySelector('span').textContent = fmtPeso(blob.size);
      const bDown = el.querySelector('[data-a="down"]');
      bDown.classList.remove('hidden');
      bDown.onclick = () => descargar(blob, nombre);
      const file = new File([blob], nombre, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const bSh = el.querySelector('[data-a="share"]');
        bSh.classList.remove('hidden');
        bSh.onclick = () => navigator.share({ files: [file], title: nombre }).catch(() => {});
      }

      if (/^image\//.test(mime)) {
        const u = URL.createObjectURL(blob); est.urls.push(u);
        $c.innerHTML = `<img src="${u}" alt="${esc(nombre)}">`;
      } else if (mime === 'application/pdf') {
        const pdfjs = await cargarPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (_abierto !== est) return;
        $c.innerHTML = '';
        const w = Math.min($c.clientWidth - 24, 1000);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= doc.numPages; n++) {
          const pag = await doc.getPage(n);
          if (_abierto !== est) return;
          const vp0 = pag.getViewport({ scale: 1 });
          const vp  = pag.getViewport({ scale: (w / vp0.width) * dpr });
          const cv  = document.createElement('canvas');
          cv.width = vp.width; cv.height = vp.height;
          cv.style.width = Math.round(vp.width / dpr) + 'px';
          $c.appendChild(cv);
          await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        }
      } else {
        $c.innerHTML = `<div class="vis-msg"><span>Este tipo de archivo no se puede ver acá.</span>
          <button type="button" class="vis-dl">Descargar</button></div>`;
        $c.querySelector('.vis-dl').onclick = () => descargar(blob, nombre);
      }
    } catch (e) {
      if (_abierto !== est) return;
      console.error('abrirArchivo:', e);
      const msg = /no existe/.test(e.message) ? 'El archivo ya no está en Drive.'
                : !navigator.onLine ? 'Sin conexión: el archivo se abre cuando vuelva la señal.'
                : 'No se pudo abrir el archivo.';
      $c.innerHTML = `<div class="vis-msg"><span>${esc(msg)}</span></div>`;
    }
  }

  function cerrarVisor(sinHistoria) {
    const e = _abierto;
    if (!e) return;
    _abierto = null;
    e.urls.forEach(u => URL.revokeObjectURL(u));
    e.el.remove();
    document.body.style.overflow = '';
    if (e.conHistoria && !sinHistoria) { try { history.back(); } catch (_) {} }
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _abierto) cerrarVisor(); });

  // ---- Arranque ----

  async function iniciar() {
    $('ar-ic-search').innerHTML = icSvg('search');

    if (!(await puedeVer())) {
      estado(`${icSvg('lock')}<span>Archivo es para quien tiene el permiso. Pedíselo a quien administra el sistema.</span>`);
      return;
    }
    try {
      const [hist, rems] = await Promise.all([
        fetch(FIREBASE_CONFIG.databaseURL + '/historial.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }),
        getRemitos()
      ]);
      historial = hist || {};
      remitosOC = {};
      rems.forEach(r => { (remitosOC[r.nroOC] = remitosOC[r.nroOC] || []).push(r); });
    } catch (e) {
      console.error('Archivo:', e);
      estado(`${icSvg('alert')}<span>No se pudo cargar el archivo. Revisá la conexión y volvé a entrar.</span>`);
      return;
    }
    armar();
    if (!ocs.size) {
      estado(`${icSvg('folder')}<span>Todavía no hay OC. Los archivos se guardan solos al emitir una OC y al cargar facturas o remitos.</span>`);
      return;
    }
    leerUrl();
    $('ar-estado').classList.add('hidden');
    $('ar-cuerpo').classList.remove('hidden');
    pintarUso();
    pintar();

    $('ar-q').addEventListener('input', () => { limite = PAGINA; pintar(); });
    $('ar-dim').addEventListener('click', e => {
      const b = e.target.closest('[data-dim]'); if (!b || b.dataset.dim === st.v) return;
      // La OC abierta sigue abierta, ahora dentro de su carpeta de esta vista.
      const o = ocs.get(st.oc);
      ir({ v: b.dataset.dim, f: o ? claveOC(o, b.dataset.dim) : '', oc: o ? st.oc : '' });
    });
    $('ar-crumbs').addEventListener('click', e => {
      const b = e.target.closest('[data-nav]'); if (!b) return;
      ir(b.dataset.nav === 'raiz' ? { f: '', oc: '' } : { oc: '' });
    });
    $('ar-cuerpo').addEventListener('click', e => {
      const t = e.target.closest('button, a'); if (!t) return;
      const d = t.dataset;
      if (d.id) abrirArchivo(docsReg.get(d.id));
      else if (d.f) ir({ f: d.f, oc: '' });
      else if (d.oc) {
        // En la compu la carpeta de la columna 1 puede estar abierta sin estar en la URL.
        const cur = document.querySelector('.ar-fd[aria-current="true"]');
        ir({ f: st.f || (cur ? cur.dataset.f : ''), oc: d.oc, orden: st.orden });
      }
      else if (d.irOc) { const o = ocs.get(d.irOc); $('ar-q').value = ''; ir({ f: claveOC(o, st.v), oc: o.id }); }
      else if (d.orden) { st.orden = d.orden; pintar(); }
      else if ('inc' in d) { st.inc = !st.inc; pintar(); }
      else if (d.subir) elegirArchivo(d.subir);
      else if (t.id === 'ar-mas') { limite += PAGINA; pintar(); }
    });
    $('ar-file').addEventListener('change', e => subir(e.target.files && e.target.files[0]));
    window.addEventListener('popstate', () => {
      if (_abierto) { _abierto.conHistoria = false; cerrarVisor(); return; }
      leerUrl(); pintar();
    });
    ancho.addEventListener('change', () => pintar());
  }

  iniciar();
})();
