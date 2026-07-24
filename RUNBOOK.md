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
11. **LM precio fijo (ronda 3)**: configura Last-Minute en "Precio fijo" con un
    rango que incluya el día 45 (ej. 40-50) — Base Price debe mostrar "—" con
    el aviso "PRECIO FIJO ACTIVO — BASE NO APLICA", y el Offset sugerido de
    cada canal debe seguir mostrando un número (no bloqueado), con la nota de
    que se calculó sobre el precio fijo real. El botón "Ver el paso a paso" NO
    debe precargar ningún precio mientras esto esté bloqueado.
12. **Verificación de datos financieros (Fase 5)**: en una unidad nueva, verifica
    el LM (modo plano + casilla "Confirmé..."). Min Price/Base Price deben SEGUIR
    en "—" (ahora por "dato financiero sin verificar", no por LM) mientras Booking
    (Genius+Mobile+comisión bancaria), Expedia (VIP) y la comisión bancaria de
    Directo sigan sin marcar. Marca "Verificado" en Resumen → "Verificación de
    datos financieros" para UN solo dato y confirma que solo se desbloquea lo que
    ese dato afecta (no todo a la vez). La Matriz nunca debe decir "RENTABLE EN
    TODOS" mientras falte alguno.
13. **Rentabilidad mensual (planificación mensual)**: llena la calculadora de
    costos detallada (Resumen → "Costos por noche") y confirma que "Rentabilidad
    mensual y punto de equilibrio" deja de decir "NO CALCULABLE". Prueba un neto
    manual bajo (que la contribución por noche quede <= 0) y confirma que dice
    "EQUILIBRIO NO ALCANZABLE" (nunca un número de noches roto o "Infinity").
    Activa el reparto Propietario/PM, pon Propietario+Administrador sumando más
    de 100% y confirma que vuelve a "NO CALCULABLE" con el motivo exacto.
    Desactívalo de nuevo y confirma que la utilidad vuelve a mostrarse completa
    (sin restar una reserva/impuesto que quedó configurado de antes).
14. **Piso/Base globales bloqueados por CUALQUIER canal pendiente (P1)**: en una unidad
    nueva, verifica LM (modo plano + "Confirmé...") y resuelve TODOS los datos financieros
    de Booking/Expedia/Airbnb en "Verificación de datos financieros", pero deja SIN
    confirmar la comisión bancaria de Directo (déjala en su default). Min Price/Base Price
    deben seguir en "—" aunque Directo no sea hoy el canal que fija esos números — el aviso
    en Resumen debe mencionar explícitamente a Directo y la palabra "GLOBAL". Confirma esa
    última comisión y verifica que Min Price/Base Price se desbloquean. Verifica también
    que la pestaña de un canal YA confirmado (ej. Airbnb) y el Simulador con ese canal
    siguen funcionando sin la etiqueta de no confiable, pese al bloqueo global.
15. **Neto manual mensual en blanco/0 nunca calcula (P2)**: en una unidad nueva, llena la
    calculadora de costos detallada pero NO toques "Neto por noche" en "Rentabilidad
    mensual". Debe decir "Falta ingresar neto manual por noche" (nunca un número). Escribe
    0 explícitamente — debe seguir pidiendo el dato. Escribe un neto positivo — debe
    calcular normalmente. Bórralo de nuevo (deja el campo vacío) — debe volver a pedir el
    dato, nunca quedar en 0 silencioso.
16. **`fixed_price` bloquea SOLO Base, nunca el Piso (refactor de cierre)**: configura
    Last-Minute en "Precio fijo" con un rango que cubra el día 45 (ej. 40-50) y márcalo
    verificado. Base Price debe mostrar "—" ("Precio LM fijo activo"), pero **Min Price
    (Piso) debe seguir mostrando un número real** — nunca "—" por este motivo. Mueve el
    rango para que ya no cubra el día 45: Base Price vuelve a mostrar un número. Esto
    confirma que `baseBlocked` nunca contamina `floorReadinessBlocked` (contrato de
    `evaluateGlobalRecommendationReadiness()`, ver CLAUDE.md).
17. **Reconciliar una reserva real**: en Resumen → "Validar contra una reserva real",
    ingresa canal/precio/noches/días y un payout recibido IGUAL al estimado que muestra la
    app (cópialo del resultado tras escribir cualquier payout) — debe decir "CONFIABLE" y
    "Diferencia USD 0". Cambia el payout a un valor bien bajo (ej. 10% del estimado) — debe
    mostrar una alerta roja clara. Escribe una comisión OTA real distinta a la configurada
    — debe aparecer en el desglose por componente con una causa explícita. Guarda la
    conciliación (botón "+ Guardar") — debe aparecer en la lista de abajo; bórrala con el
    botón "✕" y confirma que desaparece. Verifica en la pestaña del canal que su comisión
    configurada NO cambió por hacer esto — la reconciliación nunca toca la configuración.
18. **Simplificación a USD único — sin selector de moneda visible en ningún lado**:
    confirma que en Resumen ("Costos por noche") el campo de moneda es un texto fijo
    "USD" (no un `<select>`), con el aviso "Todos los valores deben ingresarse en USD."
    debajo. Revisa la pestaña de cada canal — ya no debe existir un campo "Moneda de
    liquidación". En "Validar contra una reserva real" ya no debe existir un selector de
    moneda de la liquidación. Tampoco debe existir ninguna sección "Moneda y tipo de
    cambio" en Resumen.
19. **Unidad vieja con moneda distinta de USD — "requiere revisión manual"**: exporta el
    JSON de una unidad, edítalo a mano poniendo `"currency":"COP"`, e impórtalo de vuelta
    (o usa el mecanismo de import con un payload de prueba). Al cargar esa unidad debe
    aparecer un banner rojo "REQUIERE REVISIÓN MANUAL" mencionando COP, el campo de
    moneda debe mostrar "COP (requiere revisión manual)", y Min Price/Base Price deben
    quedar en "—". En la pestaña Comparación, la Matriz debe mostrar el mismo aviso en
    vez de filas — nunca "RENTABLE EN TODOS" ni ningún veredicto. En Resumen, las Alertas
    tampoco deben mostrar "OK: sin conflictos". Si esa unidad tiene una conciliación
    guardada de antes con otra moneda, debe verse en la lista como "bloqueada por
    moneda", nunca con un % de diferencia. Elimina la unidad de prueba al terminar.
20. **Auditoría de datos reales**: en una unidad nueva, "Auditoría de datos reales" debe
    decir "SIMULACION". Carga costos reales (o llena la calculadora detallada) — pasa a
    "DATOS PARCIALES". Verifica todos los datos de negocio pendientes (Verificación de
    datos financieros), confirma LM, y guarda una conciliación con diferencia baja — el
    estado debe pasar a "LISTO PARA USO INTERNO SUPERVISADO". En ningún punto debe decir
    "producción".

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
