/* VIMECO S.A. — Barra de letras: hace de barra de desplazamiento de una lista en
   orden alfabético (la misma de Archivo, Por proveedor). El tirador marca lo que
   se ve, cada letra va a la altura donde empieza su inicial (corridas lo justo
   para que no se pisen) y se resalta la de lo que está arriba de todo, o la del
   renglón elegido (`elegido`, un selector dentro de `caja`) mientras se lo vea.
   Tocar una letra salta a ella; arrastrar recorre la lista de forma continua con una
   burbuja grande con la letra.
   En la compu se desplaza `caja` (la lista, con su propio scroll); en el
   teléfono, la página, y la barra va fija al borde de la pantalla. */

function letraDe(s) {
  const c = String(s || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

// Las barras visibles en el teléfono esconden la barra nativa de la página.
const _barrasEnPagina = new Set();

function barraLetras(nav, { caja, ancho, margenTel = 72, elegido = '' }) {
  let m = null;                 // { sc, H, max, th, an: [{ l, b, a, p, y }], activa }
  let destino = () => null;     // letra → primer renglón con esa inicial

  const desplazador = () => ancho.matches
    ? { pos: el => el.offsetTop, total: caja.scrollHeight, vista: caja.clientHeight,
        get: () => caja.scrollTop, set: v => { caja.scrollTop = v; } }
    : { pos: el => el.getBoundingClientRect().top + scrollY - margenTel,
        total: document.documentElement.scrollHeight, vista: innerHeight,
        get: () => scrollY, set: v => scrollTo(0, v) };

  // `letras` en el orden de la lista; con menos de dos no hay barra.
  function poner(letras, dest) {
    destino = dest;
    const hay = letras.length > 1;
    nav.classList.toggle('hidden', !hay);
    nav.parentElement.classList.toggle('con-abc', hay);
    nav.innerHTML = hay ? '<span class="abc-th"></span>' +
      letras.map(c => `<button type="button" data-letra="${c}">${c}</button>`).join('') +
      '<span class="abc-bu" aria-hidden="true"></span>' : '';
    armar();
  }

  // Ubica letras y tirador. Va de nuevo cuando cambia el tamaño o se muestra.
  function armar() {
    const ve = nav.childElementCount > 0 && nav.getClientRects().length > 0;
    caja.classList.toggle('abc-sin-nativa', ve && ancho.matches);
    if (ve && !ancho.matches) _barrasEnPagina.add(nav); else _barrasEnPagina.delete(nav);
    document.documentElement.classList.toggle('abc-sin-barra', _barrasEnPagina.size > 0);
    m = null;
    if (!ve) return;
    const sc = desplazador(), H = nav.clientHeight, max = Math.max(1, sc.total - sc.vista);
    const th = Math.min(H, Math.max(28, H * sc.vista / sc.total));
    const bs = [...nav.querySelectorAll('[data-letra]')];
    const paso = Math.min(17, H / bs.length);
    const an = bs.map(b => {
      const el = destino(b.dataset.letra);
      const p = el ? sc.pos(el) : 0, a = Math.max(0, Math.min(max, p));
      return { l: b.dataset.letra, b, a, p, y: th / 2 + a / max * (H - th) };
    });
    an.forEach((x, i) => { x.y = Math.max(x.y, paso / 2, i ? an[i - 1].y + paso : 0); });
    for (let i = an.length - 1; i >= 0; i--) an[i].y = Math.min(an[i].y, i < an.length - 1 ? an[i + 1].y - paso : H - paso / 2);
    an.forEach(x => { x.b.style.top = (x.y - paso / 2) + 'px'; x.b.style.height = paso + 'px'; });
    nav.querySelector('.abc-th').style.height = th + 'px';
    m = { sc, H, max, th, an, activa: '' };
    seguir();
  }

  function seguir() {
    if (!m) return;
    const s = m.sc.get();
    nav.querySelector('.abc-th').style.transform = `translateY(${Math.min(1, s / m.max) * (m.H - m.th)}px)`;
    let act = m.an[0];
    m.an.forEach(x => { if (x.a <= s + 4) act = x; });
    // La lista va en orden: la letra del elegido es la última que empieza antes que él.
    const el = elegido && caja.querySelector(elegido);
    if (el) {
      const p = m.sc.pos(el);
      if (p >= s - 4 && p + el.offsetHeight <= s + m.sc.vista + 4) act = m.an.filter(x => x.p <= p + 1).pop() || act;
    }
    if (act.l !== m.activa) {
      m.an.forEach(x => x.b.classList.toggle('on', x === act));
      m.activa = act.l;
      const bu = nav.querySelector('.abc-bu');
      bu.textContent = act.l;
      bu.style.top = act.y + 'px';
    }
  }

  // Altura en la barra → desplazamiento, por tramos entre las letras.
  function desplDeY(y) {
    const p = [{ y: 0, a: 0 }, ...m.an, { y: m.H, a: m.max }];
    for (let i = 1; i < p.length; i++)
      if (y <= p[i].y) return p[i - 1].a + (p[i].a - p[i - 1].a) * (p[i].y > p[i - 1].y ? (y - p[i - 1].y) / (p[i].y - p[i - 1].y) : 1);
    return m.max;
  }

  function irA(l) {
    const x = m && m.an.find(z => z.l === l);
    if (x) { m.sc.set(x.a); seguir(); }
  }

  // Arrastrar por la barra (dedo o mouse) recorre la lista.
  nav.addEventListener('pointerdown', e => {
    if (!m) return;
    e.preventDefault();
    nav.setPointerCapture(e.pointerId);
    nav.classList.add('arrastra');
    // El tamaño en pantalla puede no ser el de CSS (zoom en monitores grandes).
    const mover = ev => { const r = nav.getBoundingClientRect(); m.sc.set(desplDeY((ev.clientY - r.top) * m.H / r.height)); seguir(); };
    const letra = e.target.closest('[data-letra]');
    if (letra) irA(letra.dataset.letra); else mover(e);
    const fin = () => {
      nav.classList.remove('arrastra');
      nav.removeEventListener('pointermove', mover); nav.removeEventListener('pointerup', fin); nav.removeEventListener('pointercancel', fin);
    };
    nav.addEventListener('pointermove', mover);
    nav.addEventListener('pointerup', fin);
    nav.addEventListener('pointercancel', fin);
  });
  // Con el teclado (Enter sobre una letra).
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-letra]');
    if (b && e.detail === 0) irA(b.dataset.letra);
  });
  const alDesplazar = () => requestAnimationFrame(seguir);
  caja.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('scroll', alDesplazar, { passive: true });
  window.addEventListener('resize', () => armar());

  return { poner, armar };
}
