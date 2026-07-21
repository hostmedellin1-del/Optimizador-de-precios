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
objetivo (no es una aproximación).

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
- `window.storage` con polyfill a `localStorage`. El storage nativo de Claude.ai
  (`window.storage`) no existe fuera de Claude.ai. Se agregó un polyfill al inicio del
  `<script>` que detecta si `window.storage` ya existe; si no, lo simula con
  `localStorage` con el mismo contrato (get/set/delete/list). Esto permite que el MISMO
  archivo funcione dentro de Claude.ai y como página independiente (GitHub Pages, local)
  sin mantener dos versiones distintas.
- v1 fue descartada por completo, no parcheada. La v1 tenía "% nativo constante" y "%
  por ventana" como dos conceptos separados sin reglas de combinación reales —
  estructuralmente inválido. Se reescribió desde cero como v2 con un catálogo único de
  descuentos + motor de reglas por canal. La v2 (este archivo) es la autoridad.

---

## 4. Arquitectura técnica del archivo actual

- `state` — objeto único: `fixedCost`, `varCost`, `margin`, `marketWindow`, `marketBase`,
  `currency`, `matrixNights`, `channels[]` (cada uno con `comm`, `bankFeePct`,
  `offsetPct`), `discounts[]` (catálogo completo, cada uno con `ch`/`kind`/`group`/`prio`/
  ventana o duración), `ceilings` (techo % por ventana).
- `combineChannel(chId, daysOut, nights)` — el motor central. Aplica las reglas de la
  sección 2 según el canal. Devuelve `{factor, totalPct, applied[], ignored[]}` —
  `applied`/`ignored` traen el porqué de cada decisión (para el simulador y las alertas).
- `payoutFactor(c)` — `1 - comisión% - bancaria%` (ver corrección de la sección 2).
- `worstNative(chId)` — escanea TODAS las ventanas Y todas las duraciones con descuento
  por LOS activo, para encontrar el peor caso real. (Bug corregido: antes solo probaba 1
  noche y los descuentos por duración quedaban invisibles para el piso.)
- `compute()` — costo total, neto objetivo, piso (Min Price PriceLabs, protege contra el
  peor canal + peor descuento), base (Base Price PriceLabs, para netear objetivo en todos
  con sus nativos constantes).
- `suggestedOffset(chId, effBase, netObjetivo)` — ver sección 2.
- Tarifa de aseo de Airbnb (`cleanFeeShort`/`cleanFeeLong` en `state.channels` — solo el
  canal `airbnb` tiene estos campos, no se agregaron a Booking/Expedia/Directo porque no
  se pidieron ahí). Fija por reserva, no por noche: 1–2 noches usa `cleanFeeShort`, 3+
  usa `cleanFeeLong`. Airbnb no la descuenta con los promos de noche, pero SÍ cobra
  comisión sobre ella (modelo Host-Only Fee). Implementada SOLO en el Simulador
  (`renderSim`), que prorratea la tarifa entre las noches de esa reserva concreta para
  poder compararla contra el costo/noche — Resumen/Comparación NO la incluyen todavía
  porque son modelos agregados por noche sin una reserva puntual con noches fijas; no
  construir eso sin que Dani lo pida.
- Pestañas (`TABS` array + `.tab-panel[data-tab=...]`): Resumen, `ch-airbnb`,
  `ch-booking`, `ch-expedia`, `ch-direct`, Comparación, Simulador.
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
