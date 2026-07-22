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

   Deliberadamente NO to ca en esta Fase 2/3 (fuera de alcance, ver reglas del
   encargo):
   - Reglas de negocio OTA (combineChannel: prioridades Airbnb, stacking Booking,
     grupos Expedia) — sin cambios.
   - Modelo de Last-Minute de PriceLabs: sigue siendo el mismo "techo por ventana"
     de siempre (peor nativo entre canales vs. el techo configurado). NO asume
     ningun modo nuevo (flat/gradual/precio fijo/tramos) — eso es Fase 4,
     pendiente de que definas la configuracion real por unidad.
   - Descuento no reembolsable de Airbnb — Fase 4, pendiente de confirmacion.

   scenario = {chId, days, nights, price}
   config   = {channels, discounts, windows, ceilings, fixedCost, varCost} */
import {pct, pct2} from './percent.js';
import {combineChannel, payoutFactor, cleanFeePerNight} from './engine.js';
import {reservationCostBreakdown} from './costs.js';

export function quoteScenario(scenario, config){
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
  const lm = breach ? 0 : Math.max(0, 100*(1-(1-ceil/100)/(1-maxNAtScenario/100)));
  if(breach) assumptions.push(`Techo excedido en ${w.label}: ${worstChannelAtScenario?.name||'un canal'} ya suma ${maxNAtScenario.toFixed(1)}% de nativo (> techo ${ceil}%) a estos dias/noches — PriceLabs no puede aplicar LM adicional aqui.`);

  const priceAfterLm = price*(1-lm/100);

  /* 2. Offset del canal (PriceLabs Pricing Offset), sobre el precio ya con LM. */
  const off = pct2(ch.offsetPct);
  const priceAfterOffset = priceAfterLm*(1+off/100);
  assumptions.push('Offset se asume especifico por canal (Pricing Offset de PriceLabs) — pendiente de confirmar en Hospy si realmente se aisla por canal, ver CLAUDE.md seccion 2.');

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
  const bankAmt = guestWithFees*pct(ch.bankFeePct)/100;
  const payout = guestWithFees*payoutFactor(ch);

  /* 6. Costo, margen (sobre venta) y markup (sobre costo) de ESTA reserva.
     Fase 3: si config.costBreakdown esta presente, el costo YA NO es un flat
     fixedCost+varCost — es el costo REAL de ESTA reserva concreta (nights reales),
     con los costos "por turno" (limpieza/lavanderia/insumos) cargados UNA VEZ, no
     diluidos por avgNights (ver src/domain/costs.js, bug P5/P13). Sin
     costBreakdown, cae al modelo simple de siempre (compatibilidad con quien no
     llena la calculadora detallada). */
  let cost;
  if(config.costBreakdown){
    cost = reservationCostBreakdown(config.costBreakdown, nights).perNight;
  } else {
    cost = (parseFloat(config.fixedCost)||0)+(parseFloat(config.varCost)||0);
    assumptions.push('Costo modelado como fixedCost+varCost fijo por noche (sin calculadora detallada) — no varia con la duracion real de esta reserva. Completa "Costos por noche -> calculadora detallada" para que limpieza/lavanderia/insumos se carguen una sola vez por reserva, no diluidos por la estadia promedio.');
  }
  const margin = payout - cost;
  const marginPct = payout>0 ? (margin/payout)*100 : 0; // margen: fraccion de LA VENTA (payout) que es ganancia
  const markupPct = cost>0 ? (margin/cost)*100 : 0;      // markup: cuanto se sube SOBRE EL COSTO — no confundir con margen

  return {
    chId, ch, days, nights, w, ceil, maxNAtScenario, worstChannelAtScenario, breach, lm,
    nativoPct: r.totalPct, // SOLO presentacion (redondeado) — para matematica financiera usar nativoFactor
    nativoFactor: r.factor, // exacto — 1-nativoFactor es la fraccion real que aplica el canal
    price, priceAfterLm, off, priceAfterOffset,
    applied: r.applied, ignored: r.ignored, appliedSteps,
    guest, feePerNight, feeTotal, guestWithFees,
    commAmt, bankAmt, payout,
    cost, margin, marginPct, markupPct,
    assumptions
  };
}
