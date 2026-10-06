# Notificaciones push — instalación del Apps Script

La app avisa por push cuando a alguien le piden una autorización y cuando su pedido
se aprueba o se rechaza. El envío lo hace `notificaciones.gs`, publicado como web app
de Google Apps Script. Mientras `PUSH_CONFIG` en `js/config.js` esté vacío, la app no
muestra nada de esto.

## 1. Firebase (consola, proyecto `vimeco-oc`)

1. **Configuración del proyecto → Cloud Messaging.** Confirmar que *Firebase Cloud
   Messaging API (V1)* figure habilitada.
2. En la misma pestaña, **Configuración web → Certificados de push web → Generar par de
   claves**. Copiar la clave pública: es el `vapidKey`.
3. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada.**
   Se descarga un `.json`. No va al repo.

## 2. Apps Script

1. En <https://script.google.com>, crear un **proyecto nuevo** (por ejemplo, "VIMECO notificaciones").
2. Reemplazar el contenido de `Código.gs` por el de `notificaciones.gs`.
3. **Configuración del proyecto (engranaje) → Propiedades de la secuencia de comandos →
   Agregar:** nombre `SERVICE_ACCOUNT`, valor = el contenido completo del `.json` del paso 1.3.
4. En el editor, elegir la función `probar` y **Ejecutar**. La primera vez pide permisos:
   aceptarlos. Con 0 dispositivos registrados el log muestra `{"ok":true,"enviados":0}`.
5. **Implementar → Nueva implementación → Aplicación web.**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**

   Copiar la URL que termina en `/exec`: es el `relayUrl`.

## 3. La app

Completar en `js/config.js`:

```js
var PUSH_CONFIG = {
  vapidKey: "<clave pública del paso 1.2>",
  relayUrl: "<URL /exec del paso 2.5>"
};
```

Si después se cambia el código del script, hay que hacer **Implementar → Administrar
implementaciones → editar → Versión nueva**. Así la URL no cambia.

## Uso

- En el menú aparece un aviso con un botón **Activar**. Cada persona lo toca en cada
  dispositivo donde quiera recibir notificaciones.
- **iPhone/iPad:** sólo funciona con la app agregada a la pantalla de inicio
  (Safari → Compartir → *Agregar a inicio*), con iOS 16.4 o posterior, y abriéndola desde
  ese ícono. El menú lo explica cuando detecta Safari sin la app instalada.
