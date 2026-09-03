/* quoteScenario() — Fase 2 de la auditoria: LA fuente unica de verdad para
   cotizar UN escenario concreto (canal + dias + noches + precio de PriceLabs).
   Alertas (PISO), Simulador y — indirectamente, via worstNative()/payoutFactor()
   compartidos — el Piso quedan alineados a esta misma formula. Ninguna vista debe
   reimplementar estos pasos; si falta un campo, se agrega aqui, no se recalcula
   aparte.

   Fase 2.1 (jul 2026): el techo/breach/LM y el peor-canal-en-el-escenario se deciden
   sobre `factor` EXACTO (combineChannel().factor), nunca sobre `totalPct` (redondeado
   a 1 decimal, solo para texto). El campo `nativoPct` que devuelve esta funcion sigue
   siendo el redondeado (para mensajes/UI); quien necesite matematica financiera exacta
   debe usar `nativoFactor` (1-factor = fraccion real que aplica el canal).

   Fase 3 (jul 2026): el costo ya NO es siempre el flat fixedCost+varCost — si
   config.costBreakdown esta presente, usa el costo REAL de esta reserva concreta
   (reservationCostBreakdown, nights reales, turno cargado una sola vez). Tambien
   devuelve `markupPct` (ganancia sobre COSTO) ademas de `marginPct` (ganancia
   sobre VENTA/payout) — son numeros distintos, no intercambiables.

   Fase 4 (jul 2026): el LM ya no es SIEMPRE "techo por ventana" — si
   config.lmConfig esta presente, se despacha por src/domain/pricelabs-lm.js (5
   modos: automatico/flat/gradual/precio fijo/tramos). Sin lmConfig, cae al modo
   automatico de siempre (cero regresion). El descuento no reembolsable de Airbnb
   (ab_nonref, catalogo) ya se aplica dentro de combineChannel() como capa
   apilable post-promo — no necesita codigo aparte aqui, ya viene incluido en
   `r.applied`/`r.factor`.

   Fix sep 2026 (Piso vs Min Price): el pipeline ahora modela EXPLICITAMENTE el
   tope del Min Price de PriceLabs. La cadena real es
     precio_publicado = max(Min, precio_con_LM) -> x(1+offset) -> xnativoOTA
     -> +aseo -> xpayoutFactor
   y `config.minPrice` es ese Min. Antes el LM porcentual bajaba el precio sin
   ningun tope, lo que contradecia al Piso (que ES el Min): cotizar exactamente
   al Piso en el dia 0 daba perdida. Ver el comentario junto a `priceAfterLm` y
   el docblock de src/domain/worstcase.js (fuentes y verificacion).

   Deliberadamente NO toca en esta fase (fuera de alcance, ver reglas del
   encargo):
   - Reglas de negocio OTA base (combineChannel: prioridades Airbnb, stacking
     Booking, grupos Expedia) — sin cambios.

   scenario = {chId, days, nights, price}
   config   = {channels, discounts, windows, ceilings, fixedCost, varCost,
               costBreakdown?, lmConfig?, minPrice?, floor?}
     - minPrice: el Min Price configurado en PriceLabs (tope duro sobre el
       precio ya descontado por LM porcentual). Ausente/0 => sin tope.
     - floor: SOLO el umbral de advertencia para un LM de precio fijo bajo el
       Piso (pricelabs-lm.js). No es un tope; no confundir con minPrice. */
import {pct, pct2} from './percent.js';
import {combineChannel, payoutFactor, cleanFeePerNight, extraCommPct} from './engine.js';
import {reservationCostBreakdown} from './costs.js';
import {priceLabsLm, isLmBlocked, LONG_STAY_NIGHTS} from './pricelabs-lm.js';

export function quoteScenario(scenario, config, opts = {}){
  const {channels, discounts, windows, ceilings} = config;
  const chId = scenario.chId;
  const ch = channels.find(c=>c.id===chId);
  const days = Math.max(0, scenario.days||0);
  const nights = Math.max(1, scenario.nights||1);
  const price = scenario.price||0;
  const assumptions = [];

  /* 1. Techo/LM — usa SIEMPRE los dias/noches REALES de este escenario (fix P4:
     antes se usaba el punto medio sintetico de la ventana y nights=1 fijo). El
     "peor nativo" para el techo se sigue evaluando cruzando TODOS los canales a
     esos mismos dias/noches reales — es una politica compartida ("no le muestres
     al huesped mas de X% en esta ventana, sin importar el canal"), no el nativo
     de un solo canal. */
  const w = windows.find(win=>days>=win.lo && days<=win.hi) || windows[windows.length-1];
  const ceil = pct(ceilings[w.id]);
  /* Fase 2.1: factor EXACTO, no totalPct (redondeado a 1 decimal para UI) — decidir
     techo/breach/LM con el valor redondeado puede licuar o proteger de mas por
     ruido de punto flotante, no por la realidad del descuento. */
  const perChannelNative = channels.map(c=>({c, factor: combineChannel(discounts, c.id, days, nights).factor}));
  const minFactorAtScenario = Math.min(1, ...perChannelNative.map(p=>p.factor));
  const maxNAtScenario = (1-minFactorAtScenario)*100;
  const worstChannelAtScenario = perChannelNative.find(p=>p.factor===minFactorAtScenario)?.c;
  const breach = maxNAtScenario > ceil;
  if(breach) assumptions.push(`Techo excedido en ${w.label}: ${worstChannelAtScenario?.name||'un canal'} ya suma ${maxNAtScenario.toFixed(1)}% de nativo (> techo ${ceil}%) a estos dias/noches — PriceLabs no puede aplicar LM adicional aqui.`);

  /* Fase 4: modo de LM despachado por pricelabs-lm.js. Sin config.lmConfig, usa
     'ceiling_auto' (el comportamiento de siempre) — cero cambio de resultado
     para quien no configuro nada nuevo. */
  const lmResult = opts.excludeLmOnLongStay===true && nights>=LONG_STAY_NIGHTS
    ? {lmPct:0, priceOverride:null, blocked:false,
       note:`Last-Minute excluido del peor caso: esta es una reserva de ${nights}+ noches — no es realista que se reserve a último momento con LM activo.`,
       mode:config.lmConfig?.mode||'ceiling_auto', verified:!!config.lmConfig?.verified}
    : priceLabsLm(config.lmConfig, {day: days, ceilingPct: ceil, nativePct: maxNAtScenario, floor: config.floor});
  const lm = lmResult.lmPct;
  if(lmResult.note) assumptions.push(lmResult.note);
  if(lmResult.mode!=='ceiling_auto' && !lmResult.verified)
    assumptions.push(`LM en modo "${lmResult.mode}" configurado pero NO VERIFICADO — Dani debe confirmar que este es el modo real que usa PriceLabs para esta unidad antes de confiar en este numero para una recomendacion categorica.`);
  /* Fix sep 2026 — el Min Price de PriceLabs topa el precio DESPUES del LM
     porcentual (ver src/domain/worstcase.js para las tres fuentes que lo
     confirman). Sin este tope, cotizar exactamente al Piso en el dia 0 daria
     perdida y la app se contradiria: el Piso prometeria proteger un precio que
     el Simulador simula por debajo de si mismo.

     DECISION DE DISENO (canal por el que entra el Min): NO se reusa
     `config.floor`. Ese campo ya tiene un rol distinto y unico — es el umbral de
     ADVERTENCIA que fixedPrice() usa para avisar "tu precio LM fijo esta bajo el
     Piso" (pricelabs-lm.js) — y mezclar un umbral de texto con un tope
     matematico duro hace imposible saber, leyendo un caller, cual de los dos
     roles pretendia. Se agrega `config.minPrice` explicito: "el Min Price que
     PriceLabs tiene configurado para esta unidad". Ausente/0/no numerico => no
     hay tope (cero regresion para todo caller que no participe de este
     contrato, incluidos los tests previos a este cambio).

     `fixed_price` queda FUERA del tope a proposito: un Fixed Last-Minute Price
     es el unico caso en que PriceLabs publica por debajo del Min Price. */
  const minPrice = Math.max(0, parseFloat(config.minPrice)||0);
  const priceBeforeMin = lmResult.priceOverride!=null ? lmResult.priceOverride : price*(1-lm/100);
  const minPriceApplies = lmResult.priceOverride==null && minPrice>0;
  const minPriceApplied = minPriceApplies && minPrice>priceBeforeMin;
  const priceAfterLm = minPriceApplied ? minPrice : priceBeforeMin;
  if(minPriceApplied)
    assumptions.push(`El Min Price de PriceLabs (${minPrice.toFixed(2)}) topa este escenario: el precio con el LM aplicado habria sido ${priceBeforeMin.toFixed(2)}, pero PriceLabs no publica por debajo del Min (solo un Last-Minute de PRECIO FIJO puede saltarselo). Se cotiza sobre ${priceAfterLm.toFixed(2)}.`);
  /* Bloqueante 3 (revision externa): antes `blocked`/`verified`/`mode` se calculaban
     dentro de priceLabsLm() pero NUNCA salian de quoteScenario() — ninguna vista
     podia condicionar nada sobre "esto no es verificable". Ahora son campos de
     primer nivel: `lmBlocked` es true si el modo es ceiling_auto (proyeccion, no
     confirmado con PriceLabs) O si es otro modo pero no fue marcado verificado. */
  const lmMode = lmResult.mode;
  const lmVerifiedFlag = !!lmResult.verified;
  /* isLmBlocked() (pricelabs-lm.js) es la MISMA funcion pura que usan
     compute()/matrix.js/alerts.js — no reimplementar este booleano aqui: es
     exactamente equivalente a `!!lmResult.blocked || !lmVerifiedFlag` (ceilingAuto()
     siempre bloquea, las demas nunca por si solas), pero calcularlo una sola vez
     evita que las vistas se desalineen si la regla cambia. */
  const lmBlocked = isLmBlocked(config.lmConfig);

  /* 2. Offset del canal (PriceLabs Pricing Offset), sobre el precio ya con LM. */
  const off = pct2(ch.offsetPct);
  const priceAfterOffset = priceAfterLm*(1+off/100);

  /* 3. Descuentos nativos del canal, a los dias/noches REALES del escenario. */
  const r = combineChannel(discounts, chId, days, nights);
  let guest = priceAfterOffset;
  const appliedSteps = [];
  r.applied.forEach(a=>{
    const before = guest;
    guest = guest*(1-a.pct/100);
    appliedSteps.push({...a, before, after: guest});
  });

  /* 4. Tarifa de aseo (solo Airbnb), fija por reserva, diluida por noche —
     se suma DESPUES de los descuentos de noche (Airbnb no la descuenta), pero
     SI paga comision (modelo Host-Only Fee), ver paso 5. */
  const feePerNight = cleanFeePerNight(ch, nights);
  const feeTotal = feePerNight*nights;
  const guestWithFees = guest+feePerNight;

  /* 5. Comisiones: OTA + bancaria, AMBAS sobre el precio que paga el huesped
     (incluido el aseo diluido) — se restan del MISMO numero, no se componen
     una sobre la otra (ver payoutFactor()/CLAUDE.md seccion 2). */
  const commAmt = guestWithFees*pct(ch.comm)/100;
  const extraCommAmt = guestWithFees*extraCommPct(ch)/100;
  const bankAmt = guestWithFees*pct(ch.bankFeePct)/100;
  const payout = guestWithFees*payoutFactor(ch);

  /* 6. Costo, margen (sobre venta) y markup (sobre costo) de ESTA reserva.
     Fase 3: si config.costBreakdown esta presente, el costo YA NO es un flat
     fixedCost+varCost — es el costo REAL de ESTA reserva concreta (nights reales),
     con los costos "por turno" (limpieza/lavanderia/insumos) cargados UNA VEZ, no
     diluidos por avgNights (ver src/domain/costs.js, bug P5/P13). Sin
     costBreakdown, cae al modelo simple de siempre (compatibilidad con quien no
     llena la calculadora detallada). */
  /* BLOQUEANTE 2 corregido (auditoria externa, ronda 4): mismo criterio que
     compute() (engine.js) — un `costBreakdown` presente pero explicitamente
     SIN confirmar (`config.costBreakdownConfirmed===false`) nunca alimenta el
     costo real de esta cotizacion, cae al modelo simple. `costBreakdownConfirmed`
     ausente (callers de test que no participan de este contrato) preserva el
     comportamiento de siempre. Ver src/domain/cost-mode.js. */
  let cost;
  if(config.costBreakdown && config.costBreakdownConfirmed!==false){
    cost = reservationCostBreakdown(config.costBreakdown, nights).perNight;
  } else {
    cost = (parseFloat(config.fixedCost)||0)+(parseFloat(config.varCost)||0);
    assumptions.push(config.costBreakdown
      ? 'El desglose detallado de costos todavía no está confirmado — el costo se sigue calculando con el modelo simple (fixedCost+varCost) hasta que confirmes el desglose en Resumen → "Costos por noche".'
      : 'Costo modelado como fixedCost+varCost fijo por noche (sin calculadora detallada) — no varia con la duracion real de esta reserva. Completa "Costos por noche -> calculadora detallada" para que limpieza/lavanderia/insumos se carguen una sola vez por reserva, no diluidos por la estadia promedio.');
  }
  const margin = payout - cost;
  const marginPct = payout>0 ? (margin/payout)*100 : 0; // margen: fraccion de LA VENTA (payout) que es ganancia
  const markupPct = cost>0 ? (margin/cost)*100 : 0;      // markup: cuanto se sube SOBRE EL COSTO — no confundir con margen

  return {
    chId, ch, days, nights, w, ceil, maxNAtScenario, worstChannelAtScenario, breach, lm,
    lmMode, lmVerified: lmVerifiedFlag, lmBlocked, lmPriceOverrideActive: lmResult.priceOverride!=null,
    nativoPct: r.totalPct, // SOLO presentacion (redondeado) — para matematica financiera usar nativoFactor
    nativoFactor: r.factor, // exacto — 1-nativoFactor es la fraccion real que aplica el canal
    price, priceAfterLm, priceBeforeMin, minPrice, minPriceApplied, off, priceAfterOffset,
    applied: r.applied, ignored: r.ignored, appliedSteps,
    guest, feePerNight, feeTotal, guestWithFees,
    commAmt, extraCommAmt, bankAmt, payout,
    cost, margin, marginPct, markupPct,
    /* Simplificacion a USD unico (revision externa): esta version SOLO opera
       en USD — todo resultado monetario de quoteScenario() esta, por
       contrato, en USD. Se expone explicito (en vez de dejarlo implicito)
       para que cualquier consumidor (reconciliacion, planificacion mensual)
       pueda afirmarlo sin adivinar. La multimoneda queda fuera de esta fase
       (ver src/domain/currency.js, conservado mas no usado por el flujo activo). */
    currency: 'USD',
    assumptions
  };
}
