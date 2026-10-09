/* ─────────────────────────────────────────────────────────────────────────
 * scanner.js — Escáner de comprobantes estilo CamScanner (Nivel 2)
 *
 * API pública:
 *   window.openScanner(file) -> Promise<File|null>
 *     Abre el editor sobre la foto recibida. Resuelve con un File JPEG
 *     (perspectiva corregida + filtro) o null si el usuario cancela.
 *     Rechaza ante error duro (no se pudieron cargar las librerías/imagen).
 *
 * El editor (claro, como el resto de la app) lo arma este archivo la primera
 * vez que se abre: las páginas sólo cargan el script. Título con la indicación,
 * "Toda la foto" (sin recorte), Rotar, filtros con miniatura y una lupa sobre
 * la esquina mientras se arrastra (en el teléfono el dedo la tapa).
 *
 * Robustez: el display NO depende de OpenCV — la foto se dibuja siempre con
 * canvas 2D plano. OpenCV se usa solo para la detección de bordes (sobre una
 * copia chica) y para el warp + filtro de salida. Cualquier fallo de OpenCV
 * degrada con gracia (recorte completo / foto plana) y nunca cuelga el loader.
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const OPENCV_SRC   = 'js/vendor/opencv.js';
  const MAX_SRC      = 2600;   // lado mayor de la imagen de trabajo (px)
  const DETECT_SIZE  = 800;    // lado mayor para correr la detección (px)
  const MAX_OUT      = 2200;   // lado mayor de la imagen de salida (px)
  const JPEG_QUALITY = 0.88;
  const QUAD_COLOR   = '#2557a7';
  const LOUPE_PX     = 104;    // diámetro de la lupa (px CSS)
  const LOUPE_ZOOM   = 3;
  const THUMB_PX     = 120;    // lado mayor de las miniaturas de filtro (px)

  // ─── Markup del editor ────────────────────────────────────────────────────
  const SVG = (inner) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const I = {
    x:      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    full:   '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>',
    check:  '<polyline points="20 6 9 17 4 12"/>',
  };
  const FILTROS = [['color', 'Color'], ['gray', 'Grises'], ['bw', 'B&N']];

  function ensureEditor() {
    let ed = document.getElementById('scan-editor');
    if (ed) return ed;
    ed = document.createElement('div');
    ed.id = 'scan-editor';
    ed.className = 'scan-editor hidden';
    ed.setAttribute('role', 'dialog');
    ed.setAttribute('aria-modal', 'true');
    ed.setAttribute('aria-labelledby', 'scan-title');
    ed.innerHTML = `
      <div class="scan-top" id="scan-top">
        <button type="button" class="scan-x" data-scan-cancel aria-label="Cancelar">${SVG(I.x)}</button>
        <div class="scan-tt">
          <b id="scan-title">Recortar comprobante</b>
          <span>Mové las esquinas al borde del papel<span class="scan-largo">; la foto se endereza sola</span></span>
        </div>
        <div class="scan-top-acts">
          <button type="button" class="scan-ib" id="scan-full" title="Usar la foto entera, sin recortar">${SVG(I.full)}<span>Toda la foto</span></button>
          <button type="button" class="scan-ib" id="scan-rotate" title="Rotar">${SVG(I.rotate)}<span>Rotar</span></button>
        </div>
      </div>
      <div class="scan-area">
        <div class="scan-stage" id="scan-stage">
          <canvas id="scan-canvas"></canvas>
          <canvas id="scan-quad"></canvas>
          <div class="scan-handle" data-corner="tl"></div>
          <div class="scan-handle" data-corner="tr"></div>
          <div class="scan-handle" data-corner="br"></div>
          <div class="scan-handle" data-corner="bl"></div>
          <canvas class="scan-loupe hidden" id="scan-loupe"></canvas>
        </div>
        <span class="scan-tip hidden" id="scan-tip"></span>
      </div>
      <div class="scan-loading hidden" id="scan-loading">
        <div class="scan-spinner"></div>
        <span id="scan-loading-text">Cargando escáner…</span>
      </div>
      <div class="scan-bot" id="scan-bot">
        <div class="scan-filters" role="group" aria-label="Filtro">
          ${FILTROS.map(([f, l]) => `<button type="button" class="scan-chip" data-filter="${f}" aria-pressed="false"><canvas class="scan-th"></canvas><span>${l}</span></button>`).join('')}
        </div>
        <div class="scan-actions">
          <button type="button" class="scan-btn" data-scan-cancel>Cancelar</button>
          <button type="button" class="scan-btn primary" id="scan-done">${SVG(I.check)}Usar este recorte</button>
        </div>
      </div>`;
    document.body.appendChild(ed);
    return ed;
  }

  // ─── Carga diferida de librerías ──────────────────────────────────────────
  let libsPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (libsPromise) return libsPromise;
    libsPromise = (async () => {
      await loadScript(OPENCV_SRC);
      await new Promise((resolve) => {
        if (window.cv && window.cv.Mat) return resolve();
        window.cv = window.cv || {};
        window.cv.onRuntimeInitialized = () => resolve();
      });
    })().catch((err) => { libsPromise = null; throw err; });
    return libsPromise;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
      img.src = url;
    });
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // Achica en pasos de a la mitad: un drawImage directo de 2600 px a 300 px
  // saltea píxeles y la foto queda serruchada y borrosa.
  function scaledCanvas(srcCanvas, w, h) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    let cur = srcCanvas;
    while (cur.width / 2 > W && cur.height / 2 > H) {
      const half = document.createElement('canvas');
      half.width = Math.round(cur.width / 2);
      half.height = Math.round(cur.height / 2);
      const hc = half.getContext('2d');
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, W, H);
    return c;
  }

  // Ordena 4 puntos como tl, tr, br, bl (por suma y diferencia de coordenadas).
  function ordenarEsquinas(pts) {
    const by = (f) => pts.slice().sort((a, b) => f(a) - f(b));
    const suma = by((p) => p.x + p.y), dif = by((p) => p.y - p.x);
    return { tl: suma[0], br: suma[3], tr: dif[0], bl: dif[3] };
  }

  // Busca el papel en un canvas chico. Devuelve {tl,tr,br,bl} en px del canvas, o null.
  // Prueba varios mapas binarios (bordes Canny con umbral automático y con umbral
  // bajo, y "zona clara" por Otsu); de cada contorno toma la envolvente convexa y
  // arma cuadriláteros convexos que la representen bien. Gana el de mejor
  // "apoyo × área": apoyo = fracción de su perímetro que cae sobre un borde real
  // (así un fondo con vetas o rayas pegado al papel no le gana al papel).
  function findPaperQuad(small) {
    const cv = window.cv;
    const W = small.width, H = small.height, A = W * H;
    const mats = [];
    const keep = (m) => { mats.push(m); return m; };
    let best = null;
    try {
      const rgba = keep(cv.imread(small));
      const gray = keep(new cv.Mat());
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
      const kernel5 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));

      // mediana de grises (muestreada) para el umbral automático de Canny
      const hist = new Uint32Array(256), d = gray.data;
      let n = 0;
      for (let i = 0; i < d.length; i += 3) { hist[d[i]]++; n++; }
      let med = 0;
      for (let acc = 0; med < 255; med++) { acc += hist[med]; if (acc >= n / 2) break; }

      const bins = [];
      for (const [lo, hi] of [[Math.max(10, 0.66 * med), Math.min(255, 1.33 * med)], [20, 60]]) {
        const e = keep(new cv.Mat());
        cv.Canny(gray, e, lo, hi);
        cv.dilate(e, e, kernel);           // une trazos del borde cortados
        bins.push(e);
      }
      const otsu = keep(new cv.Mat());
      cv.threshold(gray, otsu, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(otsu, otsu, cv.MORPH_OPEN, kernel5);
      bins.push(otsu);

      // Apoyo: muestrea los 4 lados cada ~2 px sobre el mapa de bordes de umbral bajo.
      const edges = bins[1].data;
      const apoyo = (q) => {
        let on = 0, tot = 0;
        for (let i = 0; i < 4; i++) {
          const a = q[i], b = q[(i + 1) % 4];
          const steps = Math.max(2, Math.round(dist(a, b) / 2));
          for (let s = 0; s <= steps; s++) {
            const x = Math.round(a.x + (b.x - a.x) * s / steps);
            const y = Math.round(a.y + (b.y - a.y) * s / steps);
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            tot++;
            if (edges[y * W + x]) on++;
          }
        }
        return tot ? on / tot : 0;
      };

      for (const bin of bins) {
        const contours = new cv.MatVector(), hier = new cv.Mat();
        cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const hull = new cv.Mat();
          cv.convexHull(c, hull, false, true);
          const hullArea = cv.contourArea(hull);
          if (hullArea > A * 0.15 && hullArea < A * 0.97) {
            const peri = cv.arcLength(hull, true);
            for (const eps of [0.02, 0.03, 0.045, 0.06]) {
              const ap = new cv.Mat();
              cv.approxPolyDP(hull, ap, eps * peri, true);
              const rows = ap.rows;
              if (rows === 4 && cv.isContourConvex(ap)) {
                const quadArea = cv.contourArea(ap);
                // el cuadrilátero tiene que cubrir casi toda la envolvente
                if (quadArea > hullArea * 0.9 && quadArea < A * 0.97) {
                  const p = ap.data32S;
                  const pts = [0, 2, 4, 6].map((j) => ({ x: p[j], y: p[j + 1] }));
                  const sup = apoyo(pts);
                  const score = sup * sup * quadArea;
                  if (sup > 0.5 && (!best || score > best.score)) best = { score, pts };
                }
              }
              ap.delete();
              if (rows <= 4) break;
            }
          }
          hull.delete(); c.delete();
        }
        contours.delete(); hier.delete();
      }
    } finally {
      mats.forEach((m) => { try { m.delete(); } catch (_) {} });
    }
    return best ? ordenarEsquinas(best.pts) : null;
  }

  // Endereza el cuadrilátero `c` (px de srcCanvas) a un canvas de W×H.
  function warpQuad(srcCanvas, c, W, H, interp) {
    const cv = window.cv;
    const src = cv.imread(srcCanvas), dst = new cv.Mat();
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, [c.tl.x, c.tl.y, c.tr.x, c.tr.y, c.br.x, c.br.y, c.bl.x, c.bl.y]);
    const to   = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    const M = cv.getPerspectiveTransform(from, to);
    const out = document.createElement('canvas');
    try {
      cv.warpPerspective(src, dst, M, new cv.Size(W, H), interp, cv.BORDER_REPLICATE, new cv.Scalar());
      cv.imshow(out, dst);
    } finally {
      src.delete(); dst.delete(); from.delete(); to.delete(); M.delete();
    }
    return out;
  }

  // Tamaño de salida del recorte (promedio de lados opuestos), con lado mayor ≤ max.
  function quadSize(c, max) {
    const w = (dist(c.tl, c.tr) + dist(c.bl, c.br)) / 2;
    const h = (dist(c.tl, c.bl) + dist(c.tr, c.br)) / 2;
    const k = Math.min(1, max / Math.max(w, h, 1));
    return { W: Math.max(1, Math.round(w * k)), H: Math.max(1, Math.round(h * k)) };
  }

  // ─── Editor ───────────────────────────────────────────────────────────────
  function openScanner(file) {
    return new Promise((resolve, reject) => {
      const editor = ensureEditor();
      const q = (sel) => editor.querySelector(sel);
      const els = {
        editor,
        top:      q('#scan-top'),
        bot:      q('#scan-bot'),
        stage:    q('#scan-stage'),
        canvas:   q('#scan-canvas'),
        quad:     q('#scan-quad'),
        loupe:    q('#scan-loupe'),
        tip:      q('#scan-tip'),
        loading:  q('#scan-loading'),
        loadTxt:  q('#scan-loading-text'),
        rotate:   q('#scan-rotate'),
        full:     q('#scan-full'),
        cancels:  Array.from(editor.querySelectorAll('[data-scan-cancel]')),
        done:     q('#scan-done'),
        chips:    Array.from(editor.querySelectorAll('.scan-chip')),
        handles:  Array.from(editor.querySelectorAll('.scan-handle')),
      };

      const state = {
        baseImg:  null,
        rotation: 0,
        filter:   'color',
        src:      document.createElement('canvas'), // imagen de trabajo (plana, rotada, capada)
        corners:  null,   // {tl,tr,br,bl} en px de state.src
        scale:    1,      // px display / px src
        dpr:      1,      // px de canvas / px CSS del display
      };

      // —— Limpieza / salida ——
      const cleanups = [];
      let tipTimer = null;
      function teardown() {
        cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        clearTimeout(tipTimer);
        els.tip.classList.add('hidden');
        els.loupe.classList.add('hidden');
        els.editor.classList.add('hidden');
        document.body.classList.remove('scan-open');
      }
      function finish(result) { teardown(); resolve(result); }  // null = cancelar
      function fail(err)      { teardown(); reject(err); }       // error duro

      function showLoading(txt) {
        els.loadTxt.textContent = txt || 'Cargando…';
        els.loading.classList.remove('hidden');
      }
      function hideLoading() { els.loading.classList.add('hidden'); }

      function tip(txt) {
        clearTimeout(tipTimer);
        els.tip.textContent = txt;
        els.tip.classList.remove('hidden');
        tipTimer = setTimeout(() => els.tip.classList.add('hidden'), 2600);
      }

      // —— Imagen de trabajo (rotación + cap de resolución), canvas 2D plano ——
      function buildSrc() {
        const img = state.baseImg;
        const swap = state.rotation === 90 || state.rotation === 270;
        let w = swap ? img.naturalHeight : img.naturalWidth;
        let h = swap ? img.naturalWidth  : img.naturalHeight;
        if (!w || !h) throw new Error('Imagen sin dimensiones');
        const k = Math.min(1, MAX_SRC / Math.max(w, h));
        w = Math.round(w * k); h = Math.round(h * k);
        state.src.width = w; state.src.height = h;
        const ctx = state.src.getContext('2d');
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(state.rotation * Math.PI / 180);
        const dw = swap ? h : w, dh = swap ? w : h;
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }

      // —— Detección de bordes (copia chica, validada; fallback recorte casi completo) ——
      // Devuelve true si encontró el papel.
      function detectCorners() {
        const w = state.src.width, h = state.src.height;
        const fallback = {
          tl: { x: w * 0.04, y: h * 0.04 }, tr: { x: w * 0.96, y: h * 0.04 },
          br: { x: w * 0.96, y: h * 0.96 }, bl: { x: w * 0.04, y: h * 0.96 },
        };
        try {
          const k = Math.min(1, DETECT_SIZE / Math.max(w, h));
          const q = findPaperQuad(scaledCanvas(state.src, w * k, h * k));
          if (q) {
            const up = (p) => ({
              x: Math.max(0, Math.min(w, p.x / k)),
              y: Math.max(0, Math.min(h, p.y / k)),
            });
            const q4 = { tl: up(q.tl), tr: up(q.tr), br: up(q.br), bl: up(q.bl) };
            // descartar cuadriláteros degenerados
            const ok = dist(q4.tl, q4.tr) > w * 0.15 && dist(q4.bl, q4.br) > w * 0.15 &&
                       dist(q4.tl, q4.bl) > h * 0.15 && dist(q4.tr, q4.br) > h * 0.15;
            if (ok) { state.corners = q4; return true; }
          }
        } catch (_) { /* fallback */ }
        state.corners = fallback;
        return false;
      }

      // Normaliza la iluminación de un canal de grises IN PLACE:
      // divide por una estimación del fondo (blur grande) → papel blanco parejo,
      // sin bandas ni sombras, conservando trazos. Luego un leve estiramiento.
      function flattenIllum(gray) {
        const cv = window.cv;
        const bg = new cv.Mat();
        const sigma = Math.max(3, Math.max(gray.cols, gray.rows) / 20);
        cv.GaussianBlur(gray, bg, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REPLICATE);
        cv.divide(gray, bg, gray, 255);          // donde imagen≈fondo → 255 (blanco)
        cv.normalize(gray, gray, 0, 255, cv.NORM_MINMAX); // estira el rango restante
        // Realce de nitidez (unsharp mask) para que el trazo se lea mejor
        const rs = Math.max(1, Math.max(gray.cols, gray.rows) / 900);
        cv.GaussianBlur(gray, bg, new cv.Size(0, 0), rs, rs, cv.BORDER_REPLICATE);
        cv.addWeighted(gray, 1.6, bg, -0.6, 0, gray);
        bg.delete();
      }

      // —— Filtro OpenCV sobre un canvas; devuelve canvas filtrado (puede lanzar) ——
      function applyFilter(srcCanvas, filter) {
        const cv = window.cv;
        const out = document.createElement('canvas');
        let src = cv.imread(srcCanvas);
        let dst = new cv.Mat();
        try {
          if (filter === 'gray') {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            flattenIllum(dst);
          } else if (filter === 'bw') {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            flattenIllum(dst);
            const block = Math.max(15, (Math.round(Math.min(dst.cols, dst.rows) / 24) | 1));
            cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv.THRESH_BINARY, block, 12);
          } else {
            // Color: normalizar iluminación en la luminancia, conservar el color
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            const ycc = new cv.Mat();
            cv.cvtColor(rgb, ycc, cv.COLOR_RGB2YCrCb);
            const chans = new cv.MatVector();
            cv.split(ycc, chans);
            const y  = chans.get(0);
            const cr = chans.get(1);
            const cb = chans.get(2);
            flattenIllum(y);
            const merged = new cv.MatVector();
            merged.push_back(y); merged.push_back(cr); merged.push_back(cb);
            cv.merge(merged, ycc);
            cv.cvtColor(ycc, dst, cv.COLOR_YCrCb2RGB);
            rgb.delete(); ycc.delete(); chans.delete();
            y.delete(); cr.delete(); cb.delete(); merged.delete();
          }
          cv.imshow(out, dst);
        } finally {
          src.delete(); dst.delete();
        }
        return out;
      }

      // —— Miniaturas de los filtros: el recorte enderezado, en chico, con cada filtro ——
      // (la foto grande queda sin filtro para ver bien los bordes al ubicar las esquinas)
      function renderThumbs() {
        const { W, H } = quadSize(state.corners, THUMB_PX * 3);
        let small;
        try {
          small = warpQuad(state.src, state.corners, W, H, window.cv.INTER_AREA);
          small = scaledCanvas(small, W / 3, H / 3);
        } catch (_) {
          const w = state.src.width, h = state.src.height, k = THUMB_PX / Math.max(w, h);
          small = scaledCanvas(state.src, w * k, h * k);
        }
        els.chips.forEach((ch) => {
          const c = ch.querySelector('canvas');
          let shown = small;
          try { shown = applyFilter(small, ch.dataset.filter); } catch (_) { shown = small; }
          c.width = shown.width; c.height = shown.height;
          c.getContext('2d').drawImage(shown, 0, 0);
        });
      }

      // —— Layout: dimensiona display y posiciona manijas ——
      function layout() {
        const w = state.src.width, h = state.src.height;
        const reservado = els.top.offsetHeight + els.bot.offsetHeight + 28;
        const maxW = Math.min(window.innerWidth - 28, 1000);
        const maxH = Math.max(160, window.innerHeight - reservado);
        const scale = Math.min(maxW / w, maxH / h, 1) || 1;
        state.scale = scale;
        const dw = Math.max(1, Math.round(w * scale));
        const dh = Math.max(1, Math.round(h * scale));
        els.stage.style.width  = dw + 'px';
        els.stage.style.height = dh + 'px';
        // Los canvas van a la resolución real de la pantalla (devicePixelRatio):
        // a 1 px por px CSS, en el teléfono la foto se ve borrosa.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        state.dpr = dpr;
        const bw = Math.min(w, Math.round(dw * dpr)), bh = Math.min(h, Math.round(dh * dpr));
        els.canvas.width = bw; els.canvas.height = bh;
        els.quad.width   = Math.round(dw * dpr); els.quad.height = Math.round(dh * dpr);
      }

      // —— Render del display: la foto tal cual (el filtro se ve en las miniaturas) ——
      function render() {
        const ctx = els.canvas.getContext('2d');
        const base = scaledCanvas(state.src, els.canvas.width, els.canvas.height);
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.drawImage(base, 0, 0);
        positionHandles();
        drawQuad();
      }

      function positionHandles() {
        els.handles.forEach((el) => {
          const c = state.corners[el.dataset.corner];
          el.style.left = (c.x * state.scale) + 'px';
          el.style.top  = (c.y * state.scale) + 'px';
        });
      }

      function drawQuad() {
        const ctx = els.quad.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, els.quad.width, els.quad.height);
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        const s = state.scale, c = state.corners;
        ctx.beginPath();
        ctx.moveTo(c.tl.x * s, c.tl.y * s);
        ctx.lineTo(c.tr.x * s, c.tr.y * s);
        ctx.lineTo(c.br.x * s, c.br.y * s);
        ctx.lineTo(c.bl.x * s, c.bl.y * s);
        ctx.closePath();
        ctx.strokeStyle = QUAD_COLOR;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(37,87,167,0.12)';
        ctx.fill();
      }

      // —— Lupa: muestra ampliado lo que hay bajo la esquina que se arrastra ——
      function drawLoupe(dx, dy) {
        const dpr = window.devicePixelRatio || 1;
        const L = els.loupe;
        if (L.width !== LOUPE_PX * dpr) { L.width = L.height = LOUPE_PX * dpr; }
        const ctx = L.getContext('2d');
        // Se lee de la imagen de trabajo (resolución completa), no del display.
        const half = LOUPE_PX / 2 / LOUPE_ZOOM / state.scale;   // px de src a cada lado
        const sx = dx / state.scale - half, sy = dy / state.scale - half;
        const f = LOUPE_PX / (half * 2);
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#e9eef6';
        ctx.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(state.src, sx, sy, half * 2, half * 2, 0, 0, LOUPE_PX, LOUPE_PX);
        const c = state.corners, P = (p) => [(p.x - sx) * f, (p.y - sy) * f];
        ctx.beginPath();
        ctx.moveTo(...P(c.tl)); ctx.lineTo(...P(c.tr)); ctx.lineTo(...P(c.br)); ctx.lineTo(...P(c.bl));
        ctx.closePath();
        ctx.strokeStyle = QUAD_COLOR;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        const m = LOUPE_PX / 2;
        ctx.beginPath();
        ctx.moveTo(m, m - 14); ctx.lineTo(m, m + 14);
        ctx.moveTo(m - 14, m); ctx.lineTo(m + 14, m);
        ctx.stroke();
        ctx.restore();
        // Arriba a la izquierda del dedo; si no entra, del otro lado.
        const sw = els.stage.offsetWidth;
        let left = dx - LOUPE_PX - 28, top = dy - LOUPE_PX - 28;
        if (left < -8) left = Math.min(dx + 28, sw - LOUPE_PX + 8);
        if (top < -8) top = dy + 28;
        L.style.left = left + 'px';
        L.style.top  = top + 'px';
        L.classList.remove('hidden');
      }

      // —— Arrastre de manijas ——
      function bindHandle(el) {
        const key = el.dataset.corner;
        function onMove(ev) {
          const rect = els.stage.getBoundingClientRect();
          const px = (ev.clientX - rect.left) / state.scale;
          const py = (ev.clientY - rect.top)  / state.scale;
          state.corners[key] = {
            x: Math.max(0, Math.min(state.src.width,  px)),
            y: Math.max(0, Math.min(state.src.height, py)),
          };
          const dx = state.corners[key].x * state.scale, dy = state.corners[key].y * state.scale;
          el.style.left = dx + 'px';
          el.style.top  = dy + 'px';
          drawQuad();
          drawLoupe(dx, dy);
        }
        function onDown(ev) {
          ev.preventDefault();
          try { el.setPointerCapture(ev.pointerId); } catch (_) {}
          el.classList.add('drag');
          drawLoupe(state.corners[key].x * state.scale, state.corners[key].y * state.scale);
          el.addEventListener('pointermove', onMove);
          const up = () => {
            el.classList.remove('drag');
            els.loupe.classList.add('hidden');
            try { renderThumbs(); } catch (_) {}
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
          };
          el.addEventListener('pointerup', up);
          el.addEventListener('pointercancel', up);
        }
        el.addEventListener('pointerdown', onDown);
        cleanups.push(() => el.removeEventListener('pointerdown', onDown));
      }

      // —— Salida: warp (perspectiva) + filtro -> File JPEG ——
      function buildOutput() {
        const { W, H } = quadSize(state.corners, MAX_OUT);
        const warped = warpQuad(state.src, state.corners, W, H, window.cv.INTER_CUBIC);
        let result = warped;
        try { result = applyFilter(warped, state.filter); } catch (_) { result = warped; }
        return new Promise((res) => {
          result.toBlob((blob) => {
            const baseName = (file.name || 'comprobante').replace(/\.[^.]+$/, '');
            res(new File([blob], baseName + '.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', JPEG_QUALITY);
        });
      }

      function fullFrameCorners() {
        const w = state.src.width, h = state.src.height;
        return { tl: { x: 0, y: 0 }, tr: { x: w, y: 0 }, br: { x: w, y: h }, bl: { x: 0, y: h } };
      }

      // —— Recalcular sobre la imagen actual (tras rotar / arranque) ——
      // Paso 1: mostrar la foto YA (recorte completo). Paso 2: detección de bordes.
      function refresh() {
        showLoading('Detectando bordes…');
        setTimeout(() => {
          try {
            buildSrc();
            state.corners = fullFrameCorners();
            layout();
            render();                 // la foto ya es visible (detrás del loader)
          } catch (err) {
            hideLoading();
            if (window.showToast) showToast('No se pudo abrir la imagen', 'error');
            finish(null);
            return;
          }
          setTimeout(() => {
            let hallado = false;
            try { hallado = detectCorners(); positionHandles(); drawQuad(); }
            catch (_) { /* se queda con recorte completo */ }
            finally { hideLoading(); }
            tip(hallado ? 'Bordes detectados' : 'Llevá las esquinas al borde del papel');
            try { renderThumbs(); } catch (_) {}
          }, 30);
        }, 16);
      }

      // —— Controles ——
      function setFilter(f) {
        state.filter = f;
        els.chips.forEach((ch) => ch.setAttribute('aria-pressed', String(ch.dataset.filter === f)));
      }
      els.chips.forEach((ch) => {
        const fn = () => setFilter(ch.dataset.filter);
        ch.addEventListener('click', fn);
        cleanups.push(() => ch.removeEventListener('click', fn));
      });

      const onRotate = () => {
        state.rotation = (state.rotation + 90) % 360;
        refresh();
      };
      els.rotate.addEventListener('click', onRotate);
      cleanups.push(() => els.rotate.removeEventListener('click', onRotate));

      const onFull = () => {
        if (!state.corners) return;
        state.corners = fullFrameCorners();
        positionHandles();
        drawQuad();
        try { renderThumbs(); } catch (_) {}
        tip('Se usa la foto entera');
      };
      els.full.addEventListener('click', onFull);
      cleanups.push(() => els.full.removeEventListener('click', onFull));

      const onCancel = () => finish(null);
      els.cancels.forEach((b) => {
        b.addEventListener('click', onCancel);
        cleanups.push(() => b.removeEventListener('click', onCancel));
      });

      const onDone = async () => {
        showLoading('Procesando…');
        try {
          const out = await buildOutput();
          finish(out);
        } catch (err) {
          hideLoading();
          if (window.showToast) showToast('No se pudo procesar la imagen', 'error');
          finish(null);
        }
      };
      els.done.addEventListener('click', onDone);
      cleanups.push(() => els.done.removeEventListener('click', onDone));

      const onResize = () => { if (state.corners) { layout(); render(); } };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      els.handles.forEach(bindHandle);

      // —— Arranque ——
      (async () => {
        document.body.classList.add('scan-open');
        els.editor.classList.remove('hidden');
        setFilter('color');
        els.chips.forEach((ch) => {
          const c = ch.querySelector('canvas');
          c.getContext('2d').clearRect(0, 0, c.width, c.height);
        });
        showLoading('Cargando escáner…');
        try {
          await ensureLibs();
          state.baseImg = await fileToImage(file);
        } catch (err) {
          hideLoading();
          fail(err);   // el llamador adjunta la foto original como fallback
          return;
        }
        refresh();
      })();
    });
  }

  window.openScanner = openScanner;
})();
