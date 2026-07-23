# Changelog

Todo el trabajo de este changelog vive en la rama `fix/motor-financiero-auditoria`
(no mergeado a `main`, sin push, pendiente de tu revisión). Formato: fase de la
auditoría técnica → qué cambió → por qué.

## [0.5.0] — Correcciones de revisión externa, ronda 3 (2 P1)

- **P1 — Base Price/Offset rotos con LM `fixed_price` cubriendo el día de referencia
  (45)**. Caso: Directo, costo 100/0, margen 50% (objetivo 200), LM verificado
  fixed_price=150 en días 40-50 → antes Base≈219.78 y Offset sugerido 0%, pero
  `quoteScenario({days:45,price:base})` daba payout=136.50 (muy bajo el objetivo).
  Causa: `lmPctAtDay45()` colapsaba el `priceOverride` a 0% en silencio. Ahora
  devuelve `{lmPct, priceOverride}` explícito; `compute()` expone
  `baseBlocked`/`baseBlockedReason` (Base no aplica, se explica por qué);
  `suggestedOffset()` se recalcula sobre el precio fijo real (offset corregido:
  +46.5%, verificado end-to-end contra `quoteScenario()`). Probado en los bordes
  del rango (inicio, fin, justo fuera por ambos lados) y con una propiedad sobre
  varios costos/márgenes/precios fijos. Tests: `tests/fase-base-fixedprice.test.js`;
  E2E: `e2e/base-fixedprice.spec.js`.
- **P1 — bypass del bloqueo LM desde "Ver el paso a paso" (Simulador)**. El botón
  precargaba `Math.round(model.base||model.effBase||0)` sin condición, revelando
  el Base bloqueado. `renderSim()` ahora también rechaza caer en `model.effBase`
  cuando el precio está vacío y el modelo está bloqueado — muestra la explicación
  en vez de un waterfall inventado. La simulación manual (escribir un precio a
  mano) nunca se bloquea. Tests: `e2e/sim-blocked-bypass.spec.js`.
- Nota de infraestructura de test: se detectó y corrigió una fuente real de falsos
  positivos en Playwright — `.fill()` inmediatamente después de un evento que
  dispara un re-render completo (`renderLmConfig()`) puede escribir sobre el foco
  anterior en vez del campo nuevo. Reproducido de forma determinística (5/5) y
  corregido añadiendo `.click()` explícito antes de cada `.fill()` en los specs
  que tocan campos de LM/tramos — no es un bug de la aplicación.

npm test: 98/98 · npm run test:e2e: 25/25 · lint limpio.

## [0.4.0] — Correcciones de revisión externa, ronda 2

Una segunda revisión externa encontró 4 bloqueantes sobre el trabajo de la ronda
anterior (0.3.0) — "no asumas que los tests verdes significan que el producto es
seguro". Todos corregidos con evidencia de navegador real y tests nuevos:

- **CRÍTICO** — `compute()` seguía devolviendo `valid:true` y la UI mostraba Min
  Price/Base Price como recomendaciones usables aunque el LM configurado (por
  defecto: automático, sin verificar) fuera matemáticamente no verificable.
  `compute()` ahora expone `lmBlocked`/`lmBlockedReason` (`isLmBlocked()`,
  `src/domain/pricelabs-lm.js`, fuente única). Con una unidad nueva (sin tocar
  nada), Min Price, Base Price y el Offset sugerido arrancan en "—" con un aviso
  que explica exactamente qué falta confirmar y en qué pantalla. La Matriz ya no
  agrega "⚠ LM SIN VERIFICAR" como advertencia suelta sobre un veredicto que
  sigue diciendo "RENTABLE EN TODOS" — el veredicto entero cambia
  (`buildMatrixVerdict()`, nueva, `src/domain/matrix.js`, testeable sin DOM).
  Tests: `tests/fase-lm-blocking.test.js`; E2E: `e2e/lm-blocking.spec.js`.
- **ALTO** — Base Price excluía Offset y LM "por diseño", pero eso volvía el
  texto "netea tu objetivo" falso en cuanto se configuraba un offset real o un
  LM verificado. `compute().base` ahora los incorpora en su escenario de
  referencia (día 45) — sigue siendo un punto único, no una búsqueda exhaustiva
  (eso sigue siendo del Piso). `lmPctAtDay45()` (`engine.js`) es la única
  fórmula de LM a día 45, compartida por `base` y `suggestedOffset()`. Test:
  `tests/fase-base-property.test.js`, reescrito con offset negativo/positivo y
  LM activo sin neutralizar nada.
- **MEDIO** — la edición manual seguía usando `parseFloat(t.value)||0`: un valor
  inválido se volvía 0 en silencio. `src/domain/input-parse.js` (nuevo, puro,
  testeado) es la fuente única para todos los campos numéricos editables a
  mano; un valor inválido nunca se escribe a `state` — el input conserva el
  último valor válido y aparece un aviso visible (`#inputErrorToast`, cualquier
  pestaña) con el motivo exacto. Se agregó advertencia de tramos LM solapados
  (`validateLmTiersOverlap()`). Tests: `tests/fase-input-validation.test.js`;
  E2E: `e2e/manual-input-validation.spec.js`.
- **BAJO** — la Matriz mostraba "día undefined" en el detalle de cada fila
  (`worstPayoutRow.d`/`.n` nunca existieron; el campo real es `.day`/`.night`).
  Corregido; test: `e2e/matrix-detail.spec.js`.

npm test: 90/90 · npm run test:e2e: 18/18 · lint limpio.

## [0.3.0] — Correcciones de revisión externa (post Fase 7)

Una revisión independiente encontró bloqueantes reales sobre el trabajo de
Fases 1-7 — ninguno de los 44 tests que estaban verdes en ese momento cubría
estos casos. Todos corregidos con evidencia numérica y tests nuevos:

- **CRÍTICO** — `compute().floor`/`suggestedOffset()` nunca recibían
  `lmConfig`/`ceilings`: el Piso ignoraba Last-Minute por completo, incluso
  configurado y VERIFICADO. Caso reproducido y en test:
  `tests/fase-lm-floor.test.js`. Corregido en `src/domain/worstcase.js`.
- **CRÍTICO** — la matriz elegía el "peor día" solo por mayor descuento OTA,
  ignorando fronteras de LM y noches críticas. Corregido en
  `src/domain/matrix.js` (`worstScenariosInWindow`), selecciona por PAYOUT
  real. Test: `tests/fase-matrix-worstcase.test.js`.
- **ALTO** — `quoteScenario()` calculaba `blocked`/`verified`/`mode` de LM
  automático pero nunca los exponía; ninguna vista podía bloquear un
  veredicto "Rentable" basado en una proyección sin confirmar. Ahora expuesto
  y usado en la matriz (badge "⚠ LM SIN VERIFICAR").
- **ALTO** — XSS real en atributos "numéricos" de descuentos/canales/LM vía
  unidades importadas (`validateImportFile` solo validaba `name`). Cerrado en
  la raíz con `normalizeUnit()` (`src/domain/persistence.js`) — coerción
  estricta de tipos, whitelist de ids conocidos, el import re-serializa la
  versión normalizada antes de escribir a storage. Test:
  `tests/fase-normalize-import.test.js` + E2E con payload real.
- **ALTO** — datos importados malformados (discounts no-array, tramos LM
  rotos, ids desconocidos) podían romper `map`/`find`/render. `normalizeUnit()`
  produce siempre un estado completo y seguro basado en defaults.
- **MEDIO** — coerciones silenciosas `Math.max(0,x)`/`parseFloat(x)||0` para
  datos ingresados/importados reemplazadas por validación explícita con
  `warnings` reportados (nunca un 0 sin decir por qué).
- **MEDIO** — la alerta REALIDAD reimplementaba su propia fórmula (sin LM ni
  aseo). Migrada a `worstScenarioFactor()`+`quoteScenario()` — cero fórmula
  financiera duplicada en `alerts.js`.
- **E2E automatizado real**: Playwright (`e2e/smoke.spec.js`, CI job `e2e`) —
  ya no es solo un checklist manual.
- Cambio de número esperado (no una regresión): el Piso por defecto pasa de
  USD 90 a USD 111 en el estado base, porque ahora protege también contra el
  LM automático (`ceiling_auto`) que antes ignoraba.

npm test: 67/67 · npm run test:e2e: 6/6 · lint limpio.

## [0.2.0] — Auditoría técnica (Fases 1-7)

### Fase 1 — Modularización
Extracción de `index.html` (un solo archivo) a módulos ES (`src/domain/*`,
`src/catalog/*`), sin build step. `package.json` nuevo solo para `type:module`
y scripts de test/lint. Cero cambio de comportamiento (verificado antes/después
en navegador). `node --test` reemplaza los `node -e` ad hoc.

### Fase 2 — Corrección del motor (P1/P3/P4)
- `worstNative()` pasó de muestrear un punto medio por ventana a enumerar
  exhaustivamente los días/noches críticos (`thresholds.js`) — antes podía no
  detectar un early-bird de 90 días o una promo de día 0.
- `quoteScenario()` (nuevo, `quote.js`): fuente única de verdad para cotizar un
  escenario — la usan el Piso (evidencia), las alertas PISO/TECHO y el Simulador.
- El Simulador dejó de usar un punto medio sintético para el LM; usa los
  días/noches reales que Dani escribe.

### Fase 2.1 — Precisión y cobertura de ventana
- Eliminado el uso de `totalPct` (redondeado a 1 decimal) en cualquier cálculo
  financiero — todo pasa a `factor` exacto. Caso real: Genius 0.1% + Mobile 50%
  da 50.05% exacto; el redondeo daba 50.0% y dejaba el Piso corto.
- Eliminado el punto medio (`Math.min(w.lo+1,w.hi)`) en alertas y en la matriz —
  ahora enumeran los días críticos reales dentro de cada ventana.
- Matriz y "neto estimado" por canal migrados a `quoteScenario()` — cero
  fórmula financiera duplicada fuera de la fuente única.

### Fase 3 — Costo por reserva, margen vs. markup
- `reservationCost()` implementado: limpieza/lavandería/insumos se cargan UNA
  VEZ por reserva (según las noches reales), no diluidos por una estadía
  promedio fija — bug P5/P13 corregido y documentado explícitamente contra el
  modelo legado (`tests/reservation-cost-legacy.test.js`).
- `quoteScenario()`/`compute()` usan el costo real por reserva cuando la
  calculadora de costos detallada está llena; si no, caen al modelo simple de
  siempre (compatibilidad).
- Nuevo `markupPct` (ganancia sobre costo) además de `marginPct` (ganancia
  sobre venta) — son números distintos, mostrados por separado en el Simulador.

### Fase 4 — Reglas OTA configurables + verificación
- Descuento no reembolsable de Airbnb: capa apilable POST-promo, apagada/0%/no
  verificada por defecto.
- PriceLabs Last-Minute configurable por unidad, 5 modos (automático, plano,
  gradual, precio fijo, tramos con política de solape explícita) —
  `src/domain/pricelabs-lm.js`.
- Registro de Verificado/No-verificado por unidad (`verification.js`) para los
  hechos que no se pueden confirmar sin revisar la cuenta real.

### Fase 5 — Validación y bloqueo
- `validate.js`: costos/comisiones/offsets inválidos se detectan y explican;
  `compute()` devuelve `valid`/`errors` — un resultado no confiable (NaN,
  Infinity, negativo) se BLOQUEA en la UI en vez de mostrarse como si fuera
  una recomendación real.
- Aviso explícito cuando los costos siguen en el valor de ejemplo (webinar),
  no en datos reales de la unidad.

### Fase 6 — Persistencia robusta
- Identidad estable por UUID (`v3:<uuid>`) en vez de solo el slug del nombre —
  ya no colisiona si dos unidades comparten nombre o si se renombra una.
- Migración v2→v3 explícita (botón "Migrar unidades antiguas"), nunca
  automática — y nunca borra ni toca los registros `v2:*` originales.
- Importación validada por forma antes de escribir a storage
  (`persistence.js`); confirmación explícita antes de eliminar o de sobrescribir
  una unidad con el mismo nombre (antes, Eliminar no pedía confirmación).
- Escape de HTML (`sanitize.js`) en todo el renderizado que usa nombres/notas
  de descuentos, canales o unidades — corrige una vulnerabilidad XSS real vía
  datos guardados/importados.

### Fase 7 — CI, documentación, accesibilidad
- CI en GitHub Actions (`npm test` + `npm run lint`), Node 20, no afecta el
  despliegue de Pages.
- `aria-label` en los controles nuevos sin texto visible (editor de tramos).
- `RUNBOOK.md` (checklist de QA manual, rollback, despliegue).

## [0.1.0] — Estado previo a la auditoría
App de una sola página (`index.html`), sin tests automatizados, sin CI.
