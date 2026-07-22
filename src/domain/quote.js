/* quoteScenario() — Fase 2 de la auditoria: LA fuente unica de verdad para
   cotizar UN escenario concreto (canal + dias + noches + precio de PriceLabs).
   Alertas (PISO), Simulador y — indirectamente, via worstNative()/payoutFactor()
   compartidos — el Piso quedan alineados a esta misma formula. Ninguna vista debe
   reimplementar estos pasos; si falta un campo, se agrega aqui, no se recalcula
   aparte.

   Deliberadamente NO to ca en esta Fase 2 (fuera de alcance, ver reglas del
   encargo):
   - Reglas de negocio OTA (combineChannel: prioridades Airbnb, stacking Booking,
     grupos Expedia) — sin cambios.
   - Modelo de costos: sigue siendo fixedCost+varCost por NOCHE (el costo a nivel
     de reserva es Fase 3 — ver src/domain/costs.js).
   - Modelo de Last-Minute de PriceLabs: sigue siendo el mismo "techo por ventana"
     de siempre (peor nativo entre canales vs. el techo configurado). NO asume
     ningun modo nuevo (flat/gradual/precio fijo/tramos) — eso es Fase 4,
     pendiente de que definas la configuracion real por unidad.
   - Descuento no reembolsable de Airbnb — Fase 4, pendiente de confirmacion.

   scenario = {chId, days, nights, price}
   config   = {channels, discounts, windows, ceilings, fixedCost, varCost} */
import {pct, pct2} from './percent.js';
import {combineChannel, payoutFactor, cleanFeePerNight} from './engine.js';

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
  const perChannelNative = channels.map(c=>({c, totalPct: combineChannel(discounts, c.id, days, nights).totalPct}));
  const maxNAtScenario = Math.max(0, ...perChannelNative.map(p=>p.totalPct));
  const worstChannelAtScenario = perChannelNative.find(p=>p.totalPct===maxNAtScenario)?.c;
  const breach = maxNAtScenario > ceil;
  const lm = breach ? 0 : Math.max(0, 100*(1-(1-ceil/100)/(1-maxNAtScenario/100)));
  if(breach) assumptions.push(`Techo excedido en ${w.label}: ${worstChannelAtScenario?.name||'un canal'} ya suma ${maxNAtScenario}% de nativo (> techo ${ceil}%) a estos dias/noches — PriceLabs no puede aplicar LM adicional aqui.`);

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

  /* 6. Costo y margen de ESTA reserva. El modelo de costo sigue siendo
     fixedCost+varCost por NOCHE (Fase 3 lo reemplaza por costo a nivel de
     reserva) — se documenta como supuesto explicito, no se esconde. */
  const cost = (parseFloat(config.fixedCost)||0)+(parseFloat(config.varCost)||0);
  assumptions.push('Costo modelado como fixedCost+varCost por NOCHE (no a nivel de reserva) — pendiente Fase 3.');
  const margin = payout - cost;
  const marginPct = payout>0 ? (margin/payout)*100 : 0; // margen SOBRE VENTA; ver Fase 3.5 para distincion markup/margen

  return {
    chId, ch, days, nights, w, ceil, maxNAtScenario, worstChannelAtScenario, breach, lm,
    nativoPct: r.totalPct,
    price, priceAfterLm, off, priceAfterOffset,
    applied: r.applied, ignored: r.ignored, appliedSteps,
    guest, feePerNight, feeTotal, guestWithFees,
    commAmt, bankAmt, payout,
    cost, margin, marginPct,
    assumptions
  };
}
