# Runbook — Revenue Ops (Host Medellín)

## Desarrollo local

```
python3 -m http.server 8000    # o: npx serve
```

Abre `http://localhost:8000/index.html`. **No abras el archivo con doble-clic**
(`file://`) — Chrome bloquea los `import` de módulos ES por CORS bajo `file://`.
GitHub Pages (https) no tiene este problema.

## Tests y lint

```
npm test        # node --test — corre todo tests/*.test.js (unitarios, sin dependencias)
npm run lint    # node --check en src/, tests/, e2e/
npm run test:e2e  # Playwright — navegador real, requiere: npx playwright install --with-deps chromium
```

Los tres deben estar en verde antes de cualquier merge a `main`. CI (GitHub
Actions, `.github/workflows/ci.yml`, jobs `unit` y `e2e`) corre los tres en
cada push/PR — el job `e2e` sube el reporte de Playwright como artefacto si
falla.

`npm run test:e2e` levanta el mismo servidor estático de desarrollo local
(`python3 -m http.server`) — no es un build step nuevo, Playwright solo
automatiza un navegador real contra el sitio estático de siempre.

## Checklist de QA manual (complemento del E2E automatizado)

El E2E (`e2e/smoke.spec.js`) cubre carga limpia, Simulador, bloqueo de
validación, guardar/cargar/eliminar con confirmación, importación con payload
XSS (verifica que no se ejecuta), y la matriz. Para cambios que el E2E no
cubre todavía, corre esto a mano en un navegador real:

1. **Carga limpia**: abre la app, confirma cero errores en consola.
2. **KPIs por defecto — SÍ deben mostrar "—" (ronda 2)**: una unidad nueva usa LM
   modo automático sin verificar → Min Price/Base Price arrancan en "—" con un
   aviso "LM SIN VERIFICAR" que explica qué confirmar y dónde. Esto es
   correcto, no un bug. Para ver números: en "Last-Minute de PriceLabs" cambia
   el modo a uno configurable (plano/gradual/precio fijo/tramos) y marca
   "Confirmé este modo directamente en PriceLabs".
3. **Alertas**: pestaña Comparación muestra al menos un veredicto por ventana;
   ninguna alerta rota (texto `undefined`/`NaN`); ninguna fila dice "RENTABLE EN
   TODOS" mientras el LM siga sin verificar.
4. **Simulador**: cambia canal/días/noches, confirma que el desglose
   paso-a-paso se actualiza y que Margen/Markup muestran números distintos.
5. **Editar un descuento**: activa/desactiva un descuento, cambia su %, confirma
   que KPIs y alertas se recalculan sin recargar la página.
6. **Guardar/Cargar/Eliminar unidad**: guarda una unidad con nombre real,
   recárgala, confirma que los datos vuelven exactos. Intenta eliminarla y
   confirma que pide confirmación antes de borrar.
7. **Exportar/Importar**: exporta, borra la unidad de prueba, impórtala de
   vuelta, confirma que los datos coinciden.
8. **Validación de edición manual (ronda 2)**: mete una comisión de canal en
   150% a propósito — el campo debe RECHAZAR el valor de inmediato (vuelve al
   número anterior, aparece un aviso flotante con el motivo exacto), nunca
   escribirlo a `state` ni convertirlo en 0 en silencio. Prueba también un
   rango invertido (ej. "hasta" antes que "desde" en un descuento) y un campo
   vacío.
9. **Bloqueo de datos de ejemplo**: en una unidad nueva (sin tocar Costos),
   confirma que aparece el aviso "EJEMPLO" en Resumen.
10. **Matriz — detalle por fila**: abre "Ver por canal" en cualquier ventana,
    confirma que "Peor payout real detectado" muestra un día y noches reales
    (nunca "undefined").

## Rollback

Todo este trabajo vive en `fix/motor-financiero-auditoria`, nunca se hizo push
ni se tocó `main`. Si necesitas revertir:

- **Antes de mergear a main**: no hay nada que revertir en `main` — simplemente
  no mergees la rama, o bórrala si decides no usarla
  (`git branch -D fix/motor-financiero-auditoria`, solo con tu confirmación).
- **Después de mergear a main** (si algo sale mal en producción): `git revert`
  del commit de merge es más seguro que `git reset --hard` (no reescribe
  historia ya publicada). GitHub Pages redepliega automáticamente al siguiente
  push a `main`.
- **Datos de una unidad corrompidos**: usa Exportar ANTES de cualquier cambio
  grande — el `.json` de respaldo permite restaurar exactamente el estado
  anterior vía Importar. El botón "Migrar unidades antiguas" (Fase 6) nunca
  borra `v2:*`, así que los datos originales en formato viejo siempre quedan
  disponibles como red de seguridad aunque la migración a v3 falle o se repita.

## Despliegue

Sin cambios respecto al proceso de siempre: push a `main` → GitHub Pages sirve
el sitio estático automáticamente. Ningún paso de esta auditoría requiere build.

## Pendiente (no completado en esta ronda, para no sobre-reportar)

- **Accesibilidad**: se corrigieron los controles nuevos sin texto visible
  (editor de tramos de Last-Minute). El resto del formulario (pre-existente)
  usa `<span>` en vez de `<label for>` — funciona visualmente pero un lector de
  pantalla no asocia la etiqueta al campo. Auditoría completa de accesibilidad
  del formulario original queda pendiente si la priorizas.
