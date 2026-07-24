# Changelog

Todo el trabajo de este changelog vive en la rama `fix/motor-financiero-auditoria`
(no mergeado a `main`, sin push, pendiente de tu revisión). Formato: fase de la
auditoría técnica → qué cambió → por qué.

## [0.13.0] — Servidor local de desarrollo (`npm run dev`)

Cambio operativo, sin tocar fórmulas, gates ni datos de negocio — la auditoría
financiera (rondas 1-6) quedó aprobada para uso interno supervisado en USD;
esta versión solo facilita correr la app localmente.

**`npm run dev`** levanta `scripts/dev-server.js`: servidor HTTP estático
nuevo, escrito con módulos nativos de Node (`node:http`/`node:fs`/`node:path`),
CERO dependencias de `npm install`. Sirve el repo tal cual (mismo `index.html`
y `src/**` que despliega GitHub Pages, sin build/transformación), con los
`Content-Type` correctos para que los `<script type="module">` carguen (por
eso `file://` con doble-clic no sirve — bloqueado por CORS del navegador).
Imprime la URL local (`http://127.0.0.1:3000/index.html`) apenas arranca;
`Ctrl+C` lo detiene; `PORT=3001 npm run dev` cambia el puerto si 3000 está
ocupado. Bloquea path traversal (`../`) fuera de la raíz del proyecto —
verificado con `curl --path-as-is`. `playwright.config.js` sigue usando
`python3 -m http.server` para los tests e2e, sin cambios — ambos sirven
exactamente los mismos archivos, ninguno transforma nada.

RUNBOOK.md documenta requisitos (solo Node >= 20), comando, URL, cómo
detenerlo, el contrato USD-only, que los datos viven solo en este navegador
(`localStorage`), y el recordatorio de exportar respaldo antes de editar
datos reales.

Verificación manual: `npm run dev` → `http://127.0.0.1:3000/index.html` →
cero errores/warnings de consola → crear unidad, guardar, recargar la
página → la unidad persiste y carga correctamente → detener con `Ctrl+C`
(confirmado: el puerto queda libre de inmediato). **320/320 unitarios,
75/75 e2e, lint limpio, sin regresión.**

## [0.12.0] — Cerrado el bypass de copia COP→USD por importación (booleano crudo vs. bitácora)

Auditoría externa (ronda 6) sobre 0.11.0. Hallazgo: una copia USD creada desde COP podía
"desbloquearse" importando un JSON con `usdManualReviewPending:false` mientras
`usdManualReviewLog` seguía mostrando un `copy_created` SIN un `review_confirmed` real
después — el booleano crudo era la única fuente que consultaban `evaluateUsdOnlyReadiness()`
y `normalizeUnit()`, así que un archivo editado a mano (o un estado contradictorio) bastaba
para que Piso/Base/Offset/Matriz/Alertas/Simulador/conciliación/planificación mensual/
checklist de auditoría se mostraran disponibles sin revisión real.

**Corrección**: nueva función pura `evaluateUsdManualReviewState({usdManualReviewPending,
usdManualReviewLog})` (`src/domain/usd-only.js`) — cruza el booleano contra la bitácora en
orden temporal (por `at`, empate resuelto por posición en el arreglo). Si el `copy_created`
más reciente no tiene un `review_confirmed` VÁLIDO y posterior, el estado efectivo es
"pendiente" sin importar lo que diga el booleano. Entradas malformadas (evento desconocido,
fecha inválida/ausente) nunca cuentan como confirmación. `evaluateUsdOnlyReadiness()` ya
NUNCA lee `usdManualReviewPending` crudo — siempre pasa por esta función, y la consumen
`engine.js`, `reconciliation.js`, `monthly-economics.js` y `audit.js` por igual (mismo
estado efectivo en los 7 puntos de bloqueo). `persistence.js` (`normalizeUnit()`) hace
defensa adicional en la capa de persistencia: si detecta la contradicción, CORRIGE
`usdManualReviewPending` a `true` y agrega un warning explícito — doble defensa (dominio +
persistencia), no un parche cosmético.

También se corrigió un bug real de orden de operaciones en el handler
`#confirmUsdReviewBtn` (`index.html`): mutaba `state` en memoria ANTES de que
`window.storage.set()` confirmara el guardado — si el guardado fallaba, la unidad quedaba
mostrándose como revisada en memoria sin haberse persistido nada. Ahora se arma un
candidato aparte y `state` solo se reasigna después de una escritura exitosa; si falla,
la unidad permanece bloqueada en memoria y en pantalla, con un error explícito.

Verificación manual en navegador real (flujo completo): crear copia USD desde COP →
bloqueada → exportar/modificar (`usdManualReviewPending:false` con log sin confirmar) →
reimportar → SIGUE bloqueada (auto-corregida) → confirmar revisión manual real → resolver
LM/datos de negocio → Piso USD 108 / Base USD 197 disponibles (los mismos números del
reporte original, ahora solo alcanzables tras la revisión real) → unidad COP original
intacta y bloqueada.

Verificación de regresión: se reintrodujo deliberadamente el bug (booleano crudo sin cruzar
la bitácora, en `usd-only.js` y `persistence.js`) — 6 pruebas unitarias y 1 E2E fallaron
exactamente como se esperaba; los archivos se restauraron después (`diff` verificado, cero
cambios netos).

Tests nuevos: `tests/usd-manual-review-state.test.js` (13, la función pura en aislamiento:
el bypass exacto, orden temporal, eventos/fechas malformados, empates, re-copias sin
reconfirmar), `tests/fase-usd-copy-recovery.test.js` (+7, el bypass contra
`compute()`/`reconcileReservation()`/`computeMonthlyEconomics()`/`buildAuditChecklist()`),
`tests/real-data-persistence.test.js` (+5, auto-corrección y warning en `normalizeUnit()`).
`e2e/fase-usd-copy-recovery.spec.js` (+3: bypass por importación sigue bloqueado, log con
confirmación válida sí desbloquea, fallo simulado de `window.storage.set()` durante la
confirmación deja la unidad bloqueada con error explícito). **320/320 unitarios, 75/75 e2e,
sin regresión.**

Riesgos abiertos: sin cambios respecto a la ronda anterior — `currency.js` sigue sin tocarse
en esta ronda (fuera de alcance, a pedido explícito); accesibilidad de campos dinámicos por
canal aún parcial; ningún dato real de Dani cargado/confirmado todavía.

## [0.11.0] — BLOQUEANTE 3 corregido: la recuperación segura de una unidad COP no era segura

Auditoría externa (ronda 5) sobre 0.10.0. El flujo "Crear copia en USD" (agregado en 0.10.0
para recuperar una unidad no-USD sin editar JSON a mano) tenía un hueco crítico: la copia
quedaba con `currency:'USD'` desde el instante en que se creaba — nada más la distinguía de
una unidad USD real y verificada. Caso reproducido y confirmado: unidad COP con
`fixedCost:40`/`varCost:25` → crear copia USD → resolver LM y verificaciones de negocio →
Piso (USD 108,33) y Base (USD 196,97) se mostraban DISPONIBLES sin que nadie hubiera
revisado si los números copiados representaban de verdad USD, o seguían siendo COP con la
etiqueta encima.

**Corrección**: `evaluateUsdOnlyReadiness()` (`src/domain/usd-only.js`, ya fuente única
desde 0.10.0) gana un tercer motivo de bloqueo, `usdManualReviewPending`, evaluado ANTES
que la moneda guardada — bloquea GLOBALMENTE (Piso, Base, Offset, KPIs, Matriz, Alertas,
Simulador precargado, planificación mensual, conciliación, checklist de auditoría) aunque
`unitCurrency` ya sea `'USD'`. La copia arranca con esta bandera en `true`. Solo un flujo
explícito puede apagarla: el banner de moneda, mientras esté pendiente, muestra "Ya revisé
manualmente todos los valores en USD →" — exige una confirmación FUERTE (`confirm()` con
texto exacto) y es el ÚNICO punto de todo el código donde `usdManualReviewPending` puede
pasar a `false`. Cada transición (creación de la copia, confirmación) queda registrada en
`state.usdManualReviewLog` (append-only, nunca se borra, visible siempre en `#usdReviewTrail`
aunque la unidad ya esté desbloqueada). `audit.js` se refactorizó para llamar a la misma
`evaluateUsdOnlyReadiness()` en vez de reimplementar su propio chequeo de moneda.

Verificación manual (con Node, caso exacto del encargo): unidad COP `fixedCost:40`/`varCost:25`
→ copia con `usdManualReviewPending:true` → con LM y datos de negocio TODOS resueltos,
`currencyBlocked` sigue `true` (ahora por revisión pendiente, no por moneda) →
`floorReadinessBlocked`/`baseReadinessBlocked` ambos `true` → tras confirmar la revisión,
ambos pasan a `false` y Piso/Base quedan disponibles con normalidad.

Verificación de regresión: se reintrodujo deliberadamente el bug (chequeo de
`usdManualReviewPending` removido de `evaluateUsdOnlyReadiness()`) — las 7 pruebas
unitarias y las 4 E2E nuevas/ajustadas fallaron exactamente como se esperaba; el archivo se
restauró después (`diff` verificado, cero cambios netos).

Tests: `usd-only.test.js` (+4), `fase-usd-copy-recovery.test.js` (13, nuevo — reproduce el
caso exacto contra `compute()`/`reconcileReservation()`/`computeMonthlyEconomics()`/
`buildAuditChecklist()`), `real-data-persistence.test.js` (+11 — round-trip
guardar→recargar, payload XSS en la nota de auditoría). `e2e/fase-usd-copy-recovery.spec.js`
(3, nuevo — flujo completo en navegador real, dos unidades simultáneas, persistencia/recarga),
`e2e/fase-usd-cost-blockers.spec.js` (1 test de 0.10.0 corregido — afirmaba, por error, que la
copia quedaba "no bloqueada por moneda" inmediatamente tras crearla). **296/296 unitarios,
72/72 e2e, sin regresión.**

Riesgos abiertos: sin cambios respecto a 0.10.0 (`currency.js` sigue aislado; accesibilidad
de campos dinámicos por canal aún parcial; sin recuperación guiada para un canal aislado en
otra moneda; ningún dato real de Dani cargado/confirmado todavía).

## [0.10.0] — Dos bloqueantes corregidos: canal histórico no-USD sin bloquear; costos parciales bajando el Piso

Auditoría externa (ronda 4) sobre 0.9.0. Objetivo de cierre: dejar la herramienta apta
para uso interno supervisado exclusivamente en USD, con recomendaciones de Piso/Base/Offset
que nunca puedan salir de datos monetarios incompletos, en otra moneda o sin confirmar.

**BLOQUEANTE 1 — canal histórico no-USD no bloqueaba nada globalmente**: una unidad con
`state.currency==='USD'` pero un canal con `settlementCurrency:'COP'` (dato de antes de la
simplificación a USD único) devolvía Piso/Base/Matriz/Alertas sin bloqueo — `engine.js`
solo miraba `state.currency`, nunca los canales, aunque `monthly-economics.js`/`audit.js`
sí los detectaban. Corregido con **`evaluateUsdOnlyReadiness()`** (`src/domain/usd-only.js`),
única fuente de verdad que ahora comparten `engine.js`, `reconciliation.js` y
`monthly-economics.js` — bloquea Min Price, Base Price, el Offset sugerido de CUALQUIER
canal, Matriz (sin filas) y Alertas (sin "OK"/"RENTABLE"), y nunca contamina otra unidad
cargada en la misma sesión.

**BLOQUEANTE 2 — un campo suelto de la calculadora detallada bajaba el Piso**:
`costBreakdownIsFilled()` (cualquier campo del desglose > 0) activaba el modo detallado de
inmediato — escribir solo "Consumos: 5" hacía caer el costo real (32+22=54) a 5, y el Piso
de ≈90 a ≈8.33, como si los campos en 0 sin tocar fueran datos reales confirmados. Corregido
con **`evaluateCostReadiness()`** (`src/domain/cost-mode.js`) — tres estados explícitos
(`simple` / `detailed_incomplete` / `detailed_confirmed`): el desglose SOLO alimenta el
motor tras una confirmación EXPLÍCITA ("Revisé estos costos reales en USD, incluidos los
valores en cero"); mientras tanto sigue usando el modelo simple. Cualquier edición posterior
invalida la confirmación. Se eliminó también el auto-sync que copiaba la calculadora
detallada a los campos simples (mismo vector de bug), y los costos de ejemplo de fábrica
(32/22 nunca tocados) pasaron de solo advertir a **bloquear** Piso/Base/Offset/Matriz/
Alertas/planificación mensual.

**Correcciones adicionales**:
- Conciliación separa `numericMatch` de `modelVerified` — coincidir en el número ya no
  basta para "confiable". Tags nuevos: "COINCIDE NUMÉRICAMENTE — SUPUESTOS PENDIENTES" vs
  "CONCILIACIÓN CONFIABLE".
- Recuperación segura de una unidad no-USD: botón "Crear copia en USD (pendiente de
  revisión manual)" en el banner de moneda — crea una copia sin convertir ningún valor; la
  unidad original nunca se toca ni se borra.
- Accesibilidad: `<label for>` en los campos principales de Resumen, Simulador,
  reconciliación y planificación mensual (reemplaza `<span>` suelto).
- `index.html` ya no importa `defaultFxRates`/`currency.js`; unidades nuevas no crean
  `state.fxRates`.

Verificación manual (con Node, antes y después de reintroducir/restaurar ambos bugs
deliberadamente para confirmar que las pruebas nuevas los detectan): costo simple 32+22=54,
Piso≈90; `consumables:5` sin confirmar → costo y Piso SIN CAMBIOS (antes caía a 5/≈8.33);
desglose confirmado → costo real ≈91.82; canal COP en unidad USD → `currencyBlocked:true`,
Piso/Base bloqueados; dos unidades simultáneas sin contaminación cruzada.

Tests: `usd-only.test.js` (8, nuevo), `cost-mode.test.js` (11, nuevo),
`fase-usd-cost-blockers.test.js` (13, nuevo — reproduce ambos bloqueantes contra
`compute()`/`buildMatrixVerdict()`/`buildAlerts()`), `reconciliation.test.js` (+2/-2),
`monthly-economics.test.js` (+1), `real-data-persistence.test.js` (+4).
`e2e/fase-usd-cost-blockers.spec.js` (7, nuevo), `e2e/real-data.spec.js` (+1), 14 tests
existentes de `financial-readiness.spec.js`/`lm-blocking.spec.js`/`sim-blocked-bypass.spec.js`/
`monthly-economics.spec.js` actualizados (cargar/confirmar costos reales — el gate de costos
es independiente del de LM/datos de negocio). **270/270 unitarios, 69/69 e2e, sin regresión.**

Riesgos abiertos: `currency.js` sigue siendo código muerto (conservado a propósito);
accesibilidad de campos dinámicos por canal/descuento aún pendiente; ningún dato real de
unidades de Dani ha sido cargado/confirmado todavía — este release corrige el motor, no
reemplaza la carga y confirmación manual de costos/comisiones/LM reales.

## [0.9.0] — Simplificación a USD único: se desactiva la multimoneda de 0.8.0

**Versión actual: solo USD. La multimoneda se implementará en una fase posterior.**
Decisión de producto: la prioridad pasa a que todos los cálculos financieros reales sean
correctos, claros y seguros en una sola moneda — no existe ningún camino que convierta,
sume o compare valores de monedas distintas.

- **`quoteScenario()` devuelve `currency:'USD'` explícito** en su resultado.
- **`evaluateGlobalRecommendationReadiness()` gana `currencyBlocked`** — cuarto gate que
  bloquea Piso Y Base (igual que `lmBlocked`) para una unidad "requiere revisión manual".
- **`reconciliation.js`/`monthly-economics.js`**: se eliminó `resolveConversion()`/`fxRates`
  del flujo activo — exigen `currency==='USD'` estricto, sin conversión posible.
  `src/domain/currency.js` se conserva en el código (no se borra) para una fase
  multimoneda futura, pero ningún flujo activo lo llama.
- **`persistence.js`**: la moneda GUARDADA de una unidad (`state.currency`) nunca se
  convierte ni se reinterpreta — un valor distinto de `'USD'` se preserva tal cual, con
  warning, y la unidad queda excluida de toda recomendación global hasta corregirla.
  Mismo criterio para `reconciliations[].currency`.
- **UI**: eliminados el selector de moneda de la unidad, la sección "Moneda y tipo de
  cambio", el selector de moneda de liquidación por canal, y el selector de moneda en el
  formulario de conciliación. Nuevo aviso visible "Todos los valores deben ingresarse en
  USD." y banner "REQUIERE REVISIÓN MANUAL" para unidades viejas en otra moneda.
  `renderMatrix()`/`renderAlerts()` cortan explícitamente si la unidad está bloqueada por
  moneda — nunca muestran "RENTABLE EN TODOS"/"OK: sin conflictos" en ese caso.

Verificación manual (3 casos, confirmados con Node): (1) precio USD 150/3 noches, estimado
USD 126.75, payout real USD 106.75 → diferencia −20 (−15.78%), severidad `bad`; (2) payout
marcado COP 600.000 → bloqueado, sin diferencia/severidad calculada; (3) unidad vieja en
COP → `currencyBlocked:true`, Piso y Base bloqueados globalmente.

Tests: `reconciliation.test.js`/`monthly-economics.test.js` reescritos para USD estricto
(se eliminaron los casos de "conversión verificada"), `audit.test.js` actualizado,
`fase5-financial-readiness.test.js` (+3, `currencyBlocked`), `real-data-persistence.test.js`
(+6, moneda de unidad preservada). `e2e/real-data.spec.js` reescrito (sin selectores
FX/moneda; +2 tests de unidad/conciliación vieja en COP). **233/233 unitarios, 61/61 e2e,
sin regresión.**

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
