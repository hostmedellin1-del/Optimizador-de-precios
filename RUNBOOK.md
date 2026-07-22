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
npm test    # node --test — corre todo tests/*.test.js
npm run lint  # node --check en src/ y tests/
```

Ambos deben estar en verde antes de cualquier merge a `main`. CI (GitHub
Actions, `.github/workflows/ci.yml`) corre lo mismo en cada push/PR.

## Checklist de QA manual (E2E) antes de desplegar

No hay E2E automatizado en CI todavía (ver "Pendiente" abajo) — hasta que se
agregue, corre esto a mano en un navegador real después de cualquier cambio:

1. **Carga limpia**: abre la app, confirma cero errores en consola.
2. **KPIs por defecto**: Resumen muestra Min Price y Base Price (no "—" a menos
   que hayas metido un dato inválido a propósito).
3. **Alertas**: pestaña Comparación muestra al menos un veredicto por ventana;
   ninguna alerta rota (texto `undefined`/`NaN`).
4. **Simulador**: cambia canal/días/noches, confirma que el desglose
   paso-a-paso se actualiza y que Margen/Markup muestran números distintos.
5. **Editar un descuento**: activa/desactiva un descuento, cambia su %, confirma
   que KPIs y alertas se recalculan sin recargar la página.
6. **Guardar/Cargar/Eliminar unidad**: guarda una unidad con nombre real,
   recárgala, confirma que los datos vuelven exactos. Intenta eliminarla y
   confirma que pide confirmación antes de borrar.
7. **Exportar/Importar**: exporta, borra la unidad de prueba, impórtala de
   vuelta, confirma que los datos coinciden.
8. **Validación**: mete una comisión de canal en 150% a propósito — confirma
   que aparece el banner de bloqueo y los KPIs muestran "—", no un número roto.
9. **Bloqueo de datos de ejemplo**: en una unidad nueva (sin tocar Costos),
   confirma que aparece el aviso "EJEMPLO" en Resumen.

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

- **E2E automatizado en CI**: hoy es un checklist manual (arriba). Agregar
  Playwright real a CI es una decisión de dependencias (~300MB de Chromium en
  el pipeline) que no se tomó unilateralmente — pregúntame si lo quieres.
- **Accesibilidad**: se corrigieron los controles nuevos sin texto visible
  (editor de tramos de Last-Minute). El resto del formulario (pre-existente)
  usa `<span>` en vez de `<label for>` — funciona visualmente pero un lector de
  pantalla no asocia la etiqueta al campo. Auditoría completa de accesibilidad
  del formulario original queda pendiente si la priorizas.
