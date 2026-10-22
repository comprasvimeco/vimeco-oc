# VIMECO OC — Instrucciones para Claude Code

## Versión en commits

El hook `.githooks/prepare-commit-msg` **inyecta automáticamente** el número de versión deployada en cada commit. No es necesario calcularlo manualmente.

El hook lee la versión actual de `menu.html` (`menu-version`), suma 1, y la inserta en el mensaje:

```
feat: descripción  →  feat: v081 descripción
```

### Si el hook no funciona (nueva clon / reinstalación)
```
git config core.hooksPath .githooks
```

### Regla de proceso para commits
1. **Siempre hacer `git pull --rebase` antes de `git commit`** para asegurar que la versión leída en `menu.html` es la última bumpeada por CI.
2. El hook se encarga del número; solo escribir la descripción en el mensaje.

---

## Stack y estructura

PWA estática (HTML/CSS/JS). Deploy en GitHub Pages vía GitHub Actions (`deploy.yml`).

- `build.js` — incrementa la versión en `menu.html` (la fuente) y copia el número a `caja.html`, `perfil.html` e `index.html`; inyecta secrets
- `deploy.yml` — hace `git add app.html caja.html menu.html index.html sw.js` después del build y commitea el bump
  (`perfil.html` no está en la lista: el sitio publicado lleva su número, pero en el repo queda uno atrás)
- Versión sincronizada: todas esas páginas tienen siempre el mismo número. `app.html` no muestra versión

## Drive — estructura de carpetas

`COMPRAS`, `CAJAS`, `PERSONAL` y `EQUIPOS` son carpetas hermanas (mismo nivel).

```
COMPRAS/
  OBRAS/{Obra}/{YYYY-MM-DD | Proveedor}/
  PROVEEDORES/{Proveedor}/{YYYY-MM-DD | Proveedor}/
CAJAS/{Usuario}/{YYYY-MM}/Fotos|Archivos|planilla.xlsx
PERSONAL/...
EQUIPOS/{Código - Descripción}/archivos   ← documentación de cada equipo (ficha)
```

IDs de OBRAS/PROVEEDORES/CAJAS/EQUIPOS se cachean en Firebase `/drive_config/`.
Los documentos de cada equipo se indexan en `/equipos_docs/{key}` (`folderId` + `archivos`).

**Archivo** (`archivo.html` + `js/archivo.js`, permiso `archivo`, siempre para `0000`) muestra los
archivos de Compras por mes, obra o proveedor → OC → archivos, con la estética de la pantalla Archivo
de Leva. No tiene índice propio: se arma con `/historial` (carpetas, `fuenteUrl`, `adjuntos`) y
`/remitos` (`drive`), y lista en Drive sólo la carpeta de OBRAS de las OC que se ven (para encontrar
el PDF `OC_{nro}_…` y el presupuesto). Esa carpeta la comparten las OC del mismo proveedor y día: lo
que no se puede atribuir va en «En la misma carpeta de Drive». El visor baja con `bajarDriveArchivo`.
En la OC abierta, «Cargar archivo» (o soltar un archivo encima, o los huecos «Falta …») abre una hoja para
cargar ahí mismo factura, remito (N°, fecha y cantidades), presupuesto u otro: guarda igual que Facturas,
Remitos y la autorización (`adjuntos`, `/remitos` + `entrega` + planillas, `fuenteUrl`), sin la cola offline.

`CAJAS` y `PERSONAL` originalmente vivían dentro de COMPRAS. Una migración única
best-effort (`_ensureOutsideCompras` en `js/drive.js`, guardada por los flags
`/drive_config/cajasMovedOut` y `personalMovedOut`) las mueve al padre de COMPRAS.

**Borrador de archivos** (`js/borradorArchivo.js`, traído de Leva): el archivo elegido en Facturas y el remito
a medio cargar (foto + N°, fecha, observaciones, cantidades) quedan en IndexedDB del dispositivo, por usuario,
hasta subirlos o descartarlos a propósito (vence a los 7 días): salir sin querer de la pantalla no los pierde.

## Caja Chica — lógica por mes

- Todo filtrado por mes (sin opción "Todos los movimientos")
- **Saldo = Excedente anterior + Ingresos del mes − Egresos del mes** (con arrastre acumulado).
  El "Excedente anterior" es el neto de todos los movimientos de meses previos al seleccionado.
- El Excel sincronizado a Drive refleja el mismo cálculo (fila "Excedente anterior" + saldo acumulado)
- Excel se sincroniza automáticamente a Drive tras cada movimiento
- Ingresos y Egresos guardan **fecha puntual** (el mes del arrastre sale de esa fecha).
  Hasta v145 el Ingreso elegía mes y se guardaba como día 1: los ingresos previos tienen fecha `-01`.
- Cada **Egreso** se imputa a una **obra** (obligatoria, lista de `/obras` activas). Los egresos
  previos a v146 no tienen obra: se muestran como "—" y suman en "Sin obra" en el Excel.

## Reportes (rediseño traído de Leva)

`reportes.html` con pestañas **Resumen** (admins abren acá: frase de 30 días y «Para mirar»), **Tablero**,
**Obras** (+ ficha de obra con `?ficha={key}`) y **Explorar** (período, gráficos y lista de OC; `?obra=` / `?equipo=`).
JS: `reportes.js` (Explorar y ficha de OC), `reportesObras.js` (pestañas, navegación, obras y su ficha),
`reportesTablero.js`, `reportesResumen.js` (con `tests/resumen.test.js`). Sólo OC firmes, desde el corte de Drive
y sin las de prueba (`esOCPrueba` en `driveBackup.js`); totales en pesos al oficial de cada OC.
- **Presupuesto y plazo** de obra (`js/presupuesto.js`, `tests/presupuesto.test.js`): `/obras/{k}/presupuesto`
  `{moneda, total, rubros?}` y `/obras/{k}/plazo` `{inicio, n, unidad}`, opcionales. Se cargan en la ficha de Obras
  y en la ficha de obra de Reportes. Estilos `.pres-*` en `styles.css`.
- Lo operativo que estaba en Reportes (OC duplicadas, «Unificar obras», eliminar OC) pasó a **Novedades**
  (`js/novedadesDatos.js`). Salieron la pestaña Proveedores, la moneda USD/blue y el rango libre.
  Los egresos de Caja no suman al gasto de obra en Reportes (sólo OC).

## Navegación

- `menu.html` (raíz) → dos secciones: **Compras** (`compras.html`) y **Caja** (`caja.html`)
- `compras.html` → submenú: Órdenes de Compra (`app.html`), Facturas (`facturas.html`), Historial (`historial.html`)
- El logo/header de las páginas de Compras vuelve a `compras.html`; el de Caja vuelve a `menu.html`
- `menu.html` → **Archivo** (`archivo.html`), para `0000` y el permiso `archivo`.
- **Perfil** (`perfil.html` + `js/perfil.js`, traído de Leva): se entra tocando la pastilla del nombre en el
  header de cualquier pantalla (`js/ui.js`). Tiene la firma (`/firmas/{código}`, antes en el menú ☰ de la OC),
  «Tu nombre en las OC» (`/usuarios/{código}/nombreOC`, va debajo de la firma en el PDF; las listas siguen con
  `nombre`; caché en `localStorage` vía `nombreOCGuardado`), qué puede hacer cada uno, notificaciones y
  Cerrar sesión (ya no está en el menú). Al autorizar se guarda `autorizacion.firmanteOC` (el nombre del PDF).
  `app.html` ya no tiene menú ☰ ni versión.
- `menu.html` → **Proveedores** (`proveedores.html`, para todos): ficha editable de cada proveedor, artículos
  comprados con el último precio y comparación por artículo. Lo tildado abre `app.html` precargado vía
  `sessionStorage.oc_desde_proveedor` (`loadOCDesdeProveedor`). Todos ven precios por unidad; no se muestran
  totales de OC ni cantidades de compras ajenas (salvo admins).
