/* ─────────────────────────────────────────────────────────────────────────
 * scanner.js — Escáner de comprobantes estilo CamScanner (Nivel 2)
 *
 * API pública:
 *   window.openScanner(file) -> Promise<File|null>
 *     Abre el editor sobre la foto recibida. Resuelve con un File JPEG
 *     (perspectiva corregida + filtro) o null si el usuario cancela.
 *     Rechaza ante error duro (no se pudieron cargar las librerías/imagen).
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
        src:      document.createElement('canvas'), // imagen de trabajo (plana, rotada, capada)
        corners:  null,   // {tl,tr,br,bl} en px de state.src
        scale:    1,      // px display / px src
      };

      // —— Limpieza / salida ——
      const cleanups = [];
      function teardown() {
        cleanups.forEach((fn) => { try { fn(); } catch (_) {} });
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

      // —— Detección de bordes (copia chica, validada; fallback recorte completo) ——
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
              const q = { tl: up(pts[0]), tr: up(pts[1]), br: up(pts[2]), bl: up(pts[3]) };
              // descartar cuadriláteros degenerados
              const ok = dist(q.tl, q.tr) > w * 0.15 && dist(q.bl, q.br) > w * 0.15 &&
                         dist(q.tl, q.bl) > h * 0.15 && dist(q.tr, q.br) > h * 0.15;
              if (ok) { state.corners = q; return; }
            }
          }
        } catch (_) { /* fallback */ }
        finally {
          if (contour) { try { contour.delete(); } catch (_) {} }
          if (mat)     { try { mat.delete();     } catch (_) {} }
        }
        state.corners = fallback;
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

      // —— Layout: dimensiona display y posiciona manijas ——
      function layout() {
        const w = state.src.width, h = state.src.height;
        const toolbarH = 132;
        const maxW = Math.min(window.innerWidth - 24, 1000);
        const maxH = Math.max(160, window.innerHeight - toolbarH - 24);
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
          try { el.setPointerCapture(ev.pointerId); } catch (_) {}
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
            try { detectCorners(); positionHandles(); drawQuad(); }
            catch (_) { /* se queda con recorte completo */ }
            finally { hideLoading(); }
          }, 30);
        }, 16);
      }

      // —— Controles ——
      function setFilter(f) {
        state.filter = f;
        els.chips.forEach((ch) => ch.classList.toggle('active', ch.dataset.filter === f));
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

      const onResize = () => { if (state.corners) { layout(); render(); } };
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      els.handles.forEach(bindHandle);

      // —— Arranque ——
      (async () => {
        document.body.classList.add('scan-open');
        els.editor.classList.remove('hidden');
        setFilter('color');
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
