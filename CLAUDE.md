# Revenue Ops — Precios y Descuentos (Host Medellín) — Contexto completo

Herramienta de una sola página (`index.html`, todo inline: HTML/CSS/JS, sin build step,
sin frameworks) para decidir precio mínimo, precio base, offset por canal y curva de
last-minute — modelando cómo se combinan DE VERDAD los descuentos de Airbnb, Booking,
Expedia y canal Directo, no con supuestos genéricos.

**Repo**: github.com/hostmedellin1-del/Optimizador-de-precios (rama `main`, `index.html` en la raíz)
**Sitio publicado**: https://hostmedellin1-del.github.io/Optimizador-de-precios/
**Deploy**: automático vía GitHub Pages en cada push a `main`. No hace falta build ni CI.

---

## 1. Para qué existe esto (contexto de negocio, resumido)

Dani opera Host Medellín, ~36 apartamentos de renta corta (principalmente El Poblado,
Medellín), gestionados con PriceLabs (motor de pricing dinámico) + Hospy (PMS/channel
manager) que sincroniza a Airbnb, Booking.com y Expedia. El problema que esta herramienta
resuelve: PriceLabs empuja un precio dinámico por canal, pero cada OTA tiene su propia
comisión, sus propios descuentos nativos, y ahora también un "Pricing Offset" configurable
por canal en PriceLabs mismo. Sin un modelo que combine todo eso correctamente, es fácil
vender por debajo del costo sin darse cuenta, o dejar plata sobre la mesa por sobre-descontar.

La herramienta responde, para una unidad (hoy modelada de a una, ej. Alcázar de Oviedo 902):
qué precio poner, qué descuentos activar por canal y ventana, cómo se combinan entre sí,
qué ve el huésped al final, y qué margen real queda después de todo.

---

## 2. Reglas de combinación verificadas (investigadas jul 2026 — NO reinventar ni asumir)

### Airbnb
Dentro de un rule set, orden de prioridad FIJO — gana SOLO UNA promo del grupo `'promo'`:
1. Anuncio nuevo (20%, primeras 3 reservas)
2. Promoción personalizada (fechas específicas)
3. Duración — semanal/mensual (`kind:'los'`, ej. ≥3, ≥7, ≥14, ≥28 noches — 28 es el
   umbral real de "estadía larga" de Airbnb, confirmado por Dani; antes decía ≥49, que
   era un valor inventado sin base real)
4. Early-bird (`kind:'window'`, en meses exactos: ≥30/≥60/≥90 días = 1/2/3 meses,
   confirmado por Dani que se maneja por mes, no por corte de días arbitrario)
5. Last-minute (`kind:'window'`, ventana cercana al check-in)

Con varios escalones en el mismo nivel de prioridad (4 de duración, 3 de early-bird),
gana el umbral MÁS PROFUNDO que se cumple (más noches / más días), NO el porcentaje más
alto. Esto ya está implementado en `combineChannel()` con `prio` + sort descendente por
`minN`/`from` dentro del mismo nivel — no cambiar a "sort por % mayor", es incorrecto.

Los ajustes de rule set / temporada (`group:'stackable'`) SÍ se suman encima de la promo
ganadora — no compiten con ella.

### `lockN` — umbrales con nombre atado a un número específico (jul 2026)
Semanal (7 noches), Quincenal (14 noches), Larga estadía (28 noches) y Early-bird
1/2/3 meses (30/60/90 días) tienen `lockN:true` en `defaultDiscounts()`: el umbral de
noches/días se muestra como texto fijo en `discountRowHTML()`, no como `<input>` editable
— porque el NOMBRE del descuento depende de ese número exacto ("Semanal" solo tiene
sentido si son 7 noches). El `%` de estos SIGUE siendo editable, solo el umbral está
bloqueado. "Estadía media (≥3 noches)" NO tiene `lockN` a propósito — no es un período con
nombre fijo, es genuinamente variable, y Dani lo confirmó explícitamente. Same para
Last-minute (ver abajo): no tiene nombre de período fijo, así que nunca lleva `lockN`.

### Last-minute — 3 entradas variables, no 1 sola (jul 2026)
`ab_lm1`/`ab_lm2`/`ab_lm3` (antes existía un solo `ab_lm`, con id fijo que ya NO existe —
si se busca por ese id en cualquier código nuevo, va a devolver `undefined`). Igual que
Early-bird tiene 3 escalones, Last-minute también puede tener varios — pero a diferencia
de Early-bird, Dani pidió explícitamente que NO se les ponga `lockN` ni % sugeridos: la
ventana de días Y el % son completamente variables, los configura Dani caso por caso. Por
eso arrancan en 0%/apagadas con ventanas iniciales de referencia (0-1/0-3/0-7 días) que
son solo un punto de partida editable, no un valor real de negocio.

### Duración de estadía — 3 entradas 100% variables (`ab_los5/6/7`, jul 2026)
Igual que Last-minute, Dani pidió más descuentos por duración que NO estén atados a un
nombre de período fijo (a diferencia de Semanal/Quincenal/Larga estadía). Se agregaron
`ab_los5`/`ab_los6`/`ab_los7` ("Duración personalizada A/B/C") sin `lockN`: noches Y % son
editables desde la UI, arrancan apagadas con `pct:0` (Dani pone el valor real) y con
umbrales de referencia 5/10/21 noches solo como punto de partida. Reusan el mismo `group:
'promo'`, `prio:3` que las demás LOS — la lógica de `combineChannel()` (deepest-threshold-
wins dentro de la misma prioridad) ya es genérica y no necesitó cambios; verificado con Node
que con varias LOS activas a la vez sigue ganando la de umbral más profundo que aplique.

### Bug corregido — drift de `minN`/`from` en descuentos `lockN` al cargar unidad guardada (jul 2026)
Encontrado en vivo por Dani: "Larga estadía" mostraba ≥49 noches en vez de ≥28. Causa: el
campo se bloqueó (`lockN:true`) en una sesión posterior a cuando algunas unidades ya habían
sido guardadas con un `minN` editado a mano (cuando el campo aún era un `<input>` libre). Al
bloquearse, `discountRowHTML()` empezó a mostrar `d.minN` como texto fijo tomado del dato
guardado (49), no del catálogo (28) — y como el input ya no existe, no había forma de
corregirlo desde la UI. Fix en el listener `unitList.addEventListener('change', ...)`
(`index.html`, tras el merge de nuevas entradas del catálogo): para cada descuento cargado
cuyo `id` sea `lockN:true` en `defaultDiscounts()`, se resincroniza `minN` (o `from`/`to` si
es tipo `window`) al valor del catálogo actual, ignorando lo guardado. Cualquier `lockN`
futuro debe confiar en que el umbral SIEMPRE viene del catálogo, nunca del dato persistido.
Verificado con Node simulando una unidad vieja con `ab_los4.minN=49` → al cargar da 28.

Fuente: Airbnb Help Center, ejemplo oficial (early-bird 20% + descuento mensual 30% en la
misma reserva → solo se aplica el 30%, nunca los dos). Hay reportes de hosts en foros
sobre apilamiento fuera de rule sets, sin confirmar al 100% — dejar la nota visible en la
UI, no borrarla.

### Booking.com
Categorías DISTINTAS se MULTIPLICAN entre sí; la MISMA categoría no combina:
- Genius (`group:'proactive'`) combina con todo lo demás.
- Mobile Rate (`group:'proactive-mobile'`) apila sobre Genius, pero no combina con
  Country Rate ni con Limited-time Deal — si cualquiera de esos dos está activo, Mobile
  se ignora (ya implementado, ver el `ignored[]` que devuelve el motor).
- Reactivos (Basic Deal / Early Booker Deal / Last-Minute Deal / Getaway Deal,
  `group:'reactive'` o `'reactive-limited'`): solo UNO a la vez puede estar activo; el
  motor usa el de mayor % que aplique en esa ventana de días.
- Duración de estadía (`bk_los1/2/3`, `group:'los'`, jul 2026, a pedido de Dani): NO es un
  "deal" que compite por categoría — es la tarifa que el host configura directo en Rates &
  Availability → Discounts de Booking, así que se apila con Genius/Mobile/reactivos igual
  que Genius. Si varios umbrales califican a la vez (ej. 30 noches califica para ≥7 y ≥28),
  gana el más profundo, igual que la regla de Airbnb LOS — implementado como bloque aparte
  en `combineChannel()`, ANTES de los reactivos. 100% variable (noches y % editables, sin
  `lockN`), apagadas y en 0% por defecto.

### Expedia
Una sola promo "base" por reserva (`group:'base'`: Mobile-only, Same-day/last-minute,
Early booking, Basic, Duración de estadía) — el motor usa la de mayor % aplicable, las
demás se ignoran. Member Only Deal (`group:'mod'`) es la excepción: apila ENCIMA de esa
promo base.

**`ex_mod` = oferta real de la cuenta de Dani** (jul 2026, screenshot de Expedia Partner
Central): "Oferta exclusiva para miembros VIP", tipo Negotiated, activa, sin fecha de fin,
**no editable desde Expedia**. Desglose real por nivel del viajero: Blue 10% / Silver 15% /
Gold+Platino 20%. El motor no sabe de antemano qué nivel tiene cada huésped, así que usa
**20% (peor caso)** como `pct` — misma filosofía de `worstNative()`: el Piso tiene que
protegerse contra el descuento más profundo posible, no contra el promedio. Si Dani
confirma que la mezcla real de niveles es mucho más Blue que Gold, se podría discutir bajar
esto, pero por defecto se protege con el peor caso.

**`ex_los1/2/3` = "Duración de estadía A/B/C" (≥7/14/28 noches)**, agregadas jul 2026 a
pedido de Dani: 100% variables (noches y % editables desde la UI, sin `lockN`), apagadas y
en 0% por defecto. Están en `group:'base'`, así que si varias califican a la vez gana la de
mayor % (no la de umbral más profundo — esa es la regla real de Expedia para el grupo base,
sin cambios). Bug de motor corregido al agregar la primera: el filtro de `group:'base'` en
`combineChannel()` solo llamaba `windowApplies()`, que SIEMPRE devuelve `false` para
`kind:'los'` — un descuento de Expedia por duración de estadía nunca podía activarse aunque
se configurara bien. Fix: el filtro ahora es `windowApplies(d,daysOut)||losApplies(d,nights)`,
igual que ya usaba el grupo `promo` de Airbnb. Ver sección 6 (bugs corregidos).

### Comisión bancaria / pasarela de pago
Corregido jul 2026, confirmado por Dani con sus facturas reales — este es un error que
ya se cometió una vez, no reintroducirlo: la comisión bancaria se calcula SOBRE EL
PRECIO QUE PAGA EL HUÉSPED, exactamente igual que la comisión de la OTA. Las dos se
restan del MISMO número — no se acumula una sobre lo que ya dejó la otra.

```
INCORRECTO (composición, lo que estaba antes): payout = guest * (1-comisión%) * (1-bancaria%)
CORRECTO (lo que factura el banco de verdad):  payout = guest * (1 - comisión% - bancaria%)
```

Implementado en `payoutFactor(c)`. La diferencia entre ambas fórmulas es pequeña por
reserva (~1-2%) pero sistemática — sobre volumen es plata real, y el modelo viejo la
escondía a favor de Dani (le hacía creer que ganaba más de lo real).

### Offset por canal (Pricing Offset de PriceLabs)
Descubierto y verificado en esta conversación vía soporte de PriceLabs: existe una
función real en PriceLabs (Dynamic Pricing → Customizations) para ajustar el precio
publicado, por canal, DESPUÉS de todo lo que PriceLabs calcula internamente (base + LM).
Esto es lo que permite compensar comisiones distintas por canal SIN inflar el precio
compartido para todos.

Advertencia sin confirmar, importante: soporte de PriceLabs avisó que si el PMS (Hospy,
en este caso) no distribuye el offset por canal de forma aislada, podría aplicarse a
todos los canales conectados a la vez, rompiendo el supuesto central de esta función.
Dani debe verificarlo directamente en Hospy antes de confiar en la separación. Está
documentado en la UI (pestaña de cada canal) — no quitar esa advertencia.

`suggestedOffset(chId, effBase, netObjetivo)` calcula matemáticamente el % a subir/bajar
en PriceLabs para ese canal específico, dado un Base uniforme, para netear el objetivo.
Verificado con pruebas: aplicar el offset sugerido siempre da exactamente el neto
objetivo (no es una aproximación). Se evalúa a `state.avgNights` (estadía promedio, no a
1 noche fija) — así el nativo incluye descuentos por duración que la reserva típica sí
califica, y la tarifa de aseo de Airbnb (fija por reserva) se diluye correctamente por
noche vía `cleanFeePerNight(c, nights)`. Sin `avgNights`, el offset sugerido para Airbnb
salía más alto de lo necesario (ignoraba que el aseo ya aporta ingreso).

### El Piso Y el Base incluyen el Offset y el LM por canal (jul 2026; Base corregido en ronda 2 de revisión externa)
`compute()` calcula el `floor` (Min Price) con el offset de cada canal en el denominador:
`cost / ((1+offset)*(1-nativoPeor)*payoutFactor)`. Antes NO lo incluía — con offset
positivo eso solo sobre-protegía (inofensivo), pero con offset **negativo** (bajar precio
en un canal para competir) el piso dejaba de proteger de verdad: un canal podía vender
bajo costo estando "sobre el piso" en apariencia. Verificado: Booking con offset −15%
neteaba 46 contra costo 54 antes del fix; después, el piso sube a 103 y netea exacto 54.
Offset ≤ −100% da `Infinity` (se muestra "—", no rompe).

**Decisión revertida en ronda 2 (revisión externa) — el `base` (Base Price) SÍ incluye
ahora el Offset y el LM REALES de cada canal.** La decisión original ("Base es el precio
uniforme SIN offsets") quedaba matemáticamente falsa en cuanto Dani configuraba un offset
real (ej. Booking −15% para competir) o un LM verificado: el texto "netea tu objetivo"
dejaba de ser cierto para la config real, aunque siguiera siendo cierto para la config
hipotética de offset=0. Un revisor externo marcó esto como bloqueante ALTO: "no acepto
mantener el nombre actual con una garantía que el cálculo no cumple". Se eligió la opción
de incorporar Offset/LM (en vez de renombrar Base a "referencia teórica") porque hace que
la garantía sea cierta AHORA MISMO, sin perder la separación conceptual: Base sigue siendo
UN punto de referencia único (día 45, fuera de ventanas tácticas, nativos constantes —
nunca una búsqueda exhaustiva de peor caso, esa sigue siendo tarea exclusiva del Piso), y
`suggestedOffset` sigue existiendo para ELEGIR o AJUSTAR el offset de un canal — solo que
ahora, una vez que Dani pone un offset real (por sugerencia o a mano), Base se recalcula
solo para reflejarlo, en vez de quedar basado en un offset=0 que ya no es la realidad.
`lmPctAtDay45()` (`engine.js`) es la única fórmula que resuelve LM a día 45 — la usan
`compute().base` y `suggestedOffset()`, para no duplicarla (antes cada uno la
reimplementaba por su cuenta). Tests: `tests/fase-base-property.test.js` (con offset
negativo/positivo y LM activo, sin neutralizar nada).

### Contrato definitivo — Base Price, Offset y `fixed_price` (ronda 3, revisión externa)
Una tercera revisión encontró que el fix de la ronda 2 (arriba) tenía un hueco: cuando
`lmConfig.mode==='fixed_price'` y el rango activo cubre el día 45, `lmPctAtDay45()`
devolvía `priceOverride` pero `compute().base`/`suggestedOffset()` lo IGNORABAN (trataban
el override como 0% de LM) — Base seguía calculando un número (`≈219.78` en el caso
reportado: Directo, costo 100, margen 50%) que no tenía ningún efecto real, porque
PriceLabs iba a publicar el precio fijo (150) sin importar Base. `suggestedOffset()`
daba 0% cuando el offset REAL necesario era +46.5%.

**El contrato quedó así, explícito y con tests (`tests/fase-base-fixedprice.test.js`,
`e2e/base-fixedprice.spec.js`):**
- `lmPctAtDay45()` devuelve `{lmPct, priceOverride}` — nunca colapsa el override a un
  número silencioso.
- **Base Price**: si `priceOverride!=null` en el día 45, Base es irrelevante para ese
  escenario (PriceLabs no lo va a usar) → `compute()` devuelve `baseBlocked:true` +
  `baseBlockedReason` (explica, por canal, si el precio fijo alcanza o no el objetivo).
  La UI oculta el KPI ("—"), la Matriz oculta el número, y `#validationBanner` muestra
  el motivo exacto con el mismo patrón que `lmBlocked`. El campo `base` interno se sigue
  calculando (ignorando el override) solo como ancla numérica de `effBase` para el resto
  de la app — nunca se presenta como recomendación cuando `baseBlocked` es true.
- **Offset**: a diferencia de Base, el Offset SÍ puede seguir controlando el resultado —
  se aplica DESPUÉS del precio (fijo o no), mismo orden que `quoteScenario()`
  (`priceAfterOffset = priceAfterLm*(1+off)`). `suggestedOffset()` ahora resuelve sobre
  `priceOverride` cuando existe, en vez de `effBase*(1-lm/100)` — nunca se bloquea, se
  RECALCULA correctamente. La UI muestra el número corregido con una nota explícita
  ("se recalculó sobre ese precio fijo real") en vez de fingir que viene de Base.
- **Bordes probados**: día 45 exactamente en `fromDay`, exactamente en `toDay`, y justo
  fuera del rango por ambos lados — solo bloquea cuando el día 45 realmente cae dentro.
- **Bloqueante P2 (bypass del Simulador)**: el botón "Ver el paso a paso" (`goSimBtn`)
  precargaba `Math.round(model.base||model.effBase||0)` sin condición — revelaba el
  Base bloqueado por la puerta de atrás. `renderSim()` ahora también se niega a caer en
  `model.effBase` cuando el campo de precio está vacío Y el modelo está bloqueado
  (`lmBlocked`/`baseBlocked`): muestra la explicación en vez de un waterfall con un
  número inventado. Escribir un precio a mano sigue funcionando siempre — la simulación
  manual nunca se bloquea, solo el atajo automático. Tests: `e2e/sim-blocked-bypass.spec.js`.

---

## 3. Por qué está armado como está (decisiones de arquitectura, para no revertirlas sin querer)

- Tema claro (jul 2026, a pedido de Dani — antes era oscuro). Las variables de color
  viven todas en `:root`. `--safe`/`--warn` se oscurecieron respecto al original
  (`#3FB876`/`#E8A23D`) porque esos valores brillantes no pasan contraste AA como texto
  sobre fondo blanco (si se usan como color de texto en `.cell-ch .ok/.warn`, `.wf-line.net`,
  `#saveStatus`). Se agregaron `--safe-chip`/`--warn-chip` que SÍ conservan el valor
  brillante original, usados solo como fondo de las etiquetas de alerta (`.alert.ok .tag`,
  `.alert.warn .tag`), donde van con texto oscuro encima y necesitan ser vívidos, no legibles
  como texto plano. `--accent` (#D6412C) no cambió — ya pasa AA en ambos sentidos (texto
  sobre blanco y texto blanco sobre el color), se usa igual en los dos roles.
- Un solo archivo HTML, sin build. Se decidió así para poder desplegarlo en GitHub Pages
  / Netlify / donde sea sin pipeline. Mantenerlo así salvo que Dani pida lo contrario.
- Pestañas, no una sola página larga. La primera versión (v1) tenía todo en una grilla
  apretada; Dani preguntó si convenía una página por OTA porque puede subir un % de
  precio distinto por canal (esto llevó al descubrimiento del Offset). Se rediseñó a
  pestañas: Resumen, una por canal, Comparación (matriz cruzada por ventana), Simulador.
  La Comparación NO se eliminó al hacer las pestañas por canal — ahí es donde el motor
  detecta contradicciones ENTRE canales (ej. Booking rompiendo el techo mientras Airbnb
  está bien), que se perdería si todo quedara aislado por pestaña.
- Orden de pestañas: Resumen, **¿Cómo se calcula?** (id interno sigue siendo `simulador`,
  solo cambió el label y la posición en `TABS`), Airbnb/Booking/Expedia/Directo,
  Comparación (jul 2026). Dani dijo "no lo entiendo" sobre el flujo de cálculo — el motor
  estaba bien, pero el Simulador (que SÍ narra el flujo paso a paso) era la última de 7
  pestañas, detrás de 6 pantallas de configuración. Se movió a 2ª posición porque es la
  respuesta a "por qué este precio", no un extra al final. No revertir el orden sin volver
  a tener este problema de comprensión.
- `goToTab(tabId)` es el único punto de cambio de pestaña — lo usan el tabbar, el botón
  `#goSimBtn` (Resumen → Simulador con el Base precargado) y los links `data-goto` de las
  alertas (`renderAlerts`, `buildAlerts` con campo `tab` por alerta). Si se agrega una
  forma nueva de cambiar de pestaña por código, debe llamar a `goToTab()`, no duplicar la
  lógica de toggle de clases.
- Tooltips de jerga: clase CSS `.term` (subrayado punteado + `title` nativo del navegador,
  cero JS/librerías nuevas) en la primera aparición de Piso, Base, Offset, Nativo, LM,
  Techo. Deliberadamente simple — no construir un sistema de tooltips custom sin que Dani
  lo pida.
- Catálogo de descuentos por canal: solo los `on:true` se muestran siempre visibles
  arriba ("Descuentos activos hoy"); el resto vive detrás de un `<details>` nativo
  colapsado ("Ver catálogo completo (N más)"). Antes se mostraban los ~11 descuentos de
  cada canal de una vez, la mayoría apagados/sugeridos — abrumaba más que ayudaba.
- **Comparación — veredicto en vez de columnas crudas (jul 2026)**: Dani dijo que no se
  entendía qué decisión tomar en esta pestaña (4 columnas con hasta 4 canales cada una,
  ~16 números por fila, sin jerarquía visual). Se agregó `matrixIntro` arriba de la tabla
  (recap de Min Price / Base Price / costo, para no tener que saltar a Resumen) y se
  colapsó Nativo/LM/Total/Neto detrás de un `<details>` "Ver por canal" por fila. En su
  lugar, cada fila lleva una columna **Veredicto**: un chip + una frase en español plano,
  con prioridad de gravedad fija — Techo excedido (el nativo ya rompe el techo, LM=0% y
  aun así se pasa) > Bajo costo (el canal peor parado neta menos que `model.cost`) > Cubre
  costo pero bajo objetivo (neta menos que `model.net`) > Rentable en todos. Siempre nombra
  el canal peor parado (`worst`, el de menor neto) y qué tocar (Offset del canal, su
  descuento nativo, o el techo). No quitar el detalle por canal — sigue siendo la fuente de
  verdad si Dani necesita ver el desglose exacto, solo ya no es lo primero que se lee.
  Con la Oferta VIP de Expedia real (20%, siempre activa) varias ventanas con techo bajo
  por defecto (8%, 0%, 15% en 8-14/15-29/30+ días) ahora muestran TECHO EXCEDIDO de
  entrada — Dani debe revisar si esos techos por ventana siguen siendo los correctos
  ahora que Expedia tiene un piso de descuento real no editable.
- `window.storage` con polyfill a `localStorage`. El storage nativo de Claude.ai
  (`window.storage`) no existe fuera de Claude.ai. Se agregó un polyfill al inicio del
  `<script>` que detecta si `window.storage` ya existe; si no, lo simula con
  `localStorage` con el mismo contrato (get/set/delete/list). Esto permite que el MISMO
  archivo funcione dentro de Claude.ai y como página independiente (GitHub Pages, local)
  sin mantener dos versiones distintas.
- **Limitación real de `localStorage`, importante para Dani**: los datos quedan SOLO en
  ese navegador/computador — no hay nube, no sincroniza entre dispositivos, y se pierde
  si se borra caché/datos de navegación o se usa modo incógnito. Con ~36 unidades reales
  de negocio, confiar solo en esto es riesgoso. Por eso se agregaron los botones
  **Exportar todo / Importar** (jul 2026, junto a Guardar/Cargar/Eliminar en `.unit-bar`):
  Exportar lee todas las claves `v2:*` vía `window.storage.list`, arma un único `.json`
  (`{exportedAt, units:[{key,value}]}`) y lo descarga con `Blob`+`URL.createObjectURL`
  (sin backend, funciona igual en GitHub Pages). Importar lee ese `.json` y hace
  `window.storage.set` por cada unidad, con un `confirm()` antes de sobrescribir
  unidades existentes con el mismo nombre. Probado end-to-end en navegador (exportar →
  archivo real en disco con estructura correcta → borrar → importar → unidades vuelven
  exactas). Recomendarle a Dani exportar periódicamente y guardar el `.json` en Drive o
  donde respalde su negocio — la app no lo hace sola, es manual.
- v1 fue descartada por completo, no parcheada. La v1 tenía "% nativo constante" y "%
  por ventana" como dos conceptos separados sin reglas de combinación reales —
  estructuralmente inválido. Se reescribió desde cero como v2 con un catálogo único de
  descuentos + motor de reglas por canal. La v2 (este archivo) es la autoridad.
- Calculadora de costos detallados (jul 2026, `state.costBreakdown`) es un ayudante
  OPCIONAL sobre `fixedCost`/`varCost`, no un reemplazo — `compute()` sigue leyendo solo
  esos dos campos, cero cambios al motor. Vive colapsada (`<details class="cost-calc">`)
  dentro de "Costos por noche" en Resumen. Al editar cualquier línea (`data-cb`), se
  recalcula todo vía `costCalcTotals()` y se escribe directo en `state.fixedCost`/
  `state.varCost`, sincronizando también los inputs visibles de esos campos
  (`document.querySelector('[data-k="fixedCost"]').value=...`) — si no se hace esto
  además de actualizar el estado, el input queda mostrando un valor viejo aunque el
  estado ya cambió. Es deliberadamente **opt-in**: si el usuario nunca toca un campo
  `data-cb`, nunca se sobreescribe `fixedCost`/`varCost` (los defaults de `costBreakdown`
  son todos 0, así que aplicarlos siempre en cada render pisaría el valor manual sin que
  el usuario lo pidiera — por eso el cálculo+escritura solo ocurre dentro del handler de
  `change` de `data-cb`, nunca en `renderAll()`; `renderAll()` solo actualiza el texto de
  previsualización vía `renderCostCalc()`, que es de solo lectura).
  - `fixedPerNight = (rent+admin+utilities+insurance+tech) / occNights`.
  - Dentro de Variables hay DOS categorías con lógica distinta, no una sola bolsa
    (corregido jul 2026 — Dani hizo la pregunta correcta: "¿cómo calculo el consumo de
    agua si hay huéspedes de 1 noche y otros de 30?"): **por turno** (limpieza,
    lavandería, insumos) cuesta casi lo mismo sin importar la duración de la estadía →
    se divide entre `avgNights`. **Consumos** (agua/luz/gas) SÍ escala con las noches del
    huésped → es un campo único en $/noche directo, nunca se divide. Mezclarlos (como
    estaba antes) distorsiona el número en los dos extremos: infla estadías cortas y
    diluye de más las largas. `varPerNight = (cleaning+laundry+supplies)/avgNights + consumables`.
    Metodología sugerida a Dani para estimar Consumos $/noche: comparar la factura de un
    mes con buena ocupación contra un mes de baja ocupación (o el consumo base con el
    apto vacío), dividido entre las noches ocupadas de ese mes.

---

## 4. Arquitectura técnica del archivo actual

- `state` — objeto único: `fixedCost`, `varCost`, `margin`, `marketWindow`, `marketBase`,
  `avgNights` (estadía promedio, jul 2026), `currency`, `matrixNights`, `channels[]` (cada
  uno con `comm`, `bankFeePct`, `offsetPct`), `discounts[]` (catálogo completo, cada uno
  con `ch`/`kind`/`group`/`prio`/ventana o duración), `ceilings` (techo % por ventana).
- `combineChannel(chId, daysOut, nights)` — el motor central. Aplica las reglas de la
  sección 2 según el canal. Devuelve `{factor, totalPct, applied[], ignored[]}` —
  `applied`/`ignored` traen el porqué de cada decisión (para el simulador y las alertas).
  `totalPct` se redondea a 1 decimal (`Math.round((1-factor)*1000)/10`) para no arrastrar
  ruido de punto flotante (daba 18.999999… en vez de 19).
- `payoutFactor(c)` — `1 - comisión% - bancaria%` (ver corrección de la sección 2).
- `worstNative(chId)` — escanea TODAS las ventanas Y todas las duraciones con descuento
  por LOS activo, para encontrar el peor caso real. (Bug corregido: antes solo probaba 1
  noche y los descuentos por duración quedaban invisibles para el piso.)
- `compute()` — costo total, neto objetivo, piso (Min Price PriceLabs — incluye el offset
  de cada canal, ver sección 2), base (Base Price PriceLabs, SIN offset — para netear
  objetivo en todos con sus nativos constantes).
- `suggestedOffset(chId, effBase, netObjetivo)` — ver sección 2. Usa `state.avgNights`.
- `cleanFeePerNight(c, nights)` — tarifa de aseo de Airbnb (fija por reserva) diluida por
  noche según la duración dada; devuelve 0 para canales sin aseo. La usan `suggestedOffset`,
  el "neto estimado" de la pestaña de canal, la alerta DURACIÓN, y el Simulador.
- Tarifa de aseo de Airbnb (`cleanFeeShort`/`cleanFeeLong` en `state.channels` — solo el
  canal `airbnb` tiene estos campos). Fija por reserva, no por noche: 1–2 noches usa
  `cleanFeeShort`, 3+ usa `cleanFeeLong`. Airbnb no la descuenta con los promos de noche,
  pero SÍ cobra comisión sobre ella (modelo Host-Only Fee). El Piso/Base de Resumen NO la
  incluyen todavía (son modelos agregados por noche, sin reserva puntual) — sí la incluyen
  `suggestedOffset`, el neto estimado por canal y el Simulador, todos evaluados a
  `avgNights`.
- Pestañas (`TABS` array + `.tab-panel[data-tab=...]`): Resumen, Simulador (label
  "¿Cómo se calcula?", 2ª posición — ver sección 3), `ch-airbnb`, `ch-booking`,
  `ch-expedia`, `ch-direct`, Comparación.
- Storage: prefijo `v2:` + slug del nombre de unidad. `shared:false` siempre (datos
  personales, no compartidos).

---

## 5. Pendiente real — son decisiones de negocio de Dani, no técnicas. NO inventar valores.

**FASE 5: los puntos 2, 3, 6 y 7 de abajo ya NO son solo "pendientes documentados" — desde
`src/domain/readiness.js`, mientras sigan sin confirmarse en Resumen → "Verificación de
datos financieros", BLOQUEAN activamente Piso/Base/Offset/"Rentable" de los canales que
afectan (ver tabla en sección 9). Confirmarlos ahí (marcar "Verificado" con fuente/fecha,
o "No aplica" si Dani confirma que no corresponde a esta unidad) es lo único que los
desbloquea — nunca se infieren ni se asumen. Corrección P1 (revisión externa): como Min
Price/Base Price son números GLOBALES (un solo valor para los 4 canales), basta que
CUALQUIERA de los puntos 2/3/6/7 esté pendiente en CUALQUIER canal activo para que el
número global quede bloqueado — no solo el canal que hoy resulta ser el más ajustado.**

1. Costos reales de la unidad 902 (Alcázar de Oviedo). Hoy el modelo usa el ejemplo
   genérico del webinar de Kunas ($54 costo/noche, $98 neto objetivo, margen 45%) — son
   ilustrativos, NO son los costos reales de Dani. Todo lo demás depende de esto.
7. Monto real de la tarifa de aseo de Airbnb (corta 1–2 noches / larga 3+ noches) —
   hoy en 0 por defecto ("cambia según cada listing", confirmado por Dani), cada unidad
   guardada debe traer su propio valor. No inventar un número — queda en 0 hasta que se
   cargue el dato real de cada unidad.
2. Confirmar en la extranet real de Booking.com: ¿Genius y Mobile Rate están AMBOS
   activos hoy? Se asumió que sí (10% + 10%) — cambia cuál canal termina fijando el piso.
   **(clave `bookingGeniusMobileBoth` — bloquea Booking mientras esté pendiente.)**
3. % real de comisión bancaria por canal. Hoy: Booking 6%, Directo 6%, Airbnb 0%,
   Expedia 0% — son estimados de Dani a falta de revisar facturas, no verificados.
   **(clave `bankFeePctByChannel`, POR CANAL — bloquea cada canal con comisión > 0%
   mientras esté pendiente; Airbnb/Expedia en 0% no lo necesitan.)**
4. **[Actualizado — infraestructura lista, falta el dato real]** Multi-moneda: el
   contrato de conversión YA EXISTE (`src/domain/currency.js`) — cada canal puede declarar
   `settlementCurrency` distinta a la moneda base, y cualquier consolidación entre monedas
   distintas queda bloqueada mientras no exista un tipo de cambio manual VERIFICADO en
   Resumen → "Moneda y tipo de cambio". Lo que sigue pendiente es 100% de Dani: marcar qué
   canal liquida en qué moneda para cada unidad real (Distrito Primavera, Casa Río Adentro,
   Villa Juliana, El Refugio están en COP) y el tipo de cambio real que usa para
   convertir — nadie lo inventó, arranca vacío/no verificado.
5. Multi-unidad simultánea: el sistema permite guardar/cargar unidades por nombre, pero
   no comparar varias a la vez en una sola vista (portafolio). No construir esto sin que
   Dani lo pida — es una función nueva, no un arreglo.
6. Verificar en Hospy si el Offset por canal de PriceLabs realmente se aísla por canal o
   se distribuye a todos los conectados (ver advertencia sección 2).
   **(clave `hospyOffsetIsolated` — bloquea cualquier canal con Offset ≠ 0% mientras esté
   pendiente.)**
8. Revisar los Techos por ventana en Comparación ahora que la Oferta VIP de Expedia es
   real (20%, siempre activa, no editable) — varias ventanas (8-14/15-29/30+ días) tienen
   techo por defecto (8%/0%/15%) más bajo que ese 20%, así que Expedia sale "TECHO
   EXCEDIDO" ahí de entrada. Dani necesita decidir: ¿sube esos techos para reflejar que
   Expedia siempre trae 20% mínimo, o acepta que en esas ventanas Expedia va a estar
   siempre marcado como excedido (y competir menos ahí)? No es un bug, es una decisión de
   negocio que depende de qué tanto peso le da Dani a Expedia en esas ventanas.
   **(la mezcla VIP real, clave `expediaVipTierMix`, bloquea Expedia por separado —
   confirmar el % del techo no reemplaza confirmar la mezcla real de huéspedes.)**
9. % exacto del descuento no reembolsable de Airbnb, si este listing lo tiene activo.
   Hoy apagado en 0% por defecto (nadie inventó un 10%). **(clave `airbnbNonRefundable` —
   solo bloquea Airbnb si Dani activa este descuento sin confirmar el % real.)**
10. **[Actualizado]** Moneda real y tipo de cambio por canal — ya se pregunta explícitamente
    por canal (`channel.settlementCurrency`, pestaña de cada canal) y por tipo de cambio
    (`state.fxRates`, Resumen → "Moneda y tipo de cambio"). Ver punto 4.
11. **[Nuevo]** Reconciliar reservas reales: la herramienta existe (Resumen → "Validar
    contra una reserva real") pero no se ha cargado ninguna conciliación real de ninguna
    unidad todavía — el checklist de auditoría de cada unidad seguirá en "simulación"/
    "datos parciales" hasta que Dani compare al menos una reserva real reciente por canal
    contra el estimado del motor.

---

## 6. Bugs ya corregidos — no reintroducir

- `worstNative()` debe escanear duraciones (`los`) además de ventanas; si solo prueba 1
  noche, los descuentos por duración larga quedan invisibles para el cálculo del piso.
- Las alertas deben leer `state.channels`, nunca `model.channels` (el objeto que
  devuelve `compute()` no tiene ese campo).
- `pct2` (helper que permite negativos, para offsets) debe declararse ANTES de cualquier
  función que lo use — en JS con `const`, el orden de declaración importa.
- Al cargar una unidad guardada, hacer merge de `channels` campo por campo contra los
  defaults, nunca sobrescribir el arreglo completo — si no, unidades guardadas antes de
  agregar `bankFeePct`/`offsetPct` los pierden en silencio.
- La comisión bancaria NO se compone con la comisión de la OTA — ver sección 2.
- El input de `%` de cada descuento (`discountRowHTML()`) tenía `disabled` cuando el
  checkbox `on` estaba apagado — impedía configurar el porcentaje antes de activar el
  descuento. El checkbox controla si el motor lo cuenta, no si se puede editar; el input
  debe estar siempre habilitado.
- El listener de `change` llamaba a `renderCatalog()` cuando se marcaba/desmarcaba el
  checkbox `on` de un descuento — esa función NUNCA existió en el archivo. Cada toggle
  tiraba un `ReferenceError` no capturado que abortaba el resto del handler, así que
  `renderAll()` (la línea siguiente) nunca se ejecutaba: alertas/KPIs/matriz quedaban
  congelados sin avisar nada en la UI. `renderAll()` ya reconstruye el catálogo completo
  (vía `renderChannelPages()`), así que no hace falta ninguna función aparte — se quitó la
  llamada rota, no se creó `renderCatalog()`.
- El Piso (`compute()`) no incluía el offset por canal en el denominador — con offset
  negativo (bajar precio para competir en un canal) el piso dejaba de proteger de verdad
  contra vender bajo costo. Ver sección 2 para la fórmula corregida y por qué el Base NO
  debe llevar el mismo fix (es intencional que el Base no tenga offset).
- `suggestedOffset()` no contaba la tarifa de aseo de Airbnb ni usaba una duración de
  estadía real (evaluaba siempre a 1 noche) — el offset sugerido salía más alto de lo
  necesario. Corregido con `state.avgNights` + `cleanFeePerNight()`, ver sección 2.
- El `<details class="discounts-more">` del catálogo colapsado se cerraba solo con
  cualquier cambio en la página — `renderChannelPages()` reconstruye `panel.innerHTML`
  completo en cada `renderAll()` y nunca reaplicaba el atributo `open`. Fix: leer
  `panel.querySelector('.discounts-more')?.open` ANTES de sobrescribir el innerHTML y
  reinyectarlo en el HTML nuevo. Cualquier elemento con estado propio (`open`, scroll,
  foco) que viva dentro de un bloque re-renderizado por innerHTML necesita este mismo
  patrón de "leer antes de pisar" — no asumir que el estado del DOM sobrevive solo.
- Descuentos con `lockN:true` mostraban el `minN`/`from` GUARDADO en la unidad, no el del
  catálogo actual — si una unidad se guardó antes de que ese campo se bloqueara (cuando aún
  era editable), el número quedaba congelado en el valor viejo para siempre, sin forma de
  corregirlo desde la UI (el input ya no existe). Fix: al cargar una unidad, resincronizar
  `minN`/`from`/`to` de cada descuento `lockN` al valor de `defaultDiscounts()`, ver sección 2.
- `combineChannel()` para Expedia filtraba el grupo `base` solo con `windowApplies()`, que
  siempre da `false` para `kind:'los'` — cualquier descuento de Expedia por duración de
  estadía quedaba matemáticamente inactivo aunque se configurara y activara bien. Fix:
  `windowApplies(d,daysOut)||losApplies(d,nights)`, ver sección 2 (`ex_los1`).

---

## 7. Sobre el deploy — ya no hace falta el flujo manual

Antes de mover el desarrollo a Claude Code, cada versión se entregaba descargando el
archivo del chat y subiéndolo a mano a GitHub, o con un script que vigilaba la carpeta de
Descargas. Con Claude Code editando directo en esta carpeta del repo, ese flujo ya no es
necesario — Code puede hacer `git add / commit / push` directo tras cada cambio (con tu
confirmación si así lo prefieres). Los scripts de vigilancia (`actualizar-sitio.sh`,
`watch-and-deploy.sh`) se pueden borrar o dejar sin usar.

---

## 8. Cómo seguir

Cuando pidas un cambio, edita `index.html` en esta misma carpeta (ya tiene el `.git`
apuntando al repo real). Prueba la lógica pura (funciones sin DOM) con Node antes de dar
por bueno un cambio en el motor — así se hizo todo el desarrollo hasta ahora: extraer el
`<script>`, correr casos de prueba concretos con `node -e "..."`, y solo después dar el
archivo por validado. No asumas que un cambio en el motor de combinación es correcto sin
probarlo numéricamente primero.

---

## 9. Auditoría técnica jul 2026 (Fases 1-7) — arquitectura modular, motor, seguridad

Trabajo hecho en la rama `fix/motor-financiero-auditoria` (NO mergeado a `main`, sin
push) contra el hallazgo de una auditoría técnica independiente. Ver `CHANGELOG.md`
para el resumen fase por fase y `RUNBOOK.md` para QA manual/rollback/despliegue.

### Arquitectura: de un solo `<script>` a módulos ES puros
`index.html` ahora es un `<script type="module">` que importa de `src/catalog/` (datos)
y `src/domain/*.js` (funciones puras, sin DOM, todas con parámetros explícitos — nada
lee un `state` global implícito). `index.html` solo arma wrappers delgados que cierran
sobre el `state` mutable de la UI y funciones de render. Corolario práctico: **abrir el
archivo con doble-clic (`file://`) ya no funciona** — Chrome bloquea `import` por CORS
bajo `file://`. Para probar local: `python3 -m http.server` o `npx serve`. GitHub Pages
(https) no tiene este problema, el deploy sigue siendo automático sin build.

`package.json` es nuevo pero **no es un build step**: solo habilita `"type":"module"` y
los scripts `npm test` (`node --test`, cero dependencias) / `npm run lint`
(`node --check`). `engines.node >= 20.0.0`. CI en `.github/workflows/ci.yml` corre ambos
en cada push/PR — no toca el despliegue de Pages.

### `quoteScenario()` — fuente única de verdad (`src/domain/quote.js`)
Cualquier vista que necesite cotizar UN escenario concreto (canal + días + noches +
precio) pasa por aquí — Piso (indirectamente, vía `worstNative()`/`payoutFactor()`
compartidos), alertas (TECHO/PISO/DURACIÓN), Simulador, matriz y "neto estimado" por
canal. Ninguna vista debe reimplementar el pipeline LM→Offset→nativos→aseo→comisiones.
Devuelve, entre otros: `factor`/`nativoFactor` (exacto, para matemática financiera),
`nativoPct`/`totalPct` (redondeado, SOLO para texto/UI — nunca para calcular),
`marginPct` (ganancia sobre venta) vs `markupPct` (ganancia sobre costo, número
distinto), y `assumptions[]` (lo que el resultado da por sentado y aún no está
verificado).

**Regla dura, no violar en cambios futuros**: si una fórmula financiera nueva necesita
`totalPct`, es un error — usar `factor` (o `nativoFactor` desde `quoteScenario()`).
`totalPct` existe solo porque se redondea a 1 decimal para que se vea bien en pantalla;
usarlo en un cálculo reintroduce el bug de Fase 2.1 (Genius 0.1% + Mobile 50% = 50.05%
exacto, pero `Math.round((1-0.4995)*1000)/10` da 50.0 por ruido de punto flotante — un
Piso dimensionado con eso netea por debajo del costo real).

### Enumeración exhaustiva de críticos, no muestreo (`src/domain/thresholds.js`)
`combineChannel()` es piecewise-constante en días/noches enteros — el máximo real
siempre vive en una frontera exacta (`from`, `to`, `from-1`, `to+1`, `minN`, día 0).
`criticalDays()`/`criticalNights()` enumeran esas fronteras para `worstNative()`;
`criticalDaysInWindow()` hace lo mismo pero recortado a una ventana UI concreta, para
que las alertas y la matriz ya NO usen un punto medio (`Math.min(w.lo+1,w.hi)`) — ese
punto medio podía dejar invisible, dentro de su propia ventana, un early-bird que solo
arranca a los 90 días.

### Costo por reserva, no por promedio (`src/domain/costs.js`)
`reservationCost()`/`reservationCostBreakdown()` cargan limpieza/lavandería/insumos UNA
VEZ por reserva (usando las noches REALES de ese escenario), nunca diluidos por una
estadía promedio fija — ese era el bug P5/P13 (`costs-legacy.js`, que se deja intacto
como registro histórico del bug, ya no lo usa nada). `compute()`/`quoteScenario()` usan
esto automáticamente SI `config.costBreakdown` está presente Y tiene algo cargado
(`costBreakdownIsFilled()` en index.html) — si Dani nunca toca la calculadora detallada,
cae al modelo simple `fixedCost+varCost` de siempre, cero regresión.

### PriceLabs Last-Minute configurable (`src/domain/pricelabs-lm.js`)
5 modos por unidad (`state.lmConfig`): automático (el techo-por-ventana de siempre, se
marca explícitamente "no verificable matemáticamente sin precio diario real"), plano,
gradual (decae día a día, NO aplica el máximo a todos los días), precio fijo (avisa si
cae bajo el Piso), tramos (política de solape EXPLÍCITA: gana el PRIMER tramo activo del
arreglo en orden, nunca se suman — si Dani confirma que PriceLabs combina distinto, esta
política se ajusta en un solo lugar). Se despacha DENTRO de `quoteScenario()`, antes del
Offset y de los descuentos nativos OTA, como pedía el encargo original.

### Descuento no reembolsable de Airbnb (`ab_nonref`, catálogo)
Capa apilable POST-promo en `combineChannel()` — se aplica DESPUÉS de que gana la promo
del grupo `'promo'`, no compite dentro de ese grupo. Apagado, en 0% y `verified:false`
por defecto: nadie inventó un 10%, Dani debe confirmar por listing si aplica y el % real.

### Verificado / No-verificado (`src/domain/verification.js`) y bloqueo real por canal (`src/domain/readiness.js`, FASE 5)
Registro por unidad para hechos que la app NUNCA puede confirmar sola (Genius+Mobile
ambos activos en Booking, aislamiento real del Offset en Hospy, comisión bancaria real
por canal, mezcla de niveles VIP de Expedia, modo real de Last-Minute, no-reembolsable de
Airbnb). Cada clave declara un `scope`: `'global'` (un registro para toda la unidad) o
`'channel'` (un registro POR CANAL — hoy solo `bankFeePctByChannel`, porque la comisión
bancaria real puede confirmarse en un canal y no en otro). Cada registro guarda
`{status, source, date, note}` — no solo `status/note` como antes. `status` puede ser
`'no_verificado'` (pendiente, bloquea), `'verificado'` (confirmado, no bloquea) o
`'no_aplica'` (Dani confirmó explícitamente que ese dato no es relevante para esta
unidad/canal — tampoco bloquea, pero es una resolución explícita, distinta de "pendiente").
Todo arranca en `'no_verificado'` — pasar a otro estado es una acción explícita de Dani,
nunca automática ni asumida al cargar una unidad vieja que no tenía esta clave (ni al
importar un archivo con un `status` desconocido o con forma inválida — se descarta a favor
de `'no_verificado'`, ver `src/domain/persistence.js`).

**FASE 5 (revisión externa — "datos financieros verificados"): esto dejó de ser una
etiqueta visual y pasó a ser una regla real de bloqueo.** Antes, el código ya sabía que
estos datos estaban "no verificados", pero ninguna vista lo usaba para impedir nada —
Piso/Base/Offset/"Rentable" se mostraban igual de confiados. `evaluateRecommendationReadiness()`
(`src/domain/readiness.js`, función pura, la única fuente de esta regla) recibe
`{channels, discounts, verification}` y decide, **por canal**, qué dato pendiente lo
afecta:

| Dato (`VERIFICATION_KEYS`) | Alcance | Afecta a... | Cuándo aplica |
|---|---|---|---|
| `hospyOffsetIsolated` | global | cualquier canal con Offset ≠ 0% | siempre que ese canal tenga Offset configurado |
| `bankFeePctByChannel` | **por canal** | el canal cuya comisión bancaria/pasarela > 0% | por defecto Booking y Directo (6%); Airbnb/Expedia en 0% no lo necesitan |
| `bookingGeniusMobileBoth` | global | Booking | solo si Genius Y Mobile Rate están AMBOS activos |
| `expediaVipTierMix` | global | Expedia | solo si la Oferta VIP (`ex_mod`) está activa |
| `airbnbNonRefundable` | global | Airbnb | solo si el no-reembolsable (`ab_nonref`) está activo |
| `priceLabsLmMode` | global | (informativo) | el bloqueo real de LM ya vive en `lmConfig.verified`/`isLmBlocked()` — esta clave es solo para dejar nota/fuente/fecha de esa confirmación, nunca una segunda fuente de verdad |

`compute()` expone `readiness` (el resultado completo, por canal) y
`floorReadinessBlocked`/`baseReadinessBlocked` — el gate GLOBAL para Min Price/Base Price.

**Corrección P1 (revisión externa — "Min Price/Base Price globales siguen siendo
inseguros"): `floorReadinessBlocked`/`baseReadinessBlocked` bloquean si CUALQUIER canal
ACTIVO tiene un dato pendiente — no solo el canal que HOY fija el Piso/Base
(`floorChId`/`baseChId`).** Min Price y Base Price son números **GLOBALES**: un solo valor
que se lleva a PriceLabs y rige los 4 canales a la vez. Caso real que esto corrige: Airbnb
fija hoy el Piso (su comisión efectiva es la más alta con el catálogo de fábrica); Directo
NO lo fija hoy (comisión más baja), pero tiene su comisión bancaria real sin confirmar — si
esa comisión real resulta más alta de lo asumido, Directo podría pasar a ser el canal que
fija el Piso. Mientras eso siga sin confirmarse, Min Price/Base Price no se pueden tratar
como recomendación confiable, **aunque el canal que manda hoy (Airbnb) esté perfectamente
verificado**.

**Refactor de cierre — `evaluateGlobalRecommendationReadiness()` (`src/domain/readiness.js`),
la ÚNICA fuente de verdad, y `engine.js` la consume directamente (ya no hay una segunda
copia de la regla).** Contrato exacto — `evaluateGlobalRecommendationReadiness({readiness,
channels, lmBlocked, baseBlocked})` devuelve:

| Campo | Regla |
|---|---|
| `floorReady` | `true` **solo si** todos los canales activos tienen sus datos financieros resueltos (`unreadyChannels(...).length===0`) **y** `lmBlocked===false`. |
| `baseReady` | `true` **solo si** `floorReady===true` **y** `baseBlocked===false`. |
| `unreadyChannels` | lista de canales (`{id,name,...}`) con al menos un dato pendiente. |
| `reasons` | frases reusables (datos de negocio + LM + precio fijo, las que apliquen). |
| `floorReason`/`baseReason` | texto listo para mostrar, o `null` si está `ready`. |

Puntos del contrato que NO deben revertirse sin querer:
- **`baseBlocked` (precio LM fijo activo en el día 45) NUNCA bloquea `floorReady`** — el
  Piso sigue protegiendo de verdad porque evalúa el **peor escenario real** (LM incluido,
  vía `worstScenarioFactor()`), a diferencia de Base, que solo evalúa el día de referencia
  45 (y por eso SÍ queda irrelevante cuando ese día tiene un precio fijo).
- **`lmBlocked` bloquea AMBOS** — un LM sin verificar hace que cualquier número global
  (Piso incluido) sea una proyección no verificable.
- **Un dato de negocio pendiente en CUALQUIER canal activo bloquea AMBOS** — el mismo
  razonamiento del caso Airbnb/Directo de arriba aplica igual a Base.

`engine.js` deriva `floorReadinessBlocked = !floorReady`, `floorReadinessBlockedReason =
floorReason`, `baseReadinessBlocked = !baseReady`, `baseReadinessBlockedReason = baseReason`
— **nunca recalcula `unreadyChannels()` ni arma su propio texto de motivo**; ese fue
exactamente el bug de arquitectura que este refactor cierra (existía una
`globalRecommendationReady()` documentada y con tests, pero `engine.js` no la consumía —
calculaba su propia versión inline, con riesgo real de desalinearse). Hay un test dedicado
(`tests/fase5-financial-readiness.test.js`, "engine.js consume
evaluateGlobalRecommendationReadiness() como UNICA fuente...") que compara campo por campo
el resultado de `compute()` contra una llamada directa a la función central con los mismos
insumos — si alguien reimplementa la lógica inline en `engine.js`, ese test falla.

`unreadyChannels(readiness, channels)` (el bloque de construcción interno, también
exportado) es la función que responde "¿qué canales, de la lista dada, siguen con algo
pendiente?" — la reusan `matrix.js` (veredicto "RENTABLE EN TODOS" por ventana) y
`alerts.js` (fallback "Sin conflictos") para su propia pregunta, legítimamente distinta
("¿esta ventana/alerta puntual es confiable?", no "¿el número GLOBAL lo es?") — ninguno de
los dos llama a `evaluateGlobalRecommendationReadiness()`, y `engine.js` no reimplementa el
filtro de `matrix.js`/`alerts.js`.

La Matriz (`buildMatrixVerdict()`) nunca dice "RENTABLE EN TODOS" si CUALQUIERA de los 4
canales de esa ventana depende de un dato pendiente (no solo el más ajustado) — el
veredicto cambia a "DATOS SIN VERIFICAR — NO USAR COMO RECOMENDACIÓN". Igual la alerta
"Sin conflictos" (`buildAlerts()`) de Resumen. El Simulador NUNCA bloquea la simulación
manual por canal (diagnóstico/simulación individual sigue disponible aunque el global esté
bloqueado por OTRO canal), pero la etiqueta "SIMULACIÓN NO CONFIABLE" mientras el canal
elegido dependa de algo pendiente (LM incluido). El botón "Ver el paso a paso" tampoco
precarga Base cuando `baseReadinessBlocked` es true — y nunca sugiere "configura este
precio global en PriceLabs" mientras esté bloqueado. En `index.html`, todo consumidor
(KPIs, intro de Matriz, botón "Ir al simulador", precarga del Simulador) lee directamente
`model.floorReadinessBlocked`/`model.baseReadinessBlocked` como el ÚNICO booleano de
bloqueo — `model.lmBlocked`/`model.baseBlocked` solo se leen ahí para elegir CUÁL texto
corto mostrar (el motivo más específico primero), nunca para volver a unir los tres gates
con `||` (esa unión ya la hizo `evaluateGlobalRecommendationReadiness()`).

### Planificación mensual y reparto de utilidad (`src/domain/monthly-economics.js`)
Responde lo que `compute()`/`quoteScenario()` (rentabilidad de UNA reserva concreta)
no responden: ¿la unidad es rentable al final del mes?, ¿cuántas noches hay que
vender para no perder plata?, ¿qué le queda al propietario y al administrador/PM?
Dos conceptos separados a propósito, no los mezcles:
- **Rentabilidad por RESERVA** (`compute()`/`quoteScenario()`): costo real de una
  reserva concreta de N noches, `reservationCostBreakdown()` sin diluir
  limpieza/lavandería/insumos por promedio. Sin cambios.
- **Planificación MENSUAL** (`monthly-economics.js`): costos fijos mensuales
  completos + una estimación de cuántas reservas caben en el mes. Es una
  PROYECCIÓN de planificación, nunca el costo exacto de cada reserva real.

**Fuente de costos — reutiliza `state.costBreakdown` tal cual, cero campo nuevo:**
costos fijos mensuales = `rent+admin+utilities+insurance+tech` (ya eran montos
mensuales completos, ver `costs.js`); variable/noche = `consumables`; costo por
reserva (una vez, no diluido) = `cleaning+laundry+supplies`; noches ocupadas
planeadas = `occNights` (ya significaba "noches ocupadas al mes"). Si la
calculadora detallada no está llena, el módulo se niega a inventar un total
mensual desde el modelo simple `fixedCost`/`varCost` por noche —
`computeMonthlyEconomics()` devuelve `{ok:false, reason}`, nunca un número
fabricado. Lo mismo si falta la Estadía promedio o el escenario de ingreso.

**Reservas estimadas = noches ocupadas planeadas ÷ estadía promedio.** El costo
por reserva (turno) se multiplica por ESTE número, nunca por las noches ocupadas
directamente — evita reintroducir el bug P5/P13 (diluir el turno por promedio) a
nivel mensual.

**Punto de equilibrio** — contribución REAL por noche ocupada:
`neto/noche − consumo/noche − costo por reserva ÷ estadía promedio`. Si esa
contribución es `<= 0`, el equilibrio es explícitamente `{reachable:false}` —
NUNCA `Infinity` ni un número falso: ningún volumen de ventas cubre los fijos con
ese precio/costo. Los costos fijos mensuales NUNCA desaparecen con cero reservas
(probado: 0 noches ocupadas → pérdida exacta = costos fijos mensuales, ni un peso
menos).

**Reparto Propietario/Administrador (PM) — política única, documentada aquí, no
la reinventes en otro lado:**
- `reservePct`/`taxReservePct` son % del **ingreso neto mensual** (retención tipo
  impuesto, sobre lo facturado, antes de repartir utilidad).
- `ownerTargetPct`/`managerTargetPct` son % de la **utilidad distribuible** (lo
  que queda DESPUÉS de costos fijos+variables+reserva+impuestos).
- Los cuatro viven bajo un único interruptor, `distribution.configured` — si está
  en `false` (default de fábrica, y de cualquier unidad vieja que no lo tenía),
  NINGUNO de los cuatro aplica, ni siquiera si quedó un valor viejo en `state`
  (bug real encontrado y corregido durante el desarrollo: desactivar el reparto
  debe volver EXACTAMENTE al mismo resultado que nunca haberlo configurado).
- El `margin` existente (objetivo total sin repartir, usado en Piso/Base/Offset
  por-reserva) **NUNCA** se reparte automáticamente entre Propietario/PM —
  `computeMonthlyEconomics()` no lee ese campo en absoluto. Activar el reparto
  detallado es una acción explícita de Dani, con aviso mientras esté apagado.

**Tres escenarios de ingreso mensual** (`incomeScenario.type`):
- `'manual'`: neto/noche que Dani escribe directo — nunca se marca "no
  verificado" (es un dato que Dani ya confirmó al escribirlo, no una proyección
  del motor). **Corrección P2 (revisión externa):** el default de fábrica es
  `manualNetPerNight: null` ("todavía no lo escribiste"), **nunca `0`** — un `0`
  es un ingreso real de cero, no la ausencia del dato, y el bug real era que el
  default viejo (`0`) pasaba la validación de "es un número finito" y una
  unidad nueva (donde nadie tocó este campo) mostraba una proyección de
  PÉRDIDA mensual completa basada en un ingreso que nadie configuró.
  `null`/`undefined`/`''`/`0`/negativo devuelven `{ok:false, reason:'Falta
  ingresar neto manual por noche...'}` explícito — solo un número `> 0` calcula.
  No existe (a propósito) una vía para "simular en 0" sin escribir un número
  real: nadie lo pidió y abriría el mismo hueco por otra puerta.
  `src/domain/persistence.js` preserva `null` exactamente (sin generar un
  warning falso positivo — `null` es un estado válido, no un dato inválido) vía
  `nullableNumField()`, y migra cualquier unidad vieja sin este campo al mismo
  default seguro (`null`, nunca `0`).
- `'channel'`: cotiza con `quoteScenario()` REAL (misma fuente única que Piso/
  Base/Matriz/Simulador) — cero fórmula de comisiones/descuentos/LM/Offset
  paralela en este archivo.
- `'mix'`: promedio ponderado de varios canales cotizados con `quoteScenario()`;
  los pesos deben sumar 100% exacto — nunca se normaliza en silencio si suman
  otra cosa.

Si el escenario `'channel'`/`'mix'` depende de LM sin verificar (`quoteScenario().lmBlocked`)
o de un dato de negocio pendiente (Fase 5, `readiness.byChannel[chId]`), el
resultado se etiqueta `incomeSource.unverified:true` — la UI muestra
"SIMULACIÓN NO CONFIABLE" pero SIGUE calculando: nunca se bloquea la simulación
manual/exploratoria, solo se etiqueta como no confiable para no usarla como
recomendación automática.

Persistencia: `monthlyIncomeScenario`/`monthlyDistribution` siguen la misma
disciplina que el resto de `normalizeUnit()` — solo canales conocidos
(whitelist contra `CHANNELS`), porcentajes fuera de `[0,100]` se descartan a
favor del default, un `type` desconocido cae a `'manual'` (el más seguro — nunca
calcula sin que Dani escriba un número él mismo), una unidad vieja sin estos
campos recibe el default seguro (reparto apagado, escenario manual SIN
CONFIGURAR — `manualNetPerNight:null`, nunca `0`, ver corrección P2 más abajo).

### Preparación para datos reales: reconciliación de reservas, contrato de moneda y auditoría (`src/domain/reconciliation.js`, `src/domain/currency.js`, `src/domain/audit.js`)

El motor es matemáticamente correcto dado lo que Dani configura — pero eso NO
prueba que la configuración represente su cuenta real. Esta sección responde
"¿cómo sé si el modelo se está desviando de lo que de verdad pasa en mis
reservas?" sin inventar ningún dato nuevo (comisión, impuesto, tipo de cambio,
promoción o regla de plataforma).

**Reconciliar una reserva** = comparar el estimado que da `quoteScenario()`
(el mismo motor que ya usan Piso/Base/Matriz/Simulador, nunca una fórmula
paralela) contra los datos REALES de una reserva/liquidación ya cerrada que
Dani escribe a mano: canal, precio publicado, noches, días de anticipación,
comisión OTA real, comisión bancaria real, tarifa de aseo cobrada, payout
recibido, moneda, y una referencia de reserva opcional (nunca datos del
huésped — nombre/email/teléfono no se piden ni se guardan).

**Diferencia entre estimado y liquidación real**: `reconcileReservation()`
(`src/domain/reconciliation.js`) calcula `payoutReceivedEnMonedaBase −
estimate.payout`, en absoluto y en %. Severidad — umbral fijo, documentado en
el código, no lo reinventes en otro lado:
- `|diff%| <= 3%` → `'ok'` (ruido normal, confiable).
- `real > estimado` y `|diff%| > 3%` → `'warn'` (mejor de lo esperado —
  informativo, no una alarma).
- `real < estimado` y `|diff%| > 10%` → `'bad'` (alerta clara: estás
  recibiendo menos de lo que el modelo asume, revisa qué cambió).
Si Dani escribió comisión OTA/bancaria/tarifa de aseo/descuento nativo
reales, cada uno se compara contra lo configurado y aparece en el desglose
con una causa explícita; si no escribió ninguno, la causa queda genérica
("ingresa comisiones/tarifas reales para acotar el motivo"). **La
reconciliación NUNCA cambia `channels`/`discounts` automáticamente** — solo
sugiere qué revisar; confirmar un valor real sigue siendo 100% manual en
Resumen → "Verificación de datos financieros".

**Contrato de moneda** (`src/domain/currency.js`) — la app soporta 2 monedas
(USD/COP). Cada unidad tiene una moneda BASE (`state.currency`, la de
siempre); cada canal puede declarar su propia `settlementCurrency` si liquida
en OTRA moneda (ej. Airbnb vía Supra en USD mientras la unidad opera en
COP) — `null` (default) significa "misma que la unidad". `resolveConversion()`
es la ÚNICA función que convierte un monto entre monedas: si
`fromCurrency===toCurrency` no hay nada que convertir; si son distintas, EXIGE
una entrada en `state.fxRates[fromCurrency]` con `status:'verificado'` y un
`rate` numérico finito `> 0` — cualquier otra cosa (entrada ausente,
no_verificado, rate vacío/0/negativo/NaN/texto) **bloquea** la conversión,
nunca asume 1:1 ni inventa un valor. Nunca se llama a una API externa de tipo
de cambio. Dos consumidores reusan esta misma función (nadie reimplementa la
regla): `reconciliation.js` (convierte el payout real antes de comparar) y
`monthly-economics.js` (escenarios `'channel'`/`'mix'` — si el canal usado
liquida en otra moneda sin FX verificado, el escenario ENTERO queda
`ok:false`, nunca mezcla montos en silencio). Una cotización de un solo canal
en su propia moneda sigue mostrándose sin este chequeo — el bloqueo aplica
solo cuando dos montos en monedas distintas necesitan consolidarse en un
número.

**Auditoría de datos reales** (`src/domain/audit.js`, `buildAuditChecklist()`)
— rollup puro de señales que YA calculan otros módulos (nunca reimplementa
qué está pendiente): costos reales cargados, comisiones por canal
verificadas, Last-Minute verificado, Offset verificado, promociones
verificadas (Booking Genius+Mobile, Expedia VIP, Airbnb no-reembolsable),
moneda/tipo de cambio verificado si aplica, y la última reserva conciliada
con su diferencia. Estado final — **SOLO 3 valores, NUNCA "producción"**:
- `'simulacion'`: los costos siguen en el valor ilustrativo de fábrica.
- `'datos_parciales'`: hay costos reales pero falta confirmar algo, o no se
  ha conciliado ninguna reserva, o la última conciliación no fue confiable.
- `'listo_supervisado'` ("listo para uso interno supervisado"): costos
  reales, TODO el negocio confirmado, LM confirmado, moneda resuelta si
  aplica, y al menos una reconciliación reciente dentro de lo esperado.
  Sigue sin ser "producción" — esa palabra la usa Dani, nunca la herramienta.

**Qué revisar antes de confiar en una recomendación de precio** (checklist
recomendado, en orden):
1. Airbnb: comisión real (Host-Only o Split-Fee), tarifa de aseo por listing,
   si el descuento no reembolsable está activo y su % exacto.
2. Booking.com: extranet → confirma si Genius y Mobile Rate están AMBOS
   activos hoy (cambia cuál canal fija el Piso).
3. Expedia: mezcla real de niveles VIP de tus huéspedes (hoy se asume el
   peor caso, 20%).
4. Hospy/PriceLabs: si el Offset por canal se aísla de verdad por canal o se
   distribuye a todos los conectados; el modo real de Last-Minute que usa la
   cuenta.
5. Extractos bancarios/pasarela: comisión real por transacción, y si hay un
   tipo de cambio real distinto al configurado (compáralo contra `fxRates`).
6. Guarda una conciliación real por canal periódicamente — un solo dato
   verificado en el formulario no reemplaza revisar reservas de verdad.

**Limitaciones explícitas de esta herramienta**: no llama a ninguna API
(PriceLabs, bancos, tipo de cambio) — todo dato real lo escribe Dani a mano;
no detecta automáticamente cuándo una comisión configurada quedó desactualizada
(solo lo hace evidente si Dani concilia una reserva); las conciliaciones
guardadas viven SOLO en este navegador (`localStorage`, mismo mecanismo que
el resto de la app) — no hay respaldo en la nube más allá de Exportar/Importar
manual; el checklist de auditoría es un resumen, no un sustituto de revisar
la cuenta real periódicamente.

### Validación y bloqueo (`src/domain/validate.js`)
El motor nunca lanza (`compute()`/`quoteScenario()` siempre devuelven algo), pero
`compute()` ahora también devuelve `valid`/`errors`. Un resultado no confiable (margen
≥100%, comisión+bancaria ≥100%, costos negativos, NaN/Infinity) se BLOQUEA en la UI
(banner rojo + KPIs en "—" con el motivo) en vez de mostrarse como si fuera una
recomendación real. Aviso aparte (`#dataProvenanceBanner`) mientras `fixedCost`/`varCost`
sigan exactamente en 32/22 — el ejemplo ilustrativo del webinar de Kunas, NUNCA los
costos reales de una unidad (ver sección 5, punto 1).

### Persistencia: UUID, migración no destructiva, XSS (`src/domain/persistence.js`,
`src/domain/sanitize.js`)
- **Guardar ahora escribe siempre a `v3:<uuid>`** (`state.id`, generado en el primer
  guardado) — ya no colisiona si dos unidades comparten nombre o si se renombra una.
  `v2:<slug-del-nombre>` (formato viejo) se sigue pudiendo cargar/exportar, pero ya no
  recibe escrituras nuevas.
- **Migración v2→v3 es un botón explícito** ("Migrar unidades antiguas"), nunca
  automática al cargar la página — copia cada `v2:*` a un `v3:<uuid>` nuevo con
  `migratedFromV2Key` de rastro, y **jamás borra ni toca los `v2:*` originales**.
- **Eliminar pide confirmación** (`confirm()`) — antes no pedía ninguna, un click
  borraba sin aviso.
- **Importar valida la FORMA del archivo** (`validateImportFile()`) antes de escribir
  nada a storage — un archivo malformado se rechaza entero; elementos individuales
  inválidos dentro de un archivo por lo demás válido se descartan y se listan, no se
  escriben a ciegas.
- **XSS corregido**: un nombre de descuento/canal/unidad con HTML/JS embebido (ej. vía un
  archivo de "respaldo" importado, no necesariamente por Dani) se ejecutaba al
  renderizarse en el catálogo de descuentos, la matriz, el Simulador, las alertas y la
  lista de unidades — `escapeHtml()` se aplica en TODOS esos puntos ahora. Cualquier
  interpolación NUEVA de un campo de texto proveniente de `state`/`discounts`/`channels`
  dentro de un `innerHTML` DEBE pasar por `escapeHtml()` — no asumir que el dato es
  confiable solo porque hoy lo escribe la propia UI (mañana puede venir de un import).

### Actualización (revisión externa) — LM integrado en Piso/Base-offset/Matriz, XSS/import endurecidos, E2E
Una revisión posterior encontró que `compute()`/`suggestedOffset()` nunca recibían
`lmConfig`/`ceilings` — el Piso ignoraba Last-Minute por completo aunque hubiera un
modo VERIFICADO configurado (caso reproducido: Directo, costo 100, LM flat 50%
verificado → Piso viejo 109.89 neteaba 50 real, no 100). Corregido en
`src/domain/worstcase.js` (enumeración exhaustiva canal×día×noche×OTA×LM×offset,
usada por `compute().floor`) y `src/domain/matrix.js` (la fila de la matriz ahora
elige el escenario de PEOR PAYOUT real, no el de mayor descuento nativo). El
descuento por defecto (`ceiling_auto`, modo de todas las unidades hasta que Dani
confirme otro) ahora SÍ protege el Piso — el Piso base pasó de USD 90 a USD 111 en
el estado por defecto, un cambio de número esperado y correcto, no una regresión.
`quoteScenario()` expone `lmMode`/`lmVerified`/`lmBlocked`; los veredictos
"RENTABLE EN TODOS" que dependen de LM automático sin confirmar ahora se marcan
"⚠ LM SIN VERIFICAR" explícitamente. `src/domain/persistence.js` ganó
`normalizeUnit()` — normalización estricta y única para cualquier registro v2/v3
(guardar/cargar/importar/migrar todos pasan por ahí): todo campo numérico se
coerciona con validación explícita (nunca `Math.max(0,x)` ni `parseFloat(x)||0`
silenciosos — un valor inválido se descarta a favor del default y se reporta en
`warnings`), ids desconocidos de descuentos/canales se descartan, tramos LM
malformados no rompen la UI. Esto cierra en la raíz el vector XSS que quedaba en
atributos "numéricos" (`pct`, `comm`, `offsetPct`, etc.) — el import ahora
re-serializa la versión normalizada antes de escribir a storage, no el JSON crudo.
La alerta REALIDAD también migró a `worstScenarioFactor()`+`quoteScenario()` (antes
tenía su propia fórmula sin LM ni aseo) — cero fórmula financiera duplicada en todo
`alerts.js`. Se agregó E2E automatizado real (Playwright, `e2e/smoke.spec.js`,
corre en CI job `e2e`) cubriendo carga limpia, Simulador, bloqueo de validación,
guardar/cargar/eliminar con confirmación, importación con payload XSS real
(confirma que no se ejecuta), y la matriz.

### Actualización (revisión externa, RONDA 2) — LM bloqueante propagado a la UI, Base incorpora Offset/LM real, fin de las coerciones silenciosas en edición manual, fix día/noche en Matriz
Una segunda revisión encontró cuatro bloqueantes sobre la ronda anterior:

1. **CRÍTICO** — `quoteScenario()` ya calculaba `lmBlocked` por escenario, pero
   `compute()` seguía devolviendo `valid:true` y la UI mostraba Min Price/Base Price
   como si fueran confiables, incluso con la CONFIGURACIÓN POR DEFECTO (LM automático,
   sin verificar). `compute()` ahora devuelve `lmBlocked`/`lmBlockedReason`
   (`isLmBlocked()`, `src/domain/pricelabs-lm.js` — fuente única, la comparten
   `compute()`, `quoteScenario()`, `alerts.js` y `matrix.js`). `ceiling_auto` bloquea
   SIEMPRE, incluso marcado "verificado" (es una proyección matemática, no un hecho
   confirmable). Con la config por defecto de una unidad nueva, Min Price, Base Price y
   el Offset sugerido de cada canal arrancan en "—" con un aviso que dice EXACTAMENTE
   qué falta confirmar y en qué pantalla (`Resumen → "Last-Minute de PriceLabs"`, con
   botón directo). La Matriz ya no agrega "⚠ LM SIN VERIFICAR" como texto suelto sobre
   un veredicto que sigue diciendo "RENTABLE EN TODOS" (`vLvl:'ok'`) — ahora
   `buildMatrixVerdict()` (`src/domain/matrix.js`, extraída de `renderMatrix()` para
   ser testeable sin DOM) cambia el veredicto ENTERO a un estado propio
   ("LM SIN VERIFICAR — NO USAR COMO RECOMENDACIÓN") cuando el único motivo por el que
   la ventana sale bien es un LM no verificable. Los veredictos negativos (TECHO
   EXCEDIDO/BAJO COSTO/CUBRE COSTO) NO se bloquean — son advertencias, no una
   afirmación de que todo está bien. La alerta "Sin conflictos" (fallback `OK` cuando
   `buildAlerts()` no encuentra nada que reportar) tiene el mismo tratamiento.
2. **ALTO** — el Base Price excluía Offset y LM por diseño ("Base es el precio uniforme
   SIN offsets"), pero eso volvía el texto "netea tu objetivo" matemáticamente falso en
   cuanto Dani configuraba un offset real o un LM verificado. Se optó por la opción
   recomendada por el revisor (en vez de renombrar Base a "referencia teórica"):
   `compute().base` ahora incorpora el Offset y el LM REALMENTE configurados de cada
   canal en su escenario de referencia (día 45) — sigue siendo un PUNTO ÚNICO, nunca una
   búsqueda exhaustiva (eso sigue siendo tarea exclusiva del Piso). `lmPctAtDay45()`
   (`engine.js`) es la única fórmula que resuelve LM a día 45 — la comparten
   `compute().base` y `suggestedOffset()` (antes cada uno la reimplementaba). Ver
   `tests/fase-base-property.test.js`, reescrito para probar offset negativo/positivo y
   LM activo SIN neutralizar nada (antes el test ponía `offsetPct:0` a propósito, lo que
   el revisor señaló como una prueba que no prueba el comportamiento real).
3. **MEDIO** — la edición MANUAL (no solo la importación) seguía usando
   `parseFloat(t.value)||0` en cada handler de `change` de `index.html`: un valor
   inválido se volvía 0 en silencio. `src/domain/input-parse.js` (`parseValue`,
   `parsePct`, `validateRange` — puras, testeadas) es ahora la fuente única que usan
   TODOS los campos numéricos editables a mano (descuentos, canales, techos, costos,
   LM, tramos). Un valor inválido NUNCA se escribe a `state`: el input vuelve a mostrar
   el último valor válido y aparece `#inputErrorToast` (visible en cualquier pestaña,
   posición fija) con el motivo exacto. Se agregó `validateLmTiersOverlap()`
   (`src/domain/validate.js`) — advertencia (no bloqueante) cuando dos tramos LM activos
   se solapan, explicando cuál gana con la política "primero del arreglo" ya existente.
4. **BAJO** — `worstScenariosInWindow()` devuelve `day`/`night` (`src/domain/matrix.js`),
   pero `renderMatrix()` leía `worstPayoutRow.d`/`.n` (nunca existieron) — la fila
   "Peor payout real detectado" siempre mostraba "día undefined". Corregido a
   `worstPayoutRow.day`/`.night`.

Tests nuevos: `tests/fase-lm-blocking.test.js`, `tests/fase-input-validation.test.js`,
`tests/fase-base-property.test.js` (reescrito), guardia de nombres de campo en
`tests/fase-matrix-worstcase.test.js`. E2E nuevos: `e2e/lm-blocking.spec.js`,
`e2e/manual-input-validation.spec.js`, `e2e/matrix-detail.spec.js`; `e2e/smoke.spec.js`
actualizado (la carga limpia ahora arranca bloqueada por diseño).

### Actualización (revisión externa, FASE 5) — verificación de datos financieros como regla real, no etiqueta
La revisión externa señaló que el registro de `verification.js` reconocía datos "no
verificados" pero ningún cálculo se bloqueaba por eso — el motor podía estar
matemáticamente correcto y aun así dar una recomendación incorrecta si esos datos no
representaban la cuenta real. Se agregó `src/domain/readiness.js`
(`evaluateRecommendationReadiness()`), la única fuente que decide, por canal, qué dato
pendiente lo afecta (ver tabla en la sección "Verificado / No-verificado" arriba). Cambios:

1. `verification.js`: cada registro guarda `status`/`source`/`date`/`note` (antes solo
   `status`/`note`); nuevo estado `'no_aplica'` (resuelto, no bloquea, distinto de
   `'no_verificado'`); `bankFeePctByChannel` pasó de un registro plano a uno POR CANAL.
2. `engine.js`: `compute()` rastrea `floorChId`/`baseChId` (qué canal fija cada número) y
   expone `readiness`/`floorReadinessBlocked`/`floorReadinessBlockedReason`/
   `baseReadinessBlocked`/`baseReadinessBlockedReason` — ortogonales a `lmBlocked`/
   `baseBlocked`, sin tocarlos. Solo se activa si `config.verification` viene explícito
   (mismo patrón que `lmConfig` — callers de test que no lo pasan no ven un bloqueo nuevo
   que no pidieron; en producción `state.verification` siempre está presente).
3. `matrix.js`/`alerts.js`: "RENTABLE EN TODOS" y "Sin conflictos" ya no se sostienen si
   CUALQUIER canal de esa ventana depende de un dato pendiente (no solo el más ajustado).
4. `persistence.js`: `normalizeVerification()` migra unidades viejas (incluido el formato
   plano pre-Fase-5 de `bankFeePctByChannel`) siempre a `'no_verificado'` por canal —
   JAMÁS hereda `'verificado'` de un registro que no era por canal. Un payload malformado
   (status inventado, campos no-string, objetos rotos) nunca se acepta como verificado.
5. `index.html`: KPIs/pestañas de canal/Matriz bloquean por canal con una explicación
   específica de qué falta y dónde confirmarlo; el Simulador etiqueta la simulación
   manual como "SIMULACIÓN NO CONFIABLE" (nunca la bloquea); el formulario de
   verificación ahora captura fuente/fecha/nota, con sub-filas por canal donde aplica.
   Prioridad de avisos en la pestaña de cada canal: `lmBlocked` > `baseBlocked` > dato de
   negocio pendiente > normal (el aviso de datos pendientes se agrega como nota, nunca
   reemplaza la explicación más específica de LM/precio fijo).

Tests nuevos: `tests/fase5-financial-readiness.test.js` (20),
`tests/fase5-verification-persistence.test.js` (8), `e2e/financial-readiness.spec.js` (9).
Tres E2E preexistentes (`e2e/lm-blocking.spec.js` ×2, `e2e/sim-blocked-bypass.spec.js` ×1)
asumían que verificar LM bastaba para desbloquear con el catálogo de fábrica — ya no es
cierto (los datos de negocio son un gate ortogonal nuevo); se ajustaron con un helper
`resolveAllFinancialFacts()` que aísla específicamente el comportamiento de LM que esos
tests prueban, sin cambiar lo que verifican.

### Actualización — Planificación mensual y reparto de utilidad
Nuevo `src/domain/monthly-economics.js` (contrato completo documentado arriba, sección
"Planificación mensual y reparto de utilidad") para responder rentabilidad de MES
completo (no solo de una reserva): ingreso neto mensual, costos fijos+variables,
utilidad distribuible, punto de equilibrio (nunca `Infinity`, "no alcanzable" explícito
si la contribución por noche es `<=0`), y reparto Propietario/Administrador (apagado
por defecto, política única documentada, nunca reparte el `margin` viejo
automáticamente). Reutiliza `state.costBreakdown` existente (cero campo de costos
nuevo) y `quoteScenario()` para cualquier ingreso modelado por canal (cero fórmula
financiera paralela). Nueva sección en Resumen: "Rentabilidad mensual y punto de
equilibrio" — KPIs del mes, tabla de sensibilidad por ocupación (0/5/10/15/20/25/30
noches), explicación textual de los supuestos. Se etiqueta "SIMULACIÓN NO CONFIABLE"
(reutilizando `readiness`/`lmBlocked` de Fase 5, sin reimplementar esa regla) cuando el
escenario de ingreso depende de un dato sin confirmar — nunca se bloquea, nunca se
presenta como recomendación automática.

Bug real encontrado y corregido durante el desarrollo (antes de cualquier commit):
`reservePct`/`taxReservePct` seguían aplicándose aunque `distribution.configured`
pasara a `false` (un valor viejo quedaba en `state` y el módulo lo aplicaba igual) —
corregido para que los cuatro porcentajes del reparto vivan bajo el mismo interruptor.

Tests: `tests/monthly-economics.test.js` (29, con fórmulas calculadas a mano en
comentarios — reconciliación exacta, punto de equilibrio en el borde de contribución
cero, reparto que suma exacto, `quoteScenario()` real para canal/mezcla, moneda que
nunca se mezcla), `e2e/monthly-economics.spec.js` (8). 155/155 unitarios, 42/42 e2e
(incluye rondas 2/3 y Fase 5, sin regresión).

### Pendiente explícito de esta ronda (no completado, no ocultado)
- **Accesibilidad**: se corrigieron los controles nuevos sin texto visible (editor de
  tramos). El resto del formulario (pre-existente, antes de esta auditoría) usa `<span>`
  en vez de `<label for>` — auditoría completa queda pendiente si se prioriza.
- Todo lo de la sección 5 (costos reales, comisión bancaria real, multi-moneda,
  multi-unidad, verificación real en Hospy/Booking/PriceLabs) sigue exactamente igual de
  pendiente — esta auditoría (y la Fase 5) construyeron la INFRAESTRUCTURA para que esos
  datos entren sin inventar nada, y AHORA ADEMÁS bloquean la recomendación de los canales
  afectados mientras sigan pendientes — pero ningún dato de negocio real fue inventado ni
  cargado; eso solo lo puede hacer Dani desde sus extranets/facturas/reportes reales.
- **Multi-moneda por canal (COP/USD) sigue sin convertir tasas** — fuera de alcance de
  esta ronda, no se tocó.
- **Reparto Propietario/PM real**: el módulo mensual construyó el mecanismo (política
  documentada, validación, apagado por defecto) pero los % reales de
  `ownerTargetPct`/`managerTargetPct`/`reservePct`/`taxReservePct` son una decisión de
  negocio 100% de Dani — nadie inventó un split (ni siquiera 50/50). Actívalo en
  Resumen → "Reparto Propietario/Administrador" cuando tengas esos números reales.

### Actualización (revisión externa) — P1: Min Price/Base Price globales inseguros; P2: neto manual mensual en 0 aceptado como dato real
Revisión independiente encontró dos fallos que los 155/42 tests anteriores no cubrían:

**P1 — el gate de Fase 5 solo miraba el canal que fija el número hoy, no todos los
canales activos.** `floorReadinessBlocked`/`baseReadinessBlocked` (`src/domain/engine.js`)
comparaban `channelReady(floorChId)`/`channelReady(baseChId)` — si el canal que hoy fija
Min Price/Base Price estaba confirmado, el número global se mostraba aunque OTRO canal
(que no fija el número hoy) tuviera un dato pendiente que podría hacerlo pasar a fijarlo
en cuanto se conociera su valor real (comisión bancaria, Offset, etc.). Corregido: nueva
función pura `unreadyChannels(readiness, channels)` (`src/domain/readiness.js`) — "¿qué
canales, de TODOS los activos, siguen con algo pendiente?" — y `globalRecommendationReady
({readiness, channels, lmBlocked, baseBlocked})`, la regla combinada documentada (datos de
negocio + LM + precio fijo) para cualquier consumidor que necesite una sola respuesta.
**[Nota: `globalRecommendationReady()` existió con esta firma solo en esta ronda —
`engine.js` todavía NO la consumía (calculaba su propio `unreadyChannels()` inline), lo cual
se corrigió en el refactor de cierre siguiente, que la reemplazó por
`evaluateGlobalRecommendationReadiness()` con el contrato definitivo `floorReady`/`baseReady`
— ver esa sección más arriba, es la que describe el comportamiento ACTUAL.]**
`floorReadinessBlocked`/`baseReadinessBlocked` ahora se derivan de `unreadyChannels(...)`
sobre TODOS los canales, no solo el que fija el número hoy — y el motivo (`...Reason`)
lista explícitamente qué canales y qué datos faltan. `matrix.js`/`alerts.js` se
refactorizaron para reusar la misma `unreadyChannels()` en vez de reimplementar el mismo
filtro cada uno por su cuenta (ya lo hacían correctamente para sus propios veredictos —
ahora comparten la función con `engine.js`). Ningún texto de la UI sugiere "configura este
precio global en PriceLabs" mientras esté bloqueado (ya no lo hacía; se verificó
explícitamente). Las simulaciones/diagnósticos POR CANAL (pestaña de cada canal, Simulador)
siguen disponibles sin cambios — el bloqueo es solo sobre el número GLOBAL.

**P2 — `manualNetPerNight:0` (el default de fábrica) pasaba como ingreso mensual válido.**
`defaultMonthlyIncomeScenario()` arrancaba en `manualNetPerNight: 0`, y
`computeMonthlyEconomics()` solo validaba "es un número finito" — `0` lo es, así que una
unidad nueva (donde Dani nunca tocó ese campo) mostraba una PROYECCIÓN DE PÉRDIDA mensual
completa basada en un ingreso que nadie configuró. Corregido: el default pasa a `null`
("todavía no lo escribiste", nunca `0` como sustituto silencioso de "sin dato");
`resolveIncomeScenario()` en modo manual rechaza `null`/`undefined`/`''`/`0`/negativo con
`{ok:false, reason:'Falta ingresar neto manual por noche...'}` explícito — solo un número
`> 0` calcula. `src/domain/persistence.js` gana `nullableNumField()` para que `null`
sobreviva el ciclo de guardado/importación exactamente, sin generar un warning falso
positivo (es un estado válido, no inválido). La UI (`index.html`) usa
`allowEmpty:true, emptyValue:null` en el campo — borrar el campo vuelve a "sin configurar",
nunca revierte a un `0` silencioso.

Regresión encontrada y corregida en el mismo commit: `e2e/base-fixedprice.spec.js` (test
"día 45 no cubierto, Base Price vuelve a mostrarse normal") asumía que el mecanismo de LM
`fixed_price` era el único gate en juego, pero con el catálogo de fábrica Booking y Directo
siempre tienen comisión bancaria real sin confirmar — con el fix de P1, eso ahora bloquea
el Base global independientemente del rango de `fixed_price`. Se aisló con el mismo patrón
ya usado en `lm-blocking.spec.js`/`sim-blocked-bypass.spec.js` (`resolveAllFinancialFacts()`
antes de mover el rango), para que el test siga probando específicamente el mecanismo de
precio fijo, no el gate de datos financieros.

Tests nuevos: `tests/fase5-financial-readiness.test.js` (+6, caso obligatorio Airbnb-fija-hoy/
Directo-pendiente, `unreadyChannels()`/`globalRecommendationReady()` directos, Matriz),
`tests/monthly-economics.test.js` (+9, `manualNetPerNight` en `0`/`''`/`null`/negativo/
positivo, a nivel `computeMonthlyEconomics()` y a nivel `normalizeUnit()`),
`e2e/financial-readiness.spec.js` (+4), `e2e/monthly-economics.spec.js` (+4). **170/170
unitarios, 50/50 e2e, sin regresión** (incluye el fix del test de `base-fixedprice.spec.js`
arriba).

### Actualización (revisión externa) — refactor de cierre: `evaluateGlobalRecommendationReadiness()` como única fuente de verdad de los bloqueos globales

Problema encontrado por revisión independiente: `globalRecommendationReady()` (arriba)
existía, estaba documentada como fuente única de verdad y tenía tests propios — pero
`engine.js` **no la consumía**. El motor seguía calculando `floorReadinessBlocked`/
`baseReadinessBlocked` con su propio `unreadyChannels()` inline, y la UI combinaba por
separado `lmBlocked`/`baseBlocked`/`baseReadinessBlocked` con `||` en varios lugares
(`renderKpis`, intro de Matriz, botón "Ir al simulador", precarga del Simulador). El
resultado funcional YA era correcto, pero la regla vivía duplicada en cuatro sitios
distintos, con riesgo real de desalinearse en un cambio futuro.

Corrección: `globalRecommendationReady()` se **reemplazó** (no se mantuvo en paralelo) por
`evaluateGlobalRecommendationReadiness({readiness, channels, lmBlocked, baseBlocked})` — ver
el contrato completo (`floorReady`/`baseReady`/`unreadyChannels`/`reasons`/`floorReason`/
`baseReason`) en la sección "Verificado / No-verificado..." de arriba. Cambio de fondo en el
contrato, no solo de nombre: la versión vieja ataba `baseBlocked` al `ready` GLOBAL (un solo
booleano para Piso y Base), lo cual era incorrecto — un precio LM fijo (`baseBlocked`) hace
irrelevante a Base, pero el Piso sigue protegiendo con el peor escenario real y NUNCA debe
bloquearse por eso. La versión nueva separa `floorReady`/`baseReady` explícitamente, con
`baseReady` dependiendo de `floorReady` pero no al revés.

`engine.js` ahora deriva los cuatro campos que expone `compute()` directamente de esta
función, sin recalcular nada. `index.html` (`renderKpis`, intro de Matriz, botón "Ir al
simulador", precarga del Simulador) lee `model.floorReadinessBlocked`/
`model.baseReadinessBlocked` como el ÚNICO booleano de gate — los `||` manuales con
`lmBlocked`/`baseBlocked` se eliminaron; esas dos banderas solo se leen ahora para elegir
qué texto corto mostrar. `#validationBanner` gana un ajuste para no duplicar el aviso de
"dato financiero sin verificar" cuando el único motivo real es LM/precio fijo (esos ya
tienen su propio aviso separado) — se muestra solo si además hay un dato de NEGOCIO
pendiente (`model.readiness.ready===false`).

Guarda anti-regresión: nuevo test en `tests/fase5-financial-readiness.test.js` que llama a
`evaluateGlobalRecommendationReadiness()` directamente con los mismos insumos que ya usó
`compute()`, y exige una igualdad EXACTA (booleans y texto) — verificado manualmente
revirtiendo `engine.js` a una reimplementación inline: el test (y otros 3) fallan como se
espera, confirmando que la guarda detecta la regresión.

Tests nuevos/ajustados: `tests/fase5-financial-readiness.test.js` (el test de
`globalRecommendationReady()` se reescribió para el nuevo contrato — mismo caso, mismos
insumos, ahora contra `evaluateGlobalRecommendationReadiness()` — más 3 tests nuevos: LM
bloqueado bloquea Piso+Base, todo resuelto sin fixed_price desbloquea ambos, y la guarda
anti-regresión), `e2e/base-fixedprice.spec.js` (+1, fixed_price deja el Piso disponible y
solo bloquea Base). **174/174 unitarios, 51/51 e2e, sin regresión.**

### Actualización (revisión externa) — preparación para uso operativo con datos reales: reconciliación de reservas, contrato de moneda y auditoría

Tres módulos nuevos, documentados en detalle en la sección "Preparación para datos
reales" de arriba — resumen de la entrega:

- **`src/domain/reconciliation.js`** (`reconcileReservation()`): compara el estimado de
  `quoteScenario()` contra una reserva real que Dani ingresa a mano (canal, precio, noches,
  días, comisiones/tarifas reales opcionales, payout recibido, moneda, referencia opcional
  — nunca datos de huésped). Devuelve diferencia absoluta/%, desglose por componente,
  causas posibles, severidad (`'ok'`/`'warn'`/`'bad'`, umbral documentado: `<=3%` ok, `>3%`
  warn, `real<estimado` y `>10%` bad) y si el modelo sigue siendo confiable. NUNCA cambia
  `channels`/`discounts` — solo sugiere qué revisar.
- **`src/domain/currency.js`** (`resolveConversion()`): contrato de moneda — cada canal
  puede declarar `settlementCurrency` (USD/COP/null) distinta a la moneda base de la
  unidad; cualquier consolidación entre monedas distintas exige `state.fxRates[moneda]`
  con `status:'verificado'` y un `rate` válido `> 0`, si no, bloquea explícitamente (nunca
  1:1, nunca inventado, nunca una API externa). Reusada por `reconciliation.js` y por
  `monthly-economics.js` (escenarios `'channel'`/`'mix'` con un canal en otra moneda).
- **`src/domain/audit.js`** (`buildAuditChecklist()`): rollup de 7 verificaciones (costos,
  comisiones, LM, Offset, promociones, moneda, última reconciliación) hacia un estado final
  de 3 valores posibles (`'simulacion'`/`'datos_parciales'`/`'listo_supervisado'`) — NUNCA
  "producción". Reusa `readiness.byChannel`/`resolveConversion()`, no reimplementa ninguna
  regla de bloqueo existente.
- **Bug real encontrado y corregido en el mismo commit**: `renderDataProvenance()`
  (aviso "EJEMPLO" de `fixedCost`/`varCost`) solo miraba el modo simple — una unidad que
  llenó la calculadora de costos detallada con datos reales pero nunca tocó los campos
  simples (que quedan en 32/22 sin usarse) seguía mostrando "EJEMPLO" como si nada fuera
  real. Corregido para contar también `costBreakdownIsFilled()`, mismo helper que ya usa
  `compute()`.
- **UI** (`index.html`): nuevas secciones en Resumen — "Moneda y tipo de cambio" (una fila
  por cada moneda de liquidación distinta a la de la unidad), "Validar contra una reserva
  real" (formulario + resultado en vivo + lista de conciliaciones guardadas localmente, con
  borrado explícito), "Auditoría de datos reales" (checklist + estado). Selector de moneda
  de liquidación agregado a la pestaña de cada canal.

Tests: `tests/currency.test.js` (8), `tests/reconciliation.test.js` (12),
`tests/audit.test.js` (8), `tests/monthly-economics.test.js` (+4, contrato de moneda en
escenarios `'channel'`/`'mix'`), `tests/real-data-persistence.test.js` (15, incluye
payloads malformados/XSS en `reconciliations`, monedas inventadas, rates inválidos).
`e2e/real-data.spec.js` (9). **221/221 unitarios, 60/60 e2e, sin regresión.**
