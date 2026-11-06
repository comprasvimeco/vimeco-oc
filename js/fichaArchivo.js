/* Pastilla del archivo elegido y su ficha — la misma en la OC (presupuesto), Facturas y Remitos.
   El archivo elegido se muestra como una pastilla del color de lo que es («Presupuesto»,
   «Factura», «Remito») con el tipo de archivo; al tocarla abre una ficha (hoja desde abajo en el
   teléfono, centrada en escritorio) con la vista previa como un papel, que abre el visor, el
   nombre, el tipo y el peso, y Abrir / Recortar / Quitar. Se cierra con la X, tocando afuera o
   con Escape (con el visor abierto, Escape cierra sólo el visor).
   Traída de Leva (v305–v315). Trae su propio visor (foto o PDF a pantalla completa) y carga
   pdf.js a demanda. Los estilos, en styles.css (.pa-* y .pa-vis-*).

     const p = pastillaArchivo(contenedor, { tipo, etiqueta, onRecortar, onQuitar });
     p.mostrar(file, { recortar })   la pastilla con ese archivo (recortar: se ve el botón)
     p.limpiar()                     sin archivo: oculta la pastilla y cierra la ficha
     p.tipo('factura', 'Factura')    cambia el color y lo que dice
     p.cerrar()                      cierra la ficha
     p.abrir()                       abre el archivo en el visor

   Tipos: presupuesto, factura, remito, otro (el color de cada cosa en toda la app). */
(function () {
  const IC = {
    doc:   '<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
    chev:  '<svg class="icon pa-pill-chev" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>',
    x:     '<svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    ojo:   '<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    abrir: '<svg class="icon" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/></svg>',
    rec:   '<svg class="icon" viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 002 2h14"/><path d="M18 22V8a2 2 0 00-2-2H2"/></svg>',
    bajar: '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    tacho: '<svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>'
  };
  const TIPOS = ['presupuesto', 'factura', 'remito', 'otro'];

  const extDe = f => ((f.name.match(/\.(\w+)$/) || [])[1] || (f.type.split('/')[1] || '')).replace(/^jpeg$/i, 'jpg').toUpperCase();
  const mimeDe = f => f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf'
    : /\.png$/i.test(f.name) ? 'image/png' : /\.webp$/i.test(f.name) ? 'image/webp' : /\.jpe?g$/i.test(f.name) ? 'image/jpeg' : '');
  const peso = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1).replace('.', ',') + ' MB';

  // ---- pdf.js y visor propios ----
  // En Leva la ficha usa el visor de toda la app (archivos.js); en VIMECO el visor de Archivo
  // vive dentro de archivo.js, así que acá va uno chico: foto o PDF a pantalla completa
  // (pdf.js, porque ni Chrome de Android ni iOS muestran bien un PDF en un iframe).
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let _pdfjs = null;
  function cargarPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
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

  let visor = null, visorUrl = null, visorHist = false;
  const visorAbierto = () => !!(visor && !visor.classList.contains('hidden'));
  function cerrarVisor(desdeHistoria) {
    if (!visorAbierto()) return;
    visor.classList.add('hidden');
    visor.querySelector('.pa-vis-body').replaceChildren();
    if (visorUrl) { URL.revokeObjectURL(visorUrl); visorUrl = null; }
    document.body.style.overflow = '';
    if (visorHist && !desdeHistoria) { visorHist = false; history.back(); }
    visorHist = false;
  }
  async function abrirVisor(f, etiqueta) {
    if (!visor) {
      visor = document.createElement('div');
      visor.className = 'pa-vis hidden';
      visor.setAttribute('role', 'dialog');
      visor.setAttribute('aria-modal', 'true');
      visor.innerHTML = `<div class="pa-vis-hd"><span class="pa-vis-t"></span>
          <button type="button" class="pa-vis-btn" data-a="bajar" title="Descargar">${IC.bajar}</button>
          <button type="button" class="pa-vis-btn" data-a="cerrar" title="Cerrar" aria-label="Cerrar">${IC.x}</button></div>
        <div class="pa-vis-body"></div>`;
      document.body.appendChild(visor);
      visor.querySelector('[data-a="cerrar"]').addEventListener('click', () => cerrarVisor());
      visor.querySelector('[data-a="bajar"]').addEventListener('click', () => {
        const f2 = visor._file;
        if (!f2) return;
        const u = URL.createObjectURL(f2), a = document.createElement('a');
        a.href = u; a.download = f2.name || 'archivo';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(u), 1000);
      });
      window.addEventListener('popstate', () => { if (visorHist) { visorHist = false; cerrarVisor(true); } });
    }
    visor._file = f;
    visor.querySelector('.pa-vis-t').textContent = etiqueta + ' · ' + f.name;
    const body = visor.querySelector('.pa-vis-body');
    body.replaceChildren(Object.assign(document.createElement('span'), { className: 'spinner pa-vis-spin' }));
    visor.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    // El botón Atrás del teléfono cierra el visor, no la pantalla.
    try { history.pushState({ paVisor: 1 }, ''); visorHist = true; } catch (_) {}
    const nada = msg => body.replaceChildren(Object.assign(document.createElement('div'), { className: 'pa-vis-nada', textContent: msg }));
    try {
      if (mimeDe(f).startsWith('image/')) {
        visorUrl = URL.createObjectURL(f);
        const img = new Image();
        img.alt = f.name; img.src = visorUrl; img.className = 'pa-vis-img';
        await img.decode().catch(() => {});
        if (visor._file === f) body.replaceChildren(img);
      } else if (mimeDe(f) === 'application/pdf') {
        const pdfjs = await cargarPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        if (visor._file !== f) return;
        body.replaceChildren();
        const ancho = Math.min(1100, body.clientWidth - 16) * Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= doc.numPages && visor._file === f && visorAbierto(); i++) {
          const pag = await doc.getPage(i);
          const vp = pag.getViewport({ scale: ancho / pag.getViewport({ scale: 1 }).width });
          const cv = document.createElement('canvas');
          cv.className = 'pa-vis-pag';
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          body.appendChild(cv);
          await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        }
      } else {
        nada('Sin vista previa para este tipo de archivo. Bajalo con el botón de arriba.');
      }
    } catch (e) {
      console.warn('visor del archivo:', e);
      if (visor._file === f) nada('No se pudo mostrar el archivo. Bajalo con el botón de arriba.');
    }
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && visorAbierto()) { e.stopImmediatePropagation(); cerrarVisor(); }
  }, true);


  window.pastillaArchivo = function (contenedor, op) {
    op = op || {};
    let file = null, tipoK = op.tipo || 'otro', etiqueta = op.etiqueta || 'Archivo';
    let miniDe = null, miniUrl = null;

    contenedor.classList.add('pa-adj', 'hidden');
    contenedor.innerHTML = `<button type="button" class="pa-pill" aria-haspopup="dialog">
      <span class="pa-pill-ic">${IC.doc}</span><span class="pa-pill-t"></span><span class="pa-pill-ext"></span>${IC.chev}</button>`;
    const pill = contenedor.querySelector('.pa-pill');

    const ov = document.createElement('div');
    ov.className = 'modal-overlay pa-ov hidden';
    ov.innerHTML = `<div class="pa-ficha" role="dialog" aria-modal="true">
      <div class="pa-grip" title="Deslizá hacia abajo para cerrar"><i></i></div>
      <div class="pa-ficha-hd"><span class="pa-ficha-tipo">${IC.doc}<span></span></span>
        <button type="button" class="pa-ficha-x" title="Cerrar" aria-label="Cerrar">${IC.x}</button></div>
      <button type="button" class="pa-thumb"><span class="pa-hoja"></span><span class="pa-thumb-ver">${IC.ojo}Tocá para abrir</span></button>
      <div class="pa-info"><span class="pa-name"></span><span class="pa-meta"><span class="pa-chip"></span><span class="pa-peso"></span></span></div>
      <div class="pa-acc">
        <button type="button" class="pa-btn pa-btn--main" data-a="abrir">${IC.abrir}Abrir</button>
        <button type="button" class="pa-btn hidden" data-a="recortar" title="Volver a recortar la foto">${IC.rec}Recortar</button>
        <button type="button" class="pa-btn pa-btn--quitar" data-a="quitar" title="Quitar el archivo">${IC.tacho}Quitar</button>
      </div></div>`;
    document.body.appendChild(ov);
    const q = s => ov.querySelector(s);
    const hoja = q('.pa-hoja');

    function pintarTipo() {
      TIPOS.forEach(t => { pill.classList.toggle('pa--' + t, t === tipoK); ov.classList.toggle('pa--' + t, t === tipoK); });
      contenedor.querySelector('.pa-pill-t').textContent = etiqueta;
      q('.pa-ficha-tipo span').textContent = etiqueta;
      const art = { presupuesto: 'el presupuesto', factura: 'la factura', remito: 'el remito' }[tipoK] || 'el archivo';
      pill.title = 'Ver ' + art;
      q('.pa-thumb').title = 'Abrir ' + art;
      q('.pa-thumb').setAttribute('aria-label', 'Abrir ' + art);
    }

    function ficha(abrir) {
      ov.classList.toggle('hidden', !abrir || !file);
      if (!abrir) q('.pa-ficha').style.animation = '';
      if (abrir && file) miniatura(file);
    }

    // Dibuja la miniatura una vez por archivo; con null la borra.
    async function miniatura(f) {
      const ph = msg => { hoja.style.aspectRatio = ''; hoja.classList.remove('pa-hoja--ancha'); hoja.replaceChildren(Object.assign(document.createElement('span'), { className: 'pa-thumb-ph', textContent: msg })); };
      // La hoja toma la forma del archivo (una foto apaisada no queda en un papel vertical).
      const mostrar = (el, w, h) => {
        if (miniDe !== f) return;
        const caja = hoja.parentNode, cs = getComputedStyle(caja);
        const cw = caja.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const ch = caja.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        hoja.style.aspectRatio = w && h ? w + ' / ' + h : '';
        hoja.classList.toggle('pa-hoja--ancha', !!(w && h && ch > 0 && w / h > cw / ch));   // más apaisada que la caja: manda el ancho
        hoja.replaceChildren(el);
      };
      if (!f) {
        miniDe = null;
        if (miniUrl) { URL.revokeObjectURL(miniUrl); miniUrl = null; }
        ph('');
        hoja.firstChild.innerHTML = '<span class="spinner" role="status" aria-label="Cargando la vista previa"></span>';
        return;
      }
      if (miniDe === f) return;
      miniDe = f;
      try {
        if (mimeDe(f).startsWith('image/')) {
          if (miniUrl) URL.revokeObjectURL(miniUrl);
          miniUrl = URL.createObjectURL(f);
          const img = new Image();
          img.alt = ''; img.src = miniUrl;
          await img.decode().catch(() => {});
          mostrar(img, img.naturalWidth, img.naturalHeight);
        } else if (mimeDe(f) !== 'application/pdf') {
          ph('Sin vista previa');
        } else {
          // PDF: la primera página, con el pdf.js del visor.
          const pdfjs = await cargarPdfjs();
          const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
          const pag = await doc.getPage(1);
          const vp0 = pag.getViewport({ scale: 1 });
          const vp = pag.getViewport({ scale: Math.min(2, 520 / vp0.width) });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          await pag.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          mostrar(cv, cv.width, cv.height);
        }
      } catch (e) {
        console.warn('miniatura del archivo:', e);
        if (miniDe === f) ph('Sin vista previa');
      }
    }

    function abrir() {
      const f = file;
      if (!f) return;
      abrirVisor(f, etiqueta);
    }

    pill.addEventListener('click', () => ficha(true));
    q('.pa-ficha-x').addEventListener('click', () => ficha(false));
    ov.addEventListener('click', e => { if (e.target === ov) ficha(false); });
    q('.pa-thumb').addEventListener('click', abrir);
    q('[data-a="abrir"]').addEventListener('click', abrir);
    q('[data-a="recortar"]').addEventListener('click', () => { ficha(false); if (op.onRecortar) op.onRecortar(); });
    q('[data-a="quitar"]').addEventListener('click', () => { ficha(false); if (op.onQuitar) op.onQuitar(); });
    // Hoja del teléfono: la línea de arriba (y el encabezado) se agarran y se arrastran hacia
    // abajo; soltando pasado cierto punto (o con un tirón rápido) se cierra, si no vuelve. Un
    // toque en la línea también cierra.
    const fichaEl = q('.pa-ficha');
    let arr = null;
    const enHoja = () => getComputedStyle(q('.pa-grip')).display !== 'none';
    function arrastreFin(e) {
      if (!arr) return;
      const a = arr; arr = null;
      fichaEl.style.transition = 'transform .22s var(--ease-spring), opacity .22s';
      const dy = Math.max(0, e.clientY - a.y0), v = dy / Math.max(1, e.timeStamp - a.t0);
      if (e.type !== 'pointercancel' && (dy < 6 && a.grip || dy > fichaEl.offsetHeight * .3 || (dy > 40 && v > .6))) {
        fichaEl.style.transform = 'translateY(100%)'; fichaEl.style.opacity = '0';
        setTimeout(() => { ficha(false); fichaEl.style.transition = fichaEl.style.transform = fichaEl.style.opacity = fichaEl.style.animation = ''; }, 200);
      } else { fichaEl.style.transform = ''; setTimeout(() => { fichaEl.style.transition = ''; }, 240); }   // la animación queda apagada: volver a prenderla la repetiría
    }
    [q('.pa-grip'), q('.pa-ficha-hd')].forEach(zona => {
      zona.addEventListener('pointerdown', e => {
        if (!enHoja() || e.target.closest('.pa-ficha-x') || (e.pointerType === 'mouse' && e.button !== 0)) return;
        arr = { y0: e.clientY, t0: e.timeStamp, grip: zona.classList.contains('pa-grip') };
        fichaEl.style.transition = 'none'; fichaEl.style.animation = 'none';   // la de entrada fija el transform
        zona.setPointerCapture(e.pointerId);
      });
      zona.addEventListener('pointermove', e => {
        if (arr) fichaEl.style.transform = `translateY(${Math.max(0, e.clientY - arr.y0)}px)`;
      });
      zona.addEventListener('pointerup', arrastreFin);
      zona.addEventListener('pointercancel', arrastreFin);
    });
    // En captura: corre antes que el del visor y el de la hoja de abajo (la de Remitos), así un
    // Escape con el visor abierto cierra sólo el visor, y uno con la ficha abierta, sólo la ficha.
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || ov.classList.contains('hidden') || visorAbierto()) return;
      e.stopPropagation();
      ficha(false);
    }, true);

    pintarTipo();
    miniatura(null);

    return {
      mostrar(f, o) {
        file = f;
        q('[data-a="recortar"]').classList.toggle('hidden', !(o && o.recortar));
        const ext = extDe(f);
        q('.pa-name').textContent = f.name;
        q('.pa-peso').textContent = peso(f.size);
        q('.pa-chip').textContent = contenedor.querySelector('.pa-pill-ext').textContent = ext;
        contenedor.classList.remove('hidden');
        miniatura(null);
        if (!ov.classList.contains('hidden')) miniatura(f);
      },
      limpiar() {
        file = null;
        contenedor.classList.add('hidden');
        ficha(false);
        miniatura(null);
      },
      tipo(t, et) { tipoK = t; etiqueta = et; pintarTipo(); },
      cerrar() { ficha(false); },
      abrir
    };
  };
})();
