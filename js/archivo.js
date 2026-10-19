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

  // Lo que hay en la carpeta y no es de ninguna OC conocida. Si el nombre trae
  // el número de una OC de la carpeta, es de esa. Si no, y la carpeta es sólo
  // de esta OC, es suyo; si la comparte, no se muestra entre sus archivos: va
  // aparte (`extras`), plegado, para asignárselo a mano.
  function repartir(o, files) {
    const otras = (porCarpeta.get(o.folder) || []).filter(id => id !== o.id).map(id => ocs.get(id)).filter(Boolean);
    const conocidos = new Set();
    [o, ...otras].forEach(x => x.docs.forEach(d => { if (d.fileId) conocidos.add(d.fileId); }));
    // Las planillas «Entregas - OC …» que sube Remitos no se listan: acá se
    // arman al momento con la tarjeta de entrega (siempre al día).
    const sueltos = files.filter(f => !conocidos.has(f.id) && !/^OC_/.test(f.name) && !f.name.startsWith('_') && !/^Entregas - OC /.test(f.name));
    o.extras = [];
    o.compartida = otras.map(x => x.nro);
    sueltos.forEach(f => {
      const d = { id: f.id, fileId: f.id, ocId: o.id, tipo: tipoPorNombre(f.name), nombre: f.name, size: Number(f.size) || 0,
        mime: f.mimeType, ts: Date.parse(f.createdTime) || 0, folderId: o.folder, deDrive: true };
      docsReg.set(d.id, d);
      const duenio = [o, ...otras].find(x => x.nro && f.name.includes(x.nro));
      if (duenio) { if (duenio === o) o.docs.push(d); }
      else if (otras.length) o.extras.push(d);
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
    if (q) { pintarBusqueda(q); armarAbc(); return; }

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
    else if (ancho.matches) {
      // Lo abierto (desde la búsqueda, un link o al cambiar de vista) puede
      // quedar fuera de la columna: se la corre hasta mostrarlo.
      aLaVista($('ar-c1'), $('ar-c1').querySelector('.ar-fd[aria-current="true"]'));
      aLaVista($('ar-c2'), $('ar-c2').querySelector('.ar-r--oc[aria-current="true"]'));
    }
    if (st.oc) pedirCarpetas([ocs.get(st.oc)]);
    armarAbc();
  }

  // En la compu cada columna es sticky (posicionada): el offsetTop de lo de
  // adentro es contra la columna.
  function aLaVista(col, el) {
    if (!el) return;
    const top = el.offsetTop, alto = el.offsetHeight;
    if (top < col.scrollTop || top + alto > col.scrollTop + col.clientHeight)
      col.scrollTop = top - (col.clientHeight - alto) / 2;
  }

  // ---- Barra de letras (Por proveedor) ----
  // Es la barra de desplazamiento de la lista: el tirador marca lo que se ve,
  // cada letra está a la altura donde empieza su inicial (corridas lo justo
  // para que no se pisen) y se resalta la de lo que está arriba de todo.
  // Tocar una letra salta a ella; deslizar recorre la lista pasando por cada
  // letra justo cuando el dedo está encima.

  const letraDe = k => {
    const c = k.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  };

  // Compu: se desplaza la columna. Teléfono: la página (debajo del header).
  function desplazador() {
    if (ancho.matches) {
      const c = $('ar-c1');
      return { pos: el => el.offsetTop - 6, total: c.scrollHeight, vista: c.clientHeight, get: () => c.scrollTop, set: v => { c.scrollTop = v; } };
    }
    return { pos: el => el.getBoundingClientRect().top + scrollY - 72, total: document.documentElement.scrollHeight, vista: innerHeight,
      get: () => scrollY, set: v => scrollTo(0, v) };
  }

  let abc = null;   // { el, sc, H, max, th, an: [{ l, b, a, y }], activa }
  function armarAbc() {
    const el = $('ar-c1').querySelector('.ar-abc');
    const ve = !!el && !$('ar-cols').classList.contains('hidden') && getComputedStyle($('ar-c1')).display !== 'none';
    document.documentElement.classList.toggle('ar-sin-barra', ve && !ancho.matches);
    $('ar-c1').classList.toggle('ar-col--abc', ve);
    abc = null;
    if (!ve) return;
    if (ancho.matches) el.style.height = Math.max(0, $('ar-c1').clientHeight - 8) + 'px';
    const sc = desplazador(), H = el.clientHeight, max = Math.max(1, sc.total - sc.vista);
    const th = Math.min(H, Math.max(28, H * sc.vista / sc.total));
    const bs = [...el.querySelectorAll('[data-letra]')];
    const paso = Math.min(17, H / bs.length);
    const an = bs.map(b => {
      const a = Math.max(0, Math.min(max, sc.pos($('ar-c1').querySelector(`.ar-fd[data-ini="${b.dataset.letra}"]`))));
      return { l: b.dataset.letra, b, a, y: th / 2 + a / max * (H - th) };
    });
    an.forEach((x, i) => { x.y = Math.max(x.y, paso / 2, i ? an[i - 1].y + paso : 0); });
    for (let i = an.length - 1; i >= 0; i--) an[i].y = Math.min(an[i].y, i < an.length - 1 ? an[i + 1].y - paso : H - paso / 2);
    an.forEach(x => { x.b.style.top = (x.y - paso / 2) + 'px'; x.b.style.height = paso + 'px'; });
    el.querySelector('.ar-abc-th').style.height = th + 'px';
    abc = { el, sc, H, max, th, an, activa: '' };
    seguirAbc();
  }

  function seguirAbc() {
    if (!abc || !abc.el.isConnected) return;
    const s = abc.sc.get();
    abc.el.querySelector('.ar-abc-th').style.transform = `translateY(${Math.min(1, s / abc.max) * (abc.H - abc.th)}px)`;
    let act = abc.an[0];
    abc.an.forEach(x => { if (x.a <= s + 4) act = x; });
    if (act.l !== abc.activa) {
      abc.an.forEach(x => x.b.classList.toggle('on', x === act));
      abc.activa = act.l;
      const bu = abc.el.querySelector('.ar-abc-bu');
      bu.textContent = act.l;
      bu.style.top = act.y + 'px';
    }
  }

  // Altura en la barra → desplazamiento, por tramos entre las letras.
  function desplDeY(y) {
    const p = [{ y: 0, a: 0 }, ...abc.an, { y: abc.H, a: abc.max }];
    for (let i = 1; i < p.length; i++)
      if (y <= p[i].y) return p[i - 1].a + (p[i].a - p[i - 1].a) * (p[i].y > p[i - 1].y ? (y - p[i - 1].y) / (p[i].y - p[i - 1].y) : 1);
    return abc.max;
  }

  function irALetra(l) {
    const x = abc && abc.an.find(z => z.l === l);
    if (x) { abc.sc.set(x.a); seguirAbc(); }
  }

  function pintarMigas(f) {
    const p = [`<button type="button" data-nav="raiz">Archivo</button>`];
    if (f) p.push(st.oc ? `<button type="button" data-nav="f">${esc(nombreCarpeta(f, st.v))}</button>` : `<span>${esc(nombreCarpeta(f, st.v))}</span>`);
    if (st.oc) p.push(`<span>${esc('OC ' + ocs.get(st.oc).nro)}</span>`);
    $('ar-crumbs').innerHTML = p.join('<i>›</i>');
  }

  function nivel1(lista, f) {
    // Por proveedor, la barra de desplazamiento lleva las iniciales.
    const letras = [];
    const ini = st.v === 'prov' ? k => {
      if (k === 'Sin proveedor') return '';
      const c = letraDe(k);
      if (letras.includes(c)) return '';
      letras.push(c);
      return ` data-ini="${c}"`;
    } : () => '';
    const grid = lista.map(([k, l]) => {
      const inc = l.filter(incompleta).length;
      const n = l.reduce((s, o) => s + archivosDe(o).length, 0);
      return `<button type="button" class="ar-fd" data-f="${esc(k)}"${ini(k)} aria-current="${k === f}"><span class="ar-fd-ic">${icSvg(ICONO_DIM[st.v])}</span>
        <b>${esc(nombreCarpeta(k, st.v))}</b><small>${plural(l.length, 'OC', 'OC')} · ${plural(n, 'archivo', 'archivos')}</small>
        <em class="${inc ? '' : 'ok'}">${inc ? plural(inc, 'sin factura o remito', 'sin factura o remito') : 'Todo cargado'}</em></button>`;
    }).join('');
    // En el orden de la lista (los que empiezan con número van primero).
    const abc = letras.length > 1 ? `<div class="ar-abc-w"><nav class="ar-abc" aria-label="Ir a la letra"><span class="ar-abc-th"></span>${letras
      .map(c => `<button type="button" data-letra="${c}">${c}</button>`).join('')}<span class="ar-abc-bu" aria-hidden="true"></span></nav></div>` : '';
    return abc + `<div class="ar-lbl">${DIMS[st.v]}<i>${plural(lista.length, 'carpeta', 'carpetas')}</i></div>` +
      (lista.length ? `<div class="ar-fgrid${abc ? ' ar-fgrid--abc' : ''}">${grid}</div>` : `<div class="ar-ph">Todavía no hay OC.</div>`);
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
  // Sólo en la ficha, al lado de «Pendiente»: a quién se le pidió la firma.
  function etiquetaAutorizacion(o) {
    if (o.estado !== 'pendiente') return '';
    const quien = o.h.autorizacion && o.h.autorizacion.solicitadoA && o.h.autorizacion.solicitadoA.nombre;
    return `<span class="ar-est ar-est--pend">Esperando autorización${quien ? ' de ' + esc(quien) : ''}</span>`;
  }

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
      ${st.v === 'obra' ? entregaObra(f) : ''}
      <div class="ar-bar"><div class="ar-seg ar-seg--sm" role="group" aria-label="Ordenar OC">${opciones.map(([k, nom]) =>
        `<button type="button" data-orden="${k}" aria-pressed="${k === st.orden}">${nom}</button>`).join('')}</div>
        <button type="button" class="ar-tog" data-inc aria-pressed="${st.inc}">Sin factura o remito</button></div>
      ${vis.length ? `<div class="ar-rows">` + vis.map(o => {
        // Tres renglones: N° (con fecha y estado), proveedor, obra · quien la emitió.
        const sub = [o.obra || 'Sin obra', o.h.responsable && o.h.responsable.nombre].filter(Boolean).join(' · ');
        return `<button type="button" class="ar-r ar-r--oc" data-oc="${esc(o.id)}" aria-current="${o.id === st.oc}">
          <span class="ar-r-tx">
            <span class="ar-r-l1"><span class="ar-r-n">${esc(o.nro)}</span><span class="ar-r-f">${esc(fecha(o.ts))}</span>${etiquetaEstado(o)}</span>
            <b>${esc(o.prov || 'Sin proveedor')}</b><small>${esc(sub)}</small></span>
          ${dots(o)}${icSvg('chevron', 'ar-chev')}</button>`;
      }).join('') + `</div>` : `<div class="ar-ph">Todas las OC de esta carpeta tienen factura y remito.</div>`}
      ${l.length > limite ? `<button type="button" class="ar-mas" id="ar-mas">Ver ${Math.min(PAGINA, l.length - limite)} más</button>` : ''}
      ${vis.length ? leyenda : ''}`;
  }

  function itemHtml(a, conOC, asignable) {
    const [cls, lbl] = tile(a);
    const o = conOC && ocs.get(a.ocId);
    const meta = [o ? 'OC ' + o.nro : '', fecha(a.ts), a.size ? fmtPeso(a.size) : '', a.por].filter(Boolean).join(' · ');
    return `<div class="ar-item">
      <button type="button" class="ar-open" data-id="${esc(a.id)}" ${a.sinArchivo ? 'disabled title="Se cargó sin archivo"' : ''}>
        <span class="ar-tile ar-tile--${cls}">${esc(a.sinArchivo ? '—' : lbl)}</span>
        <span class="ar-r-tx"><b>${esc(a.nombre)}</b>
          <small><span class="ar-tipo ar-tipo--${esc(a.tipo)}">${esc(NOMBRE_TIPO[a.tipo] || 'Otro')}</span>${esc(a.sinArchivo ? 'sin archivo' : meta)}</small></span>
      </button>
      ${asignable ? `<button type="button" class="ar-asig" data-asignar="${esc(a.id)}">Es de esta OC</button>` : ''}
    </div>`;
  }

  // ---- Entregas: qué llegó y qué falta (PDF para mirar, Excel para trabajar) ----

  const ESTADO_ENT = { sin: 'Sin entregas', parcial: 'Entrega parcial', completa: 'Entregada' };
  const todosRemitos = () => [].concat(...Object.values(remitosOC));
  // Las OC de una obra que esperan entregas (las mismas que lista Remitos): las
  // anuladas, sólo si ya tienen remitos.
  const ocsDeObra = f => [...ocs.values()].filter(o => (o.obra || 'Sin obra') === f && !SIN_PDF.includes(o.estado) &&
    (o.estado !== 'anulada' || (remitosOC[o.nro] || []).length)).map(o => o.h);
  const esperaEntrega = o => (o.h.items || []).length && (!CERRADA.includes(o.estado) || (remitosOC[o.nro] || []).length);

  function tarjetaEntrega(e, titulo, sub) {
    const w = e.estado === 'sin' ? 0 : Math.max(4, Math.min(100, e.pct));
    return `<div class="ar-ent ar-ent--${e.estado}">
      <button type="button" class="ar-ent-ver" data-ent="pdf" title="Ver en PDF qué llegó y qué falta">
        <span class="ar-ent-tx"><b>${esc(titulo)}</b><small>${esc(sub)}</small></span>
        <span class="ar-ent-bar"><i style="width:${w}%"></i></span>
        <span class="ar-ent-cta">${icSvg('eye')}Ver</span>
      </button>
      <button type="button" class="ar-ent-xls" data-ent="xls" title="Descargar la planilla Excel">${icSvg('sheet')}Excel</button>
    </div>`;
  }

  function entregaOC(o) {
    if (!esperaEntrega(o) || typeof calcEntrega !== 'function') return '';
    const e = calcEntrega(o.h, remitosOC[o.nro] || []);
    const n = e.pedido.length, ok = e.pedido.filter((p, i) => e.recibido[i] >= p).length;
    const sub = e.estado === 'completa' ? `Llegó todo · ${plural(e.remitos.length, 'remito', 'remitos')}`
      : e.estado === 'sin' ? `Todavía no llegó nada (${plural(n, 'renglón', 'renglones')})`
      : `Faltan ${n - ok} de ${plural(n, 'renglón', 'renglones')} · ${plural(e.remitos.length, 'remito', 'remitos')}`;
    return `<div class="ar-lbl">Entrega</div>` + tarjetaEntrega(e, `${ESTADO_ENT[e.estado]} · ${e.pct}%`, sub);
  }

  function entregaObra(f) {
    if (typeof calcEntrega !== 'function') return '';
    const lista = ocsDeObra(f).filter(h => (h.items || []).length);
    if (!lista.length) return '';
    const es = lista.map(h => calcEntrega(h, remitosOC[h.nroOC] || []));
    const ped = es.reduce((s, e) => s + e.impPedido, 0), rec = es.reduce((s, e) => s + e.impRecib, 0);
    const pct = ped > 0 ? Math.round(rec / ped * 100) : Math.round(es.reduce((s, e) => s + e.pct, 0) / es.length);
    const pend = es.filter(e => e.estado !== 'completa').length;
    const estado = !pend ? 'completa' : es.some(e => e.estado !== 'sin') ? 'parcial' : 'sin';
    return tarjetaEntrega({ estado, pct }, `Control de entregas · ${pct}%`,
      pend ? `${pend} de ${plural(lista.length, 'OC', 'OC')} ${pend === 1 ? 'espera' : 'esperan'} material` : `Las ${plural(lista.length, 'OC', 'OC')} están entregadas`);
  }

  // El PDF se arma con lo que ya está cargado (no baja nada de Drive) y se
  // abre en el visor; el Excel se descarga.
  async function verEntrega(tipo) {
    const o = st.oc && ocs.get(st.oc);
    const cur = document.querySelector('.ar-fd[aria-current="true"]');
    const f = st.f || (cur ? cur.dataset.f : '');
    if (!o && !f) return;
    try {
      if (tipo === 'pdf') {
        const nombre = o ? nombreEntregasPdf.oc(o.h) : nombreEntregasPdf.obra(f);
        abrirArchivo({
          nombre,
          generar: async () => ({
            blob: o ? await entregasPdfOC(o.h, remitosOC[o.nro] || []) : await entregasPdfObra(f, ocsDeObra(f), todosRemitos()),
            nombre, mime: 'application/pdf'
          })
        });
      } else {
        const x = o ? await entregasExcelOC(o.h, remitosOC[o.nro] || []) : await entregasExcelObra(f, ocsDeObra(f), todosRemitos());
        descargar(x.blob, x.nombre);
      }
    } catch (e) {
      console.error('verEntrega:', e);
      toast('No se pudo armar el ' + (tipo === 'pdf' ? 'PDF' : 'Excel') + ' de entregas.', 'error');
    }
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
    // Lo de la carpeta compartida que no se sabe de qué OC es: plegado y fuera
    // de la lista, con la opción de asignarlo.
    const ext = o.extras && o.extras.length ? `<details class="ar-sinasig">
        <summary>${icSvg('info')}${plural(o.extras.length, 'archivo', 'archivos')} de la carpeta de Drive sin OC asignada</summary>
        <p class="ar-nota">La carpeta «${esc(fechaCarpeta(o))} | ${esc(o.prov || 'Sin proveedor')}» la comparte con ${o.compartida.length === 1 ? 'la OC' : 'las OC'} ${esc(o.compartida.join(', '))} y no se sabe de cuál es cada uno. Si alguno es de esta OC, asignáselo: pasa a su lista y deja de aparecer en las otras.</p>
        <div class="ar-rows">${o.extras.map(a => itemHtml(a, false, true)).join('')}</div>
      </details>` : '';
    const t = Number(o.h.total) || 0;
    const total = t ? (o.h.moneda === 'USD' ? 'US$ ' : '$ ') + t.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    const extra = [o.h.fecha || fecha(o.ts), total, o.h.responsable && o.h.responsable.nombre ? 'emitió ' + o.h.responsable.nombre : ''].filter(Boolean).join(' · ');
    const nArch = archivosDe(o).length;
    const peso = archivosDe(o).reduce((s, a) => s + (Number(a.size) || 0), 0);
    return `<div class="ar-fh"><h2>OC ${esc(o.nro)}${etiquetaEstado(o)}${etiquetaAutorizacion(o)}</h2>
        <p><b>${esc(o.prov || 'Sin proveedor')}</b> · ${esc(o.obra || 'Sin obra')}</p>
        <p>${esc(extra)}</p>
        <div class="ar-acts"><button type="button" class="ar-act" data-ficha="1">${icSvg('eye')}Ver ficha</button>
          <button type="button" class="ar-act" data-subir="otro">${icSvg('plus')}Agregar archivo</button>
          ${o.folder ? `<a class="ar-act" href="https://drive.google.com/drive/folders/${esc(o.folder)}" target="_blank" rel="noopener">${icSvg('drive')}Carpeta en Drive</a>` : ''}</div></div>
      <div class="ar-lbl">${plural(nArch, 'archivo', 'archivos')}<i>${peso ? fmtPeso(peso) : ''}</i></div>
      <div class="ar-rows">${h}</div>
      ${entregaOC(o)}${ext}
      ${c && c.error ? `<p class="ar-nota">No se pudo mirar la carpeta en Drive: el PDF y el presupuesto pueden estar y no figurar.</p>` : ''}`;
  }

  // ---- Ficha de la OC ----
  // La misma del Historial (js/fichaOC.js), también para las pendientes: muestra
  // lo cargado, sin PDF.
  function abrirFicha() {
    const o = ocs.get(st.oc);
    if (!o) return;
    const data = ocDataFromRecord(o.h);
    const resp = o.h.responsable && o.h.responsable.nombre ? `<span class="foc-chip">${esc(o.h.responsable.nombre)}</span>` : '';
    const todas = Object.values(historial).filter(h => h && h.nroOC).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const cmp = checkOCHistorial(data, todas, o.h.timestamp);
    pintarFichaOC(data, estadoChipFicha(o.h) + resp, fichaInfoHtml(cmp.info) + comparacionHtml(cmp.cambios));
    $('modal-preview').classList.remove('hidden');
  }
  function cerrarFicha() {
    $('modal-preview').classList.add('hidden');
    $('preview-body').innerHTML = '';
  }
  const fichaAbierta = () => !$('modal-preview').classList.contains('hidden');

  // Día con el que se nombró la carpeta de Drive de la OC (UTC, como al emitirla).
  const fechaCarpeta = o => new Date(o.ts || Date.now()).toISOString().slice(0, 10);

  function textoOC(o) {
    return ['oc ' + o.nro, o.nro, o.prov, o.obra].join(' ').toLowerCase();
  }

  const articulosDe = o => [...new Set((o.h.items || []).map(it => it && it.desc).filter(Boolean))];

  function pintarBusqueda(q) {
    const terms = q.split(/\s+/).filter(Boolean);
    const hay = txt => terms.every(t => txt.includes(t));
    const t0 = terms[0];
    // Proveedores y obras que coinciden: llevan a su carpeta.
    const MAX_CARP = 6;
    const grupos = [['prov', 'Proveedores'], ['obra', 'Obras']]
      .map(([v, n]) => [v, n, carpetas(v).filter(([k]) => !k.startsWith('Sin ') && hay(k.toLowerCase()))])
      .filter(([, , l]) => l.length);
    const res = [];
    ocs.forEach(o => {
      const base = textoOC(o);
      if (hay(base)) { res.push({ o, files: [], arts: [] }); return; }
      const files = archivosDe(o).filter(a => hay(base + ' ' + (a.nombre || '').toLowerCase() + ' ' + (NOMBRE_TIPO[a.tipo] || '').toLowerCase()));
      const arts = articulosDe(o).filter(d => hay(base + ' ' + d.toLowerCase()));
      if (files.length || arts.length) res.push({ o, files, arts });
    });
    res.sort((a, b) => b.o.ts - a.o.ts);
    if (!res.length && !grupos.length) {
      $('ar-res').innerHTML = `<div class="ar-vacio">${icSvg('search')}<span>No hay nada que coincida.</span></div>`;
      return;
    }
    const carps = grupos.map(([v, n, l]) => `<div class="ar-lbl">${n}<i>${l.length > MAX_CARP ? 'las primeras ' + MAX_CARP + ' de ' + l.length : ''}</i></div><div class="ar-rows">` +
      l.slice(0, MAX_CARP).map(([k, ls]) => `<button type="button" class="ar-r" data-ir-v="${v}" data-ir-f="${esc(k)}">
        <span class="ar-fd-ic">${icSvg(ICONO_DIM[v])}</span>
        <span class="ar-r-tx"><b>${resaltar(k, t0)}</b><small>${plural(ls.length, 'OC', 'OC')} · ${plural(ls.reduce((s, o) => s + archivosDe(o).length, 0), 'archivo', 'archivos')}</small></span>
        ${icSvg('chevron', 'ar-chev')}</button>`).join('') + `</div>`).join('');
    $('ar-res').innerHTML = carps + (res.length ? `<div class="ar-lbl">${plural(res.length, 'OC', 'OC')}</div><div class="ar-rows">` + res.slice(0, limite).map(({ o, files, arts }) => {
      const camino = nombreCarpeta(claveOC(o, st.v), st.v) + ' › OC ' + o.nro;
      const det = [...files.map(a => resaltar(a.nombre, t0)), ...arts.map(d => resaltar(d, t0))];
      return `<button type="button" class="ar-r" data-ir-oc="${esc(o.id)}">
        <span class="ar-r-n">${resaltar(o.nro, t0)}</span>
        <span class="ar-r-tx"><b>${resaltar(o.prov || '—', t0)}</b>
          <small>${det.length ? det.join(', ') : esc(camino) + (o.obra && st.v !== 'obra' ? ' · ' + resaltar(o.obra, t0) : '')}</small></span>
        ${dots(o)}${icSvg('chevron', 'ar-chev')}</button>`;
    }).join('') + `</div>` : '') +
      (res.length > limite ? `<button type="button" class="ar-mas" id="ar-mas">Ver ${Math.min(PAGINA, res.length - limite)} más</button>` : '');
  }

  function pintarUso() {
    let n = 0;
    ocs.forEach(o => { n += archivosDe(o).length; });
    $('ar-uso').textContent = `${plural(ocs.size, 'OC', 'OC')} · ${plural(n, 'archivo', 'archivos')}`;
  }

  // ---- Subir a la OC abierta ----
  // Un archivo de la carpeta compartida pasa a ser de la OC abierta: se anota
  // como adjunto, igual que lo que se sube desde acá.
  async function asignar(id) {
    const o = ocs.get(st.oc), a = docsReg.get(id);
    if (!o || !a || !a.fileId) return;
    const registro = { tipo: tipoPorNombre(a.nombre) === 'factura' ? 'factura' : 'otro', nombre: a.nombre,
      ts: a.ts || Date.now(), por: nombreUsuario, fileId: a.fileId, folderId: a.folderId || o.folder };
    try {
      await registrarAdjuntoOC(o.nro, registro);
    } catch (e) {
      console.error('asignar:', e);
      toast('No se pudo asignar el archivo. Revisá la conexión.', 'error');
      return;
    }
    o.h.adjuntos = o.h.adjuntos || {};
    o.h.adjuntos['local_' + Date.now()] = registro;
    armar(); pintarUso(); pintar(true);
    toast('Listo: el archivo quedó en la OC ' + o.nro + '.', 'success');
  }

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

  // ── Zoom del visor ──
  // z = 1 es «ajustado»: la imagen o cada página del PDF entera a la vista. Cada item es
  // { el, w, h, max? } con el tamaño natural; acá se le fija el tamaño en pantalla (it.k = escala).
  const Z_MIN = 1, Z_MAX = 6;
  function zoomVisor(est, items, alCambiar) {
    const $c = est.el.querySelector('.vis-c');
    const cs = getComputedStyle($c);
    const padW = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padH = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const bar = document.createElement('div');
    bar.className = 'vis-zm';
    bar.innerHTML = `<button type="button" data-z="-" aria-label="Alejar">−</button>`
      + `<button type="button" data-z="0" title="Ajustar a la pantalla">100%</button>`
      + `<button type="button" data-z="+" aria-label="Acercar">+</button>`;
    est.el.appendChild(bar);
    const [bMenos, bAjustar, bMas] = bar.querySelectorAll('button');
    let z = 1;

    function aplicar() {
      const cw = $c.clientWidth - padW, ch = $c.clientHeight - padH;
      items.forEach(it => {
        it.fit = Math.min(cw / it.w, ch / it.h, it.max || Infinity);
        it.k = it.fit * z;
        it.el.style.width  = Math.round(it.w * it.k) + 'px';
        it.el.style.height = Math.round(it.h * it.k) + 'px';
      });
      bAjustar.textContent = Math.round(z * 100) + '%';
      bMenos.disabled = z <= Z_MIN + 0.001;
      bMas.disabled = z >= Z_MAX - 0.001;
      if (alCambiar) alCambiar.luego();
    }
    // Cambia el zoom dejando quieto el punto (cx, cy) de la pantalla, relativo a $c.
    function fijar(nz, cx = $c.clientWidth / 2, cy = $c.clientHeight / 2, desde) {
      const p = desde || { x: ($c.scrollLeft + cx) / z, y: ($c.scrollTop + cy) / z };
      z = Math.min(Z_MAX, Math.max(Z_MIN, nz));
      aplicar();
      $c.scrollLeft = p.x * z - cx;
      $c.scrollTop  = p.y * z - cy;
    }
    const rel = (x, y) => { const r = $c.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
    const alternar = (x, y) => { const q = rel(x, y); fijar(z > 1.05 ? 1 : 2.5, q.x, q.y); };

    bMenos.onclick = () => fijar(z / 1.5);
    bMas.onclick = () => fijar(z * 1.5);
    bAjustar.onclick = () => fijar(1);

    // Ctrl + rueda (también el pellizco del touchpad) hace zoom; la rueda sola scrollea.
    $c.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const q = rel(e.clientX, e.clientY);
      fijar(z * Math.exp(-e.deltaY * 0.01), q.x, q.y);
    }, { passive: false });

    // Pellizco con dos dedos y doble toque.
    let pinza = null, toque = null, ultimoToque = 0;
    const medio = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    $c.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const m = rel(medio(e.touches).x, medio(e.touches).y);
        pinza = { d: dist(e.touches), z, p: { x: ($c.scrollLeft + m.x) / z, y: ($c.scrollTop + m.y) / z } };
        toque = null;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        toque = { x: t.clientX, y: t.clientY, movido: false };
      }
    }, { passive: true });
    $c.addEventListener('touchmove', e => {
      if (pinza && e.touches.length === 2) {
        e.preventDefault();
        const m = medio(e.touches), q = rel(m.x, m.y);
        fijar(pinza.z * dist(e.touches) / pinza.d, q.x, q.y, pinza.p);
      } else if (toque) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - toque.x, t.clientY - toque.y) > 10) toque.movido = true;
      }
    }, { passive: false });
    $c.addEventListener('touchend', e => {
      if (e.touches.length < 2) pinza = null;
      // Deslizar de costado sin zoom pasa al archivo anterior o al siguiente.
      if (!e.touches.length && toque && toque.movido && est.ir && z <= 1.05 && e.changedTouches.length) {
        const t = e.changedTouches[0], dx = t.clientX - toque.x, dy = t.clientY - toque.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) { toque = null; est.ir(dx < 0 ? 1 : -1); return; }
      }
      if (e.touches.length || !toque || toque.movido) { if (!e.touches.length) toque = null; return; }
      const ahora = Date.now();
      if (ahora - ultimoToque < 300) { e.preventDefault(); alternar(toque.x, toque.y); ultimoToque = 0; }
      else ultimoToque = ahora;
      est.ultimoTouch = ahora;
      toque = null;
    }, { passive: false });
    $c.addEventListener('dblclick', e => {
      if (Date.now() - (est.ultimoTouch || 0) < 800) return;   // ya lo manejó el doble toque
      alternar(e.clientX, e.clientY);
    });

    const alRedimensionar = () => fijar(z);
    window.addEventListener('resize', alRedimensionar);
    est.off.push(() => window.removeEventListener('resize', alRedimensionar));
    est.zoom = { mas: () => fijar(z * 1.5), menos: () => fijar(z / 1.5), ajustar: () => fijar(1), z: () => z };
    aplicar();
  }

  // Dibuja las páginas del PDF: las que están cerca de la vista a la resolución del zoom, el
  // resto a la de «ajustado» (para no llenar la memoria con 20 páginas a 6×).
  function pintorPdf(est, pags) {
    const $c = est.el.querySelector('.vis-c');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Tope de píxeles por canvas: iOS no dibuja canvas de más de ~16 M px.
    const escala = (it, k) => Math.min(k * dpr, Math.sqrt(12e6 / (it.w * it.h)));
    async function pintar(it, s) {
      it.s = s;
      if (it.tarea) it.tarea.cancel();
      const vp = it.pag.getViewport({ scale: s });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const t = it.tarea = it.pag.render({ canvasContext: cv.getContext('2d'), viewport: vp });
      try { await t.promise; } catch (_) { return; }   // cancelada por un zoom más nuevo
      if (it.tarea !== t || _abierto !== est) return;
      it.tarea = null;
      const viejo = it.el.firstChild;
      it.el.replaceChildren(cv);
      if (viejo) viejo.width = viejo.height = 0;      // libera la memoria del canvas anterior
    }
    let corriendo = false, otraVez = false;
    async function afinar() {
      if (corriendo) { otraVez = true; return; }
      corriendo = true;
      try {
        do {
          otraVez = false;
          const r = $c.getBoundingClientRect();
          const cerca = it => {
            const b = it.el.getBoundingClientRect();
            return b.bottom > r.top - r.height && b.top < r.bottom + r.height;
          };
          // Primero las que se ven, después el resto.
          const orden = [...pags.filter(cerca), ...pags.filter(it => !cerca(it))];
          for (const it of orden) {
            if (_abierto !== est || otraVez) break;
            const quiero = escala(it, cerca(it) ? it.k : it.fit);
            if (!it.s || Math.abs(quiero - it.s) / it.s > 0.15) await pintar(it, quiero);
          }
        } while (otraVez && _abierto === est);
      } finally { corriendo = false; }
    }
    let timer = 0;
    afinar.luego = () => { clearTimeout(timer); timer = setTimeout(afinar, 180); };
    est.off.push(() => { clearTimeout(timer); pags.forEach(it => it.tarea && it.tarea.cancel()); });
    return afinar;
  }

  // ── Imprimir ──
  // Se imprimen imágenes (imprimirImagenes, en ui.js): el PDF se vuelve a dibujar
  // página por página a ~180 dpi, aparte de lo que se ve en pantalla.
  async function paginasParaImprimir(est, pags) {
    const out = [];
    for (const it of pags) {
      if (_abierto !== est) return null;
      const s = Math.min(2.5, Math.sqrt(12e6 / (it.w * it.h)));
      const vp = it.pag.getViewport({ scale: s });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await it.pag.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92)));
      cv.width = cv.height = 0;
    }
    return out;
  }

  function botonImprimir(est, fuentes, opts) {
    const b = est.el.querySelector('[data-a="print"]');
    b.classList.remove('hidden');
    b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        const f = await fuentes();
        if (f && _abierto === est) await imprimirImagenes(f, opts);
      } catch (e) {
        console.error('imprimir:', e);
        toast('No se pudo preparar la impresión.', 'error');
      } finally { b.disabled = false; }
    };
  }

  const _bajados = new Map();   // fileId → { blob, nombre, mime } mientras la página esté abierta
  let _abierto = null;

  // La pastilla grande del visor: qué es el archivo.
  const TIPO_VISOR = { oc: 'Orden de Compra', presupuesto: 'Presupuesto', factura: 'Factura', remito: 'Remito', planilla: 'Planilla', otro: 'Otro archivo' };
  // Los archivos de la OC que se recorren con las flechas, en el orden de nivel3.
  function navegables(o) {
    const ver = a => !a.noEsta && !a.sinArchivo;
    return [...DOCS.flatMap(([t]) => o.docs.filter(a => a.tipo === t && ver(a))),
      ...o.docs.filter(a => ver(a) && !DOCS.some(([t]) => t === a.tipo))];
  }

  async function abrirArchivo(d) {
    if (!d || d.sinArchivo) return;
    // Pasar de un archivo a otro con las flechas reusa la entrada del historial:
    // el botón Atrás cierra el visor de una, no archivo por archivo.
    const heredaHistoria = !!(_abierto && _abierto.conHistoria);
    if (heredaHistoria) _abierto.conHistoria = false;
    cerrarVisor(true);
    const o = d.ocId && ocs.get(d.ocId);
    const lista = o && !d.generar ? navegables(o) : [];
    const pos = lista.findIndex(a => a.id === d.id);
    const cuenta = pos >= 0 && lista.length > 1 ? (pos + 1) + ' de ' + lista.length : '';
    const tipo = TIPO_VISOR[d.tipo];
    const el = document.createElement('div');
    el.className = 'vis';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `
      <div class="vis-hd">
        ${tipo ? `<span class="vis-tipo vis-tipo--${esc(d.tipo)}">${esc(tipo)}</span>` : ''}
        <div class="vis-t"><b>${esc(d.nombre)}</b><span>${esc(cuenta)}</span></div>
        <button type="button" class="vis-b hidden" data-a="print" title="Imprimir" aria-label="Imprimir">${icSvg('print')}</button>
        <button type="button" class="vis-b hidden" data-a="share" title="Compartir" aria-label="Compartir">${icSvg('share')}</button>
        <button type="button" class="vis-b hidden" data-a="down" title="Descargar" aria-label="Descargar"><svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        <a class="vis-b hidden" data-a="drive" target="_blank" rel="noopener" title="Abrir en Drive" aria-label="Abrir en Drive">${icSvg('drive')}</a>
        <button type="button" class="vis-b" data-a="x" title="Cerrar" aria-label="Cerrar">${icSvg('x')}</button>
      </div>
      <div class="vis-c"><div class="vis-msg"><span>Abriendo…</span><div class="vis-bar"><i></i></div></div></div>
      ${cuenta ? `
      <button type="button" class="vis-nav vis-nav--prev" data-a="prev" title="Archivo anterior" aria-label="Archivo anterior" ${pos ? '' : 'disabled'}>${icSvg('chevL')}</button>
      <button type="button" class="vis-nav vis-nav--next" data-a="next" title="Archivo siguiente" aria-label="Archivo siguiente" ${pos < lista.length - 1 ? '' : 'disabled'}>${icSvg('chevR')}</button>` : ''}`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    const est = { el, urls: [], off: [] };
    _abierto = est;
    if (heredaHistoria) est.conHistoria = true;
    else { try { history.pushState({ visor: 1, archivo: 1 }, ''); est.conHistoria = true; } catch (_) {} }
    // Las flechas (también ← → y deslizar de costado) pasan al anterior o al siguiente.
    if (cuenta) {
      est.ir = paso => { const otro = lista[pos + paso]; if (otro) abrirArchivo(otro); };
      el.querySelector('[data-a="prev"]').onclick = () => est.ir(-1);
      el.querySelector('[data-a="next"]').onclick = () => est.ir(1);
    }

    const $t = el.querySelector('.vis-t'), $c = el.querySelector('.vis-c');
    el.querySelector('[data-a="x"]').onclick = () => cerrarVisor();
    const bDrive = el.querySelector('[data-a="drive"]');
    try {
      let x;
      // `generar`: un PDF armado al momento (el control de entregas), no está en Drive.
      if (d.generar) x = await d.generar();
      else {
        // Los archivos viejos sólo tienen carpeta y nombre: se lo busca.
        if (!d.fileId && d.folderId && d.nombre) d.fileId = await findFileInFolder(d.folderId, d.nombre);
        if (!d.fileId) throw new Error('no existe');
        bDrive.href = `https://drive.google.com/file/d/${d.fileId}/view`;
        bDrive.classList.remove('hidden');

        x = _bajados.get(d.fileId);
        if (!x) { x = await bajarDriveArchivo(d.fileId); if (!x.nativo) _bajados.set(d.fileId, x); }
      }
      if (_abierto !== est) return;
      $t.querySelector('b').textContent = x.nombre;
      if (x.nativo) {
        $c.innerHTML = `<div class="vis-msg"><span>Es un documento de Google: se abre en Drive.</span>
          <a class="vis-dl" href="${esc(bDrive.href)}" target="_blank" rel="noopener">Abrir en Drive</a></div>`;
        return;
      }
      const { blob, nombre, mime } = x;
      $t.querySelector('span').textContent = [cuenta, fmtPeso(blob.size)].filter(Boolean).join(' · ');
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
        const img = new Image();
        img.alt = nombre; img.draggable = false; img.src = u;
        try { await img.decode(); } catch (_) {}
        if (_abierto !== est) return;
        $c.replaceChildren(img);
        // max: una imagen chica no se agranda más que su tamaño real al ajustar.
        zoomVisor(est, [{ el: img, w: img.naturalWidth || 1, h: img.naturalHeight || 1, max: 1 }]);
        botonImprimir(est, async () => [blob], { margen: '10mm', titulo: nombre });
      } else if (mime === 'application/pdf') {
        const pdfjs = await cargarPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (_abierto !== est) return;
        const pags = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const pag = await doc.getPage(n);
          if (_abierto !== est) return;
          const vp0 = pag.getViewport({ scale: 1 });
          const div = document.createElement('div');
          div.className = 'vis-p';
          pags.push({ el: div, w: vp0.width, h: vp0.height, pag });
        }
        $c.replaceChildren(...pags.map(p => p.el));
        const afinar = pintorPdf(est, pags);
        zoomVisor(est, pags, afinar);
        $c.addEventListener('scroll', afinar.luego, { passive: true });
        afinar();
        // Sin margen: el PDF ya trae los suyos.
        botonImprimir(est, () => paginasParaImprimir(est, pags), { titulo: nombre });
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
    e.off.forEach(f => f());
    e.urls.forEach(u => URL.revokeObjectURL(u));
    e.el.remove();
    document.body.style.overflow = '';
    if (e.conHistoria && !sinHistoria) { try { history.back(); } catch (_) {} }
  }
  document.addEventListener('keydown', e => {
    if (!_abierto) return;
    if (e.key === 'Escape') return cerrarVisor();
    // Ctrl+P imprime el archivo, no la página de atrás.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      const b = _abierto.el.querySelector('[data-a="print"]');
      if (!b.classList.contains('hidden')) b.click();
      return;
    }
    if (_abierto.ir && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      // Con zoom, las flechas mueven la imagen, como siempre.
      if (!_abierto.zoom || _abierto.zoom.z() <= 1.05) { e.preventDefault(); _abierto.ir(e.key === 'ArrowLeft' ? -1 : 1); }
      return;
    }
    const zm = _abierto.zoom;
    if (!zm || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') zm.mas();
    else if (e.key === '-') zm.menos();
    else if (e.key === '0') zm.ajustar();
  });

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
      else if (d.irF) { $('ar-q').value = ''; ir({ v: d.irV, f: d.irF, oc: '' }); }
      else if (d.letra) irALetra(d.letra);
      else if (d.orden) { st.orden = d.orden; pintar(); }
      else if ('inc' in d) { st.inc = !st.inc; pintar(); }
      else if (d.ficha) abrirFicha();
      else if (d.subir) elegirArchivo(d.subir);
      else if (d.ent) verEntrega(d.ent);
      else if (d.asignar) asignar(d.asignar);
      else if (t.id === 'ar-mas') { limite += PAGINA; pintar(); }
    });
    // Arrastrar por la barra de letras (dedo o mouse) recorre la lista.
    $('ar-c1').addEventListener('pointerdown', e => {
      const el = e.target.closest('.ar-abc'); if (!el || !abc) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('arrastra');
      // El tamaño en pantalla puede no ser el de CSS (zoom en monitores grandes).
      const mover = ev => { const r = el.getBoundingClientRect(); abc.sc.set(desplDeY((ev.clientY - r.top) * abc.H / r.height)); seguirAbc(); };
      const letra = e.target.closest('[data-letra]');
      if (letra) irALetra(letra.dataset.letra); else mover(e);
      const fin = () => {
        el.classList.remove('arrastra');
        el.removeEventListener('pointermove', mover); el.removeEventListener('pointerup', fin); el.removeEventListener('pointercancel', fin);
      };
      el.addEventListener('pointermove', mover);
      el.addEventListener('pointerup', fin);
      el.addEventListener('pointercancel', fin);
    });
    const alDesplazar = () => requestAnimationFrame(seguirAbc);
    $('ar-c1').addEventListener('scroll', alDesplazar, { passive: true });
    window.addEventListener('scroll', alDesplazar, { passive: true });
    window.addEventListener('resize', () => armarAbc());
    if (document.fonts) document.fonts.ready.then(() => armarAbc());
    $('ar-file').addEventListener('change', e => subir(e.target.files && e.target.files[0]));
    $('modal-preview-close').addEventListener('click', cerrarFicha);
    $('modal-preview').addEventListener('click', e => { if (e.target.id === 'modal-preview') cerrarFicha(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !_abierto && fichaAbierta()) cerrarFicha(); });
    window.addEventListener('popstate', () => {
      if (_abierto) { _abierto.conHistoria = false; cerrarVisor(); return; }
      leerUrl(); pintar();
    });
    ancho.addEventListener('change', () => pintar());
  }

  iniciar();
})();
