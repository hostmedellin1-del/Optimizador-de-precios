# Changelog

Todo el trabajo de este changelog vive en la rama `fix/motor-financiero-auditoria`
(no mergeado a `main`, sin push, pendiente de tu revisión). Formato: fase de la
auditoría técnica → qué cambió → por qué.

## [0.8.0] — Preparación para uso operativo con datos reales: reconciliación, moneda, auditoría

Tres módulos puros nuevos que responden "¿cómo sé que el modelo se está desviando de lo
que de verdad pasa en mis reservas?" sin inventar ningún dato (comisión, impuesto, tipo de
cambio, promoción o regla de plataforma).

- **`src/domain/reconciliation.js` — `reconcileReservation()`**: compara el estimado de
  `quoteScenario()` (fuente única, sin fórmula paralela) contra una reserva real que Dani
  ingresa a mano (canal, precio, noches, días, comisión OTA/bancaria/aseo/descuento nativo
  reales — todos opcionales —, payout recibido, moneda, referencia opcional; **nunca** se
  piden datos de huésped). Devuelve diferencia absoluta/%, desglose por componente, causas
  posibles, severidad (`'ok'` `<=3%`, `'warn'` real>estimado o hasta 10% por debajo,
  `'bad'` real<estimado y más de 10% por debajo) y si el modelo sigue siendo confiable.
  **Nunca cambia `channels`/`discounts` automáticamente** — solo sugiere qué revisar.
- **`src/domain/currency.js` — contrato de moneda**: cada canal puede declarar
  `settlementCurrency` (USD/COP/null) distinta a la moneda base de la unidad.
  `resolveConversion()` es la única función que convierte montos — exige un tipo de cambio
  MANUAL en `state.fxRates[moneda]` con `status:'verificado'` y `rate` válido `> 0`; si
  falta o es inválido, bloquea explícitamente cualquier consolidación multi-moneda (nunca
  asume 1:1, nunca inventa, nunca llama una API externa). Integrado en `reconciliation.js`
  y en `monthly-economics.js` (escenarios `'channel'`/`'mix'` con un canal en otra moneda).
- **`src/domain/audit.js` — `buildAuditChecklist()`**: rollup de 7 verificaciones (costos
  reales, comisiones por canal, LM, Offset, promociones, moneda, última reconciliación)
  hacia un estado final de 3 valores — `'simulacion'` / `'datos_parciales'` /
  `'listo_supervisado'` ("listo para uso interno supervisado") — **nunca "producción"**.
- **Bug real encontrado y corregido**: el aviso "EJEMPLO" de costos (`renderDataProvenance`)
  solo miraba el modo simple (`fixedCost`/`varCost`) — una unidad con la calculadora
  detallada llena pero esos dos campos sin tocar seguía mostrando "EJEMPLO" pese a tener
  costos reales. Corregido para contar también `costBreakdownIsFilled()`.
- **UI**: nuevas secciones en Resumen — "Moneda y tipo de cambio", "Validar contra una
  reserva real" (formulario + resultado en vivo + conciliaciones guardadas localmente, con
  borrado explícito), "Auditoría de datos reales". Selector de moneda de liquidación en
  cada pestaña de canal.

Tests: `tests/currency.test.js` (8), `tests/reconciliation.test.js` (12),
`tests/audit.test.js` (8), `tests/monthly-economics.test.js` (+4), 
`tests/real-data-persistence.test.js` (15, incluye payloads malformados/XSS).
`e2e/real-data.spec.js` (9). **221/221 unitarios, 60/60 e2e, sin regresión.**

## [0.7.2] — Refactor de cierre: única fuente de verdad para los bloqueos globales

Problema (revisión independiente): `globalRecommendationReady()` (0.7.1) estaba
documentada como fuente única de verdad y tenía tests, pero `src/domain/engine.js` **no la
consumía** — seguía calculando `floorReadinessBlocked`/`baseReadinessBlocked` con su propio
`unreadyChannels()` inline, y `index.html` combinaba por separado `lmBlocked`/`baseBlocked`/
`baseReadinessBlocked` con `||` en cuatro lugares distintos. El resultado funcional ya era
correcto, pero la regla vivía duplicada, con riesgo real de desalinearse a futuro.

- **`globalRecommendationReady()` reemplazada por `evaluateGlobalRecommendationReadiness(
  {readiness, channels, lmBlocked, baseBlocked})`**, con un contrato más preciso:
  `floorReady` (todos los canales resueltos + LM verificado), `baseReady` (`floorReady` +
  sin `fixed_price` activo), `unreadyChannels`, `reasons`, `floorReason`, `baseReason`.
  Corrige además un error de la versión anterior: `baseBlocked` (precio LM fijo) estaba
  atado al `ready` GLOBAL único — ahora `baseBlocked` **nunca** bloquea `floorReady` (el
  Piso protege con el peor escenario real, LM incluido; Base solo evalúa el día 45).
- **`engine.js` consume la función directamente** para `floorReadinessBlocked`/
  `floorReadinessBlockedReason`/`baseReadinessBlocked`/`baseReadinessBlockedReason` — cero
  recálculo inline.
- **`index.html` simplificado**: `renderKpis`, la intro de Matriz, el botón "Ir al
  simulador" y la precarga del Simulador leen `model.floorReadinessBlocked`/
  `model.baseReadinessBlocked` como el único booleano de gate (se eliminaron los `||`
  manuales con `lmBlocked`/`baseBlocked`); esas dos banderas solo eligen qué texto
  específico mostrar. `#validationBanner` ya no duplica el aviso de "dato financiero" cuando
  el único motivo real es LM/precio fijo.
- **Guarda anti-regresión**: nuevo test que compara `compute()` contra una llamada directa a
  `evaluateGlobalRecommendationReadiness()` con los mismos insumos — verificado manualmente
  que falla si `engine.js` vuelve a reimplementar la lógica inline.

Tests: `tests/fase5-financial-readiness.test.js` (reescrito el test del contrato viejo +3
nuevos: LM bloquea Piso+Base, todo resuelto sin fixed_price desbloquea ambos, guarda
anti-regresión), `e2e/base-fixedprice.spec.js` (+1: fixed_price deja el Piso disponible).
**174/174 unitarios, 51/51 e2e, sin regresión.**

## [0.7.1] — Revisión externa: Min Price/Base Price globales inseguros (P1); neto manual mensual en 0 aceptado como dato real (P2)

Dos fallos encontrados por una revisión independiente, no cubiertos por los 155/42 tests
de 0.7.0.

- **P1 — `floorReadinessBlocked`/`baseReadinessBlocked` solo miraban el canal que fija el
  número HOY, no todos los canales activos.** Min Price/Base Price son números **GLOBALES**
  (un solo valor que PriceLabs aplica a los 4 canales) — un canal que hoy NO fija el número
  pero tiene un dato pendiente (comisión bancaria, Offset) puede pasar a fijarlo en cuanto
  se conozca su valor real. Corregido con una nueva función pura y compartida,
  `unreadyChannels(readiness, channels)` (`src/domain/readiness.js`), que ahora usan
  `engine.js` (gate global), `matrix.js` y `alerts.js` (sus propios veredictos, ya lo hacían
  bien — ahora sin duplicar el filtro). También se agrega `globalRecommendationReady(...)`,
  la regla combinada (datos de negocio + LM + precio fijo) documentada para cualquier
  consumidor futuro. Caso obligatorio probado: Airbnb fija hoy el Piso (perfectamente
  verificado); Directo no lo fija hoy pero tiene su comisión bancaria sin confirmar → Min
  Price/Base Price siguen bloqueados globalmente hasta confirmar Directo también.
- **P2 — `manualNetPerNight:0` (default de fábrica) se aceptaba como ingreso mensual real.**
  `computeMonthlyEconomics()` solo validaba "es un número finito" — `0` lo es, así que una
  unidad nueva (sin tocar ese campo) proyectaba una PÉRDIDA mensual completa basada en un
  ingreso que nadie configuró. Corregido: default pasa a `null` ("sin configurar", nunca
  `0`); `null`/`''`/`0`/negativo devuelven `{ok:false}` con el mensaje "Falta ingresar neto
  manual por noche"; solo un número `> 0` calcula. `persistence.js` preserva `null` sin
  generar warnings falsos (`nullableNumField()`).
- Regresión encontrada y corregida en el mismo commit: `e2e/base-fixedprice.spec.js` (un
  test asumía que el mecanismo de LM `fixed_price` era el único gate en juego; con el fix
  de P1 el Base global también queda bloqueado por la comisión bancaria sin confirmar de
  Booking/Directo del catálogo de fábrica, independientemente del rango de `fixed_price` —
  se aisló con `resolveAllFinancialFacts()`, mismo patrón ya usado en otros specs).

Tests: +6 en `tests/fase5-financial-readiness.test.js`, +9 en `tests/monthly-economics.test.js`,
+4 en `e2e/financial-readiness.spec.js`, +4 en `e2e/monthly-economics.spec.js`.
**170/170 unitarios, 50/50 e2e, sin regresión.**

## [0.7.0] — Planificación mensual y reparto de utilidad

Nuevo módulo `src/domain/monthly-economics.js` (dominio puro, sin fórmulas en
`index.html`) que responde preguntas que `compute()`/`quoteScenario()` (rentabilidad
de UNA reserva concreta) no respondían: ¿la unidad es rentable al final del mes?,
¿cuántas noches hay que vender para no perder plata?, ¿qué le queda al propietario
y al administrador/PM?

- **Fuente de costos: reutiliza `state.costBreakdown` tal cual, cero campo nuevo.**
  Costos fijos mensuales = `rent+admin+utilities+insurance+tech` (ya son montos
  mensuales completos); variable/noche = `consumables`; costo por reserva (una
  vez, no diluido) = `cleaning+laundry+supplies`; noches ocupadas planeadas =
  `occNights` (ya significaba "noches ocupadas al mes"). Si la calculadora
  detallada no está llena, el módulo se niega a inventar un total mensual desde
  el modelo simple `fixedCost`/`varCost` por noche — devuelve `ok:false` con el
  motivo exacto.
- **Reservas estimadas = noches ocupadas planeadas ÷ estadía promedio** — una
  PROYECCIÓN de planificación, nunca el número exacto de reservas reales del mes
  ni el costo exacto de una reserva concreta (eso sigue siendo
  `reservationCostBreakdown()`, sin tocar).
- **Punto de equilibrio con contribución real por noche** (`neto/noche − consumo/noche
  − costo por reserva ÷ estadía promedio`). Si esa contribución es `<= 0`, el
  equilibrio es explícitamente `reachable:false` — nunca `Infinity` ni un número
  falso. Los costos fijos NUNCA desaparecen con cero reservas (probado: 0 noches →
  pérdida exacta = costos fijos).
- **Reparto Propietario/Administrador (PM) explícito y apagado por defecto**
  (`ownerTargetPct`/`managerTargetPct`/`reservePct`/`taxReservePct`,
  `configured:false` de fábrica). Política única: `reservePct`/`taxReservePct` son
  % del **ingreso neto mensual** (retención tipo impuesto, sobre lo facturado);
  `ownerTargetPct`/`managerTargetPct` son % de la **utilidad distribuible**
  (lo que queda después de costos+reserva+impuestos). El `margin` existente de
  una unidad vieja **nunca** se reparte automáticamente — el reparto detallado
  es una acción explícita, con aviso mientras esté apagado.
- **Tres escenarios de ingreso**: manual (neto/noche directo), canal específico
  (usa `quoteScenario()` real — misma fuente única que Piso/Base/Matriz/Simulador,
  cero fórmula paralela), o mezcla de canales ponderada (pesos deben sumar 100%,
  sin normalización silenciosa). Si el escenario depende de LM sin verificar o de
  un dato de negocio pendiente (Fase 5, `readiness.js`), el resultado se etiqueta
  "SIMULACIÓN NO CONFIABLE" — nunca se bloquea, nunca se presenta como
  recomendación automática.
- **UI**: nueva sección "Rentabilidad mensual y punto de equilibrio" en Resumen —
  KPIs del mes, tabla de sensibilidad por ocupación (0/5/10/15/20/25/30 noches),
  y la explicación textual de qué supuestos se usaron.
- **Persistencia**: `monthlyIncomeScenario`/`monthlyDistribution` se guardan/
  exportan/importan con la misma disciplina de `normalizeUnit()` — solo canales
  conocidos (whitelist), porcentajes fuera de `[0,100]` se descartan, un `type`
  desconocido cae a `'manual'` (el más seguro), una unidad vieja sin estos campos
  recibe el default seguro (reparto apagado, escenario manual sin configurar —
  ver corrección en [0.7.1]).

Tests: `tests/monthly-economics.test.js` (29, con fórmulas calculadas a mano en
comentarios), `e2e/monthly-economics.spec.js` (8). 155/155 unitarios y 42/42 e2e en
verde (incluye los fixes de rondas 2/3 y Fase 5, sin regresión).

## [0.6.0] — Verificación de datos financieros como regla real, no etiqueta

La revisión externa señaló que `src/domain/verification.js` reconocía datos "no
verificados" (comisión bancaria real, aislamiento del Offset en Hospy, mezcla VIP
de Expedia, Genius+Mobile de Booking, no-reembolsable de Airbnb) pero ningún
cálculo se bloqueaba por eso — el motor podía ser matemáticamente correcto y aun
así dar una recomendación incorrecta.

- **Nuevo `src/domain/readiness.js`** (`evaluateRecommendationReadiness()`) — la
  única fuente que decide, **por canal**, qué dato pendiente lo afecta y bloquea
  su Piso/Base/Offset/"Rentable" como recomendación confiable.
- **`verification.js`**: cada registro guarda `status`/`source`/`date`/`note`
  (antes solo `status`/`note`); nuevo estado `'no_aplica'` (resuelto, no bloquea);
  `bankFeePctByChannel` pasó de un registro plano a uno **por canal**.
- **`engine.js`**: `compute()` expone `readiness`/`floorReadinessBlocked`/
  `baseReadinessBlocked` — ortogonales a `lmBlocked`/`baseBlocked` (ronda 2/3, sin
  tocarlos).
- **`matrix.js`/`alerts.js`**: "RENTABLE EN TODOS" y "Sin conflictos" ya no se
  sostienen si CUALQUIER canal de la ventana depende de un dato pendiente.
- **`persistence.js`**: migración siempre seguro a `'no_verificado'` por canal
  (incluido el formato plano pre-0.6.0) — jamás hereda `'verificado'`; payload
  malformado nunca se acepta como verificado.
- **`index.html`**: bloqueo por canal en KPIs/pestañas/Matriz/Simulador con
  explicación específica; Simulador etiqueta "SIMULACIÓN NO CONFIABLE" sin
  bloquear la simulación manual; formulario de verificación con fuente/fecha/nota.

Tests: `tests/fase5-financial-readiness.test.js` (20),
`tests/fase5-verification-persistence.test.js` (8), `e2e/financial-readiness.spec.js`
(9). 126/126 unitarios, 34/34 e2e en verde.

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
