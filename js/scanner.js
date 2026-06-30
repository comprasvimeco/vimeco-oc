/* ─────────────────────────────────────────────────────────────────────────
 * scanner.js — Escáner de comprobantes estilo CamScanner (Nivel 2)
 *
 * API pública:
 *   window.openScanner(file) -> Promise<File|null>
 *     Abre el editor sobre la foto recibida. Resuelve con un File JPEG
 *     (perspectiva corregida + filtro) o null si el usuario cancela.
 *
 * Detección de bordes y corrección de perspectiva con jscanify (OpenCV.js).
 * Las librerías se cargan de forma diferida la primera vez (se cachean luego
 * en runtime vía service worker). Filtros aplicados con OpenCV: Color con
 * auto-contraste (default), Grises y B&N (umbral adaptativo).
 * ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const OPENCV_SRC   = 'js/vendor/opencv.js';
  const JSCANIFY_SRC = 'js/vendor/jscanify.min.js';
  const MAX_SRC      = 2000;   // lado mayor de la imagen de trabajo (px)
  const MAX_OUT      = 1800;   // lado mayor de la imagen de salida (px)
  const JPEG_QUALITY = 0.85;

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
      // Esperar a que el runtime WASM de OpenCV esté inicializado.
      await new Promise((resolve) => {
        if (window.cv && window.cv.Mat) return resolve();
        window.cv = window.cv || {};
        window.cv.onRuntimeInitialized = () => resolve();
      });
      if (!window.jscanify) await loadScript(JSCANIFY_SRC);
    })().catch((err) => { libsPromise = null; throw err; });
    return libsPromise;
  }

  // ─── Helpers de imagen ────────────────────────────────────────────────────
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

  // ─── Editor ───────────────────────────────────────────────────────────────
  function openScanner(file) {
    return new Promise((resolve, reject) => {
      const els = {
        editor:   document.getElementById('scan-editor'),
        stage:    document.getElementById('scan-stage'),
        canvas:   document.getElementById('scan-canvas'),
        quad:     document.getElementById('scan-quad'),
        loading:  document.getElementById('scan-loading'),
        loadTxt:  document.getElementById('scan-loading-text'),
        rotate:   document.getElementById('scan-rotate'),
        cancel:   document.getElementById('scan-cancel'),
        done:     document.getElementById('scan-done'),
        chips:    Array.from(document.querySelectorAll('#scan-editor .scan-chip')),
        handles:  Array.from(document.querySelectorAll('#scan-editor .scan-handle')),
      };

      const state = {
        baseImg:  null,
        rotation: 0,
        filter:   'color',
        src:      document.createElement('canvas'), // imagen de trabajo (rotada, capada)
        corners:  null,   // {tl,tr,br,bl} en px de state.src
        scale:    1,      // px display / px src
      };

      // —— Limpieza y cierre ——
      const cleanups = [];
      function teardown() {
        cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
        els.editor.classList.add('hidden');
        document.body.classList.remove('scan-open');
      }
      function finish(result) { teardown(); resolve(result); }  // null = cancelar
      function fail(err)      { teardown(); reject(err); }       // error duro (libs/imagen)

      // —— Construir imagen de trabajo (aplica rotación + cap de resolución) ——
      function buildSrc() {
        const img = state.baseImg;
        const swap = state.rotation === 90 || state.rotation === 270;
        let w = swap ? img.naturalHeight : img.naturalWidth;
        let h = swap ? img.naturalWidth  : img.naturalHeight;
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

      // —— Detección de bordes (con fallback a recorte completo) ——
      function detectCorners() {
        const w = state.src.width, h = state.src.height;
        const inset = { // fallback: 4 esquinas con leve margen
          tl: { x: w * 0.04, y: h * 0.04 }, tr: { x: w * 0.96, y: h * 0.04 },
          br: { x: w * 0.96, y: h * 0.96 }, bl: { x: w * 0.04, y: h * 0.96 },
        };
        let mat = null, contour = null;
        try {
          const scanner = new window.jscanify();
          mat = window.cv.imread(state.src);
          contour = scanner.findPaperContour(mat);
          if (contour) {
            const c = scanner.getCornerPoints(contour, mat);
            const tl = c.topLeftCorner, tr = c.topRightCorner,
                  br = c.bottomRightCorner, bl = c.bottomLeftCorner;
            if (tl && tr && br && bl) {
              state.corners = { tl, tr, br, bl };
              return;
            }
          }
        } catch (_) { /* cae al fallback */ }
        finally {
          if (contour) { try { contour.delete(); } catch (_) {} }
          if (mat)     { try { mat.delete();     } catch (_) {} }
        }
        state.corners = inset;
      }

      // —— Filtros (OpenCV). Recibe canvas fuente, devuelve canvas filtrado ——
      function applyFilter(srcCanvas, filter) {
        const cv = window.cv;
        const out = document.createElement('canvas');
        let src = cv.imread(srcCanvas);
        let dst = new cv.Mat();
        try {
          if (filter === 'gray') {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
          } else if (filter === 'bw') {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
            cv.adaptiveThreshold(dst, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv.THRESH_BINARY, 15, 10);
          } else {
            // color + auto-contraste: ecualizar el canal de luminancia (YCrCb)
            const rgb = new cv.Mat();
            cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
            const ycc = new cv.Mat();
            cv.cvtColor(rgb, ycc, cv.COLOR_RGB2YCrCb);
            const chans = new cv.MatVector();
            cv.split(ycc, chans);
            const y  = chans.get(0);
            const cr = chans.get(1);
            const cb = chans.get(2);
            cv.equalizeHist(y, y);                 // realza contraste sin tocar el color
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

      // —— Layout: dimensiona el display y posiciona manijas/quad ——
      function layout() {
        const w = state.src.width, h = state.src.height;
        const toolbarH = 132;
        const maxW = Math.min(window.innerWidth - 24, 1000);
        const maxH = window.innerHeight - toolbarH - 24;
        const scale = Math.min(maxW / w, maxH / h, 1);
        state.scale = scale;
        const dw = Math.round(w * scale), dh = Math.round(h * scale);
        els.stage.style.width  = dw + 'px';
        els.stage.style.height = dh + 'px';
        els.canvas.width = dw; els.canvas.height = dh;
        els.quad.width   = dw; els.quad.height   = dh;
      }

      // —— Render del display (filtro aplicado para feedback inmediato) ——
      let filteredFull = null; // canvas filtrado a resolución de trabajo (para salida)
      function render() {
        filteredFull = applyFilter(state.src, state.filter);
        const ctx = els.canvas.getContext('2d');
        ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
        ctx.drawImage(filteredFull, 0, 0, els.canvas.width, els.canvas.height);
        positionHandles();
        drawQuad();
      }

      function positionHandles() {
        const map = { tl: 'tl', tr: 'tr', br: 'br', bl: 'bl' };
        els.handles.forEach((el) => {
          const key = map[el.dataset.corner];
          const c = state.corners[key];
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
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(34,197,94,0.10)';
        ctx.fill();
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
          el.style.left = (state.corners[key].x * state.scale) + 'px';
          el.style.top  = (state.corners[key].y * state.scale) + 'px';
          drawQuad();
        }
        function onDown(ev) {
          ev.preventDefault();
          el.setPointerCapture(ev.pointerId);
          el.addEventListener('pointermove', onMove);
          const up = () => {
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

      // —— Generar archivo de salida ——
      function buildOutput() {
        const cv = window.cv;
        const c = state.corners;
        const outW = Math.round((dist(c.tl, c.tr) + dist(c.bl, c.br)) / 2);
        const outH = Math.round((dist(c.tl, c.bl) + dist(c.tr, c.br)) / 2);
        const k = Math.min(1, MAX_OUT / Math.max(outW, outH));
        const W = Math.max(1, Math.round(outW * k));
        const H = Math.max(1, Math.round(outH * k));
        const scanner = new window.jscanify();
        const warped = scanner.extractPaper(filteredFull, W, H, {
          topLeftCorner:     c.tl, topRightCorner:    c.tr,
          bottomLeftCorner:  c.bl, bottomRightCorner: c.br,
        });
        return new Promise((res) => {
          warped.toBlob((blob) => {
            const base = (file.name || 'comprobante').replace(/\.[^.]+$/, '');
            res(new File([blob], base + '.jpg', { type: 'image/jpeg' }));
          }, 'image/jpeg', JPEG_QUALITY);
        });
      }

      // —— Wiring de controles ——
      function setFilter(f) {
        state.filter = f;
        els.chips.forEach((ch) => ch.classList.toggle('active', ch.dataset.filter === f));
        render();
      }
      els.chips.forEach((ch) => {
        const fn = () => setFilter(ch.dataset.filter);
        ch.addEventListener('click', fn);
        cleanups.push(() => ch.removeEventListener('click', fn));
      });

      const onRotate = () => {
        state.rotation = (state.rotation + 90) % 360;
        showLoading('Detectando bordes…');
        // ceder el hilo para que pinte el loader
        setTimeout(() => {
          buildSrc(); detectCorners(); layout(); render(); hideLoading();
        }, 16);
      };
      els.rotate.addEventListener('click', onRotate);
      cleanups.push(() => els.rotate.removeEventListener('click', onRotate));

      const onCancel = () => finish(null);
      els.cancel.addEventListener('click', onCancel);
      cleanups.push(() => els.cancel.removeEventListener('click', onCancel));

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

      const onResize = () => { layout(); render(); };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      els.handles.forEach(bindHandle);

      function showLoading(txt) {
        els.loadTxt.textContent = txt || 'Cargando…';
        els.loading.classList.remove('hidden');
      }
      function hideLoading() { els.loading.classList.add('hidden'); }

      // —— Arranque ——
      (async () => {
        document.body.classList.add('scan-open');
        els.editor.classList.remove('hidden');
        setFilter('color');
        els.chips.forEach((ch) => ch.classList.toggle('active', ch.dataset.filter === 'color'));
        showLoading('Cargando escáner…');
        try {
          await ensureLibs();
          state.baseImg = await fileToImage(file);
          showLoading('Detectando bordes…');
          await new Promise((r) => setTimeout(r, 16));
          buildSrc();
          detectCorners();
          layout();
          render();
          hideLoading();
        } catch (err) {
          hideLoading();
          fail(err);   // el llamador adjunta la foto original como fallback
        }
      })();
    });
  }

  window.openScanner = openScanner;
})();
