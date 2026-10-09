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
  const JSCANIFY_SRC = 'js/vendor/jscanify.min.js';
  const MAX_SRC      = 1400;   // lado mayor de la imagen de trabajo (px)
  const DETECT_SIZE  = 700;    // lado mayor para correr la detección (px)
  const MAX_OUT      = 1800;   // lado mayor de la imagen de salida (px)
  const JPEG_QUALITY = 0.85;
  const QUAD_COLOR   = '#2557a7';
  const LOUPE_PX     = 104;    // diámetro de la lupa (px CSS)
  const LOUPE_ZOOM   = 2.5;

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
      if (!window.jscanify) await loadScript(JSCANIFY_SRC);
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

  function scaledCanvas(srcCanvas, w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.getContext('2d').drawImage(srcCanvas, 0, 0, c.width, c.height);
    return c;
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
        const cv = window.cv;
        let mat = null, contour = null;
        try {
          const k = Math.min(1, DETECT_SIZE / Math.max(w, h));
          const small = scaledCanvas(state.src, w * k, h * k);
          const scanner = new window.jscanify();
          mat = cv.imread(small);
          contour = scanner.findPaperContour(mat);
          const minArea = small.width * small.height * 0.12;
          if (contour && cv.contourArea(contour) > minArea) {
            const c = scanner.getCornerPoints(contour, mat);
            const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
            if (pts.every((p) => p && isFinite(p.x) && isFinite(p.y))) {
              const up = (p) => ({
                x: Math.max(0, Math.min(w, p.x / k)),
                y: Math.max(0, Math.min(h, p.y / k)),
              });
              const q4 = { tl: up(pts[0]), tr: up(pts[1]), br: up(pts[2]), bl: up(pts[3]) };
              // descartar cuadriláteros degenerados
              const ok = dist(q4.tl, q4.tr) > w * 0.15 && dist(q4.bl, q4.br) > w * 0.15 &&
                         dist(q4.tl, q4.bl) > h * 0.15 && dist(q4.tr, q4.br) > h * 0.15;
              if (ok) { state.corners = q4; return true; }
            }
          }
        } catch (_) { /* fallback */ }
        finally {
          if (contour) { try { contour.delete(); } catch (_) {} }
          if (mat)     { try { mat.delete();     } catch (_) {} }
        }
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

      // —— Miniaturas de los filtros (sobre una copia chica de la foto) ——
      function renderThumbs() {
        const w = state.src.width, h = state.src.height;
        const k = 120 / Math.max(w, h);
        const small = scaledCanvas(state.src, w * k, h * k);
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
        els.canvas.width = dw; els.canvas.height = dh;
        els.quad.width   = dw; els.quad.height   = dh;
      }

      // —— Render del display: SIEMPRE dibuja la foto; filtro como capa opcional ——
      function render() {
        const ctx = els.canvas.getContext('2d');
        const base = scaledCanvas(state.src, els.canvas.width, els.canvas.height);
        let shown = base;
        try { shown = applyFilter(base, state.filter); } catch (_) { shown = base; }
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.drawImage(shown, 0, 0);
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
        ctx.clearRect(0, 0, els.quad.width, els.quad.height);
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
        const half = LOUPE_PX / 2 / LOUPE_ZOOM;   // px de display a cada lado
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#e9eef6';
        ctx.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(els.canvas, dx - half, dy - half, half * 2, half * 2, 0, 0, LOUPE_PX, LOUPE_PX);
        ctx.drawImage(els.quad,   dx - half, dy - half, half * 2, half * 2, 0, 0, LOUPE_PX, LOUPE_PX);
        ctx.strokeStyle = QUAD_COLOR;
        ctx.lineWidth = 1.5;
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
        const c = state.corners;
        const outW = Math.round((dist(c.tl, c.tr) + dist(c.bl, c.br)) / 2);
        const outH = Math.round((dist(c.tl, c.bl) + dist(c.tr, c.br)) / 2);
        const k = Math.min(1, MAX_OUT / Math.max(outW, outH));
        const W = Math.max(1, Math.round(outW * k));
        const H = Math.max(1, Math.round(outH * k));
        const scanner = new window.jscanify();
        const warped = scanner.extractPaper(state.src, W, H, {
          topLeftCorner:     c.tl, topRightCorner:    c.tr,
          bottomLeftCorner:  c.bl, bottomRightCorner: c.br,
        });
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
        const fn = () => { setFilter(ch.dataset.filter); if (state.corners) render(); };
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
