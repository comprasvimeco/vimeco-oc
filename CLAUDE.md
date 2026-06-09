# VIMECO OC — Instrucciones para Claude Code

## Versión en commits

El hook `.githooks/prepare-commit-msg` **inyecta automáticamente** el número de versión deployada en cada commit. No es necesario calcularlo manualmente.

El hook lee la versión actual de `app.html` (`hdr-drop-version`), suma 1, y la inserta en el mensaje:

```
feat: descripción  →  feat: v081 descripción
```

### Si el hook no funciona (nueva clon / reinstalación)
```
git config core.hooksPath .githooks
```

### Regla de proceso para commits
1. **Siempre hacer `git pull --rebase` antes de `git commit`** para asegurar que la versión leída en `app.html` es la última bumpeada por CI.
2. El hook se encarga del número; solo escribir la descripción en el mensaje.

---

## Stack y estructura

PWA estática (HTML/CSS/JS). Deploy en GitHub Pages vía GitHub Actions (`deploy.yml`).

- `build.js` — incrementa versión en `app.html` y `caja.html`, inyecta secrets
- `deploy.yml` — hace `git add app.html caja.html sw.js` después del build y commitea el bump
- Versión sincronizada: `app.html` y `caja.html` siempre tienen el mismo número

## Drive — estructura de carpetas

```
COMPRAS/
  OBRAS/{Obra}/{YYYY-MM-DD | Proveedor}/
  PROVEEDORES/{Proveedor}/{YYYY-MM-DD | Proveedor}/
  CAJAS/{Usuario}/{YYYY-MM}/Fotos|Archivos|planilla.xlsx
```

IDs de OBRAS/PROVEEDORES/CAJAS se cachean en Firebase `/drive_config/`.

## Caja Chica — lógica por mes

- Todo filtrado por mes (sin opción "Todos los movimientos")
- Saldo = ingresos del mes - gastos del mes (no acumulado histórico)
- Excel se sincroniza automáticamente a Drive tras cada movimiento
- Recargas almacenan fecha como primer día del mes seleccionado
