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

### Expedia
Una sola promo "base" por reserva (`group:'base'`: Mobile-only, Same-day/last-minute,
Early booking, Basic) — el motor usa la de mayor % aplicable, las demás se ignoran.
Member Only Deal (`group:'mod'`) es la excepción: apila ENCIMA de esa promo base.

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

### El Piso SÍ debe incluir el Offset por canal — el Base NO (jul 2026, corregido)
`compute()` calcula el `floor` (Min Price) con el offset de cada canal en el denominador:
`cost / ((1+offset)*(1-nativoPeor)*payoutFactor)`. Antes NO lo incluía — con offset
positivo eso solo sobre-protegía (inofensivo), pero con offset **negativo** (bajar precio
en un canal para competir) el piso dejaba de proteger de verdad: un canal podía vender
bajo costo estando "sobre el piso" en apariencia. Verificado: Booking con offset −15%
neteaba 46 contra costo 54 antes del fix; después, el piso sube a 103 y netea exacto 54.
Offset ≤ −100% da `Infinity` (se muestra "—", no rompe).

El `base` (Base Price) NO debe llevar el offset — es intencional, no un descuido: el Base
es "el precio uniforme SIN offsets"; `suggestedOffset` es justamente lo que dice cuánto
offset poner ENCIMA de ese Base. Meter el offset en el Base duplicaría el concepto y
rompería la separación Base/Offset que es la razón de ser de esta herramienta (ver
sección 2, "Offset por canal").

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

1. Costos reales de la unidad 902 (Alcázar de Oviedo). Hoy el modelo usa el ejemplo
   genérico del webinar de Kunas ($54 costo/noche, $98 neto objetivo, margen 45%) — son
   ilustrativos, NO son los costos reales de Dani. Todo lo demás depende de esto.
7. Monto real de la tarifa de aseo de Airbnb (corta 1–2 noches / larga 3+ noches) —
   hoy en 0 por defecto ("cambia según cada listing", confirmado por Dani), cada unidad
   guardada debe traer su propio valor. No inventar un número — queda en 0 hasta que se
   cargue el dato real de cada unidad.
2. Confirmar en la extranet real de Booking.com: ¿Genius y Mobile Rate están AMBOS
   activos hoy? Se asumió que sí (10% + 10%) — cambia cuál canal termina fijando el piso.
3. % real de comisión bancaria por canal. Hoy: Booking 6%, Directo 6%, Airbnb 0%,
   Expedia 0% — son estimados de Dani a falta de revisar facturas, no verificados.
4. Multi-moneda: existe el campo `currency` (USD/COP) pero es solo una etiqueta de
   visualización, no convierte tasas. Varias unidades reales de Dani están en COP
   (Distrito Primavera, Casa Río Adentro, Villa Juliana, El Refugio).
5. Multi-unidad simultánea: el sistema permite guardar/cargar unidades por nombre, pero
   no comparar varias a la vez en una sola vista (portafolio). No construir esto sin que
   Dani lo pida — es una función nueva, no un arreglo.
6. Verificar en Hospy si el Offset por canal de PriceLabs realmente se aísla por canal o
   se distribuye a todos los conectados (ver advertencia sección 2).

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
