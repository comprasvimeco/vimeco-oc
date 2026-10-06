/* global FIREBASE_CONFIG, PUSH_CONFIG, firebase, patchUsuario */
/* Notificaciones push de autorizaciones.

   El dispositivo se suscribe con Firebase Cloud Messaging (sólo el SDK de
   Messaging, cargado a demanda) y guarda su token en
   /usuarios/{codigo}/pushTokens/{id}. Para avisar, la app le pasa el código del
   destinatario a un Apps Script (apps-script/notificaciones.gs), que busca sus
   tokens y envía por la API de FCM: desde el navegador no se puede firmar el
   envío ni llamar a FCM directo. Lo que se ve lo dibuja sw.js (evento 'push').

   Sin PUSH_CONFIG completo en js/config.js todo esto no hace nada. */
(function () {
  const SDK    = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const LS_KEY = 'vimeco_push_token';

  const cfg         = () => (typeof PUSH_CONFIG !== 'undefined' && PUSH_CONFIG) || {};
  const configurado = () => !!(cfg().vapidKey && cfg().relayUrl);
  const esIOS       = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada   = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function _cargar(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload  = resolve;
      s.onerror = () => reject(new Error('No cargó ' + src));
      document.head.appendChild(s);
    });
  }

  let _msg = null;
  async function _messaging() {
    if (_msg) return _msg;
    if (!window.firebase) await _cargar(SDK + 'firebase-app-compat.js');
    if (!firebase.messaging) await _cargar(SDK + 'firebase-messaging-compat.js');
    if (!(await firebase.messaging.isSupported())) return null;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _msg = firebase.messaging();
    return _msg;
  }

  // Id corto y estable del token, para usarlo de clave en la base.
  async function _id(token) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function _registrar(codigo) {
    const m = await _messaging();
    if (!m) return false;
    const reg   = await navigator.serviceWorker.ready;
    const token = await m.getToken({ vapidKey: cfg().vapidKey, serviceWorkerRegistration: reg });
    if (!token) return false;
    const id = await _id(token);

    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(LS_KEY)); } catch (_) {}
    // Mismo usuario y mismo token: se reescribe una vez por semana nada más.
    if (prev && prev.codigo === codigo && prev.id === id && Date.now() - prev.ts < 7 * 864e5) return true;
    // El token anterior de este equipo era de otro usuario (o FCM lo rotó):
    // si quedara, el aviso le seguiría llegando acá al otro.
    if (prev && prev.codigo && prev.id && (prev.codigo !== codigo || prev.id !== id)) {
      fetch(FIREBASE_CONFIG.databaseURL + '/usuarios/' + prev.codigo + '/pushTokens/' + prev.id + '.json',
        { method: 'DELETE' }).catch(() => {});
    }
    await patchUsuario(codigo, { ['pushTokens/' + id]: { token, ts: Date.now(), ios: esIOS() } });
    try { localStorage.setItem(LS_KEY, JSON.stringify({ codigo, id, ts: Date.now() })); } catch (_) {}
    return true;
  }

  // 'sin-config' | 'ios-instalar' | 'no-soportado' | 'pedir' | 'activas' | 'bloqueadas'
  // En iPhone las notificaciones sólo existen con la app agregada a la pantalla de inicio.
  window.pushEstado = function () {
    if (!configurado()) return 'sin-config';
    if (esIOS() && !instalada()) return 'ios-instalar';
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'no-soportado';
    if (Notification.permission === 'granted') return 'activas';
    if (Notification.permission === 'denied')  return 'bloqueadas';
    return 'pedir';
  };

  // Con el permiso ya dado, mantiene el token de este equipo al día.
  window.initPush = async function (codigo) {
    const estado = pushEstado();
    if (estado === 'activas' && codigo) {
      try { await _registrar(codigo); } catch (e) { console.warn('push/init:', e); }
    }
    return estado;
  };

  // Llamar desde un toque del usuario: iOS sólo deja pedir el permiso así, y
  // por eso requestPermission va antes de cualquier await.
  window.activarPush = async function (codigo) {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return false;
    return _registrar(codigo);
  };

  // Aviso a otro usuario, sin esperar respuesta: si falla, la bandeja y el
  // globito del menú siguen funcionando como siempre. text/plain + no-cors
  // evitan el preflight, que Apps Script no contesta.
  window.notificarUsuario = function (codigo, aviso) {
    if (!configurado() || !codigo) return;
    try {
      fetch(cfg().relayUrl, {
        method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ to: codigo, ...aviso })
      }).catch(() => {});
    } catch (_) {}
  };

  // Número sobre el ícono de la app instalada (donde el sistema lo soporte).
  window.ponerBadge = function (n) {
    try {
      const p = n > 0 ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.();
      if (p && p.catch) p.catch(() => {});
    } catch (_) {}
  };
})();
