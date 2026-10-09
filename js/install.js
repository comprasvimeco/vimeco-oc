/* Botón "Instalar" en Android (Chrome, Edge, Samsung Internet), en el login y en el menú.

   El navegador avisa con `beforeinstallprompt` sólo si la app se puede instalar y
   todavía no está instalada, así que abierta desde el ícono o ya instalada no
   aparece. "Ahora no" lo pospone dos semanas, en todas las páginas a la vez.

   Uso: initInstalar(aviso, botonInstalar, botonAhoraNo). El aviso arranca con
   la clase `hidden`; al cerrarse se le pone `saliendo` y, después, `hidden`. */
(function () {
  const LATER_KEY = 'vimeco_install_later';

  window.initInstalar = function (banner, btn, later) {
    if (!/Android/i.test(navigator.userAgent)) return;
    let pedido = null;
    const cerrar = () => {
      banner.classList.add('saliendo');
      setTimeout(() => banner.classList.add('hidden'), 300);
    };
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      pedido = e;
      let pospuesto = 0;
      try { pospuesto = parseInt(localStorage.getItem(LATER_KEY) || '0', 10); } catch (_) {}
      if (Date.now() - pospuesto < 14 * 864e5) return;
      banner.classList.remove('hidden', 'saliendo');
    });
    window.addEventListener('appinstalled', () => { pedido = null; cerrar(); });
    btn.addEventListener('click', async () => {
      if (!pedido) return cerrar();
      const p = pedido;
      pedido = null;
      p.prompt();
      try { await p.userChoice; } catch (_) {}
      cerrar();
    });
    later.addEventListener('click', () => {
      try { localStorage.setItem(LATER_KEY, String(Date.now())); } catch (_) {}
      cerrar();
    });
  };
})();
