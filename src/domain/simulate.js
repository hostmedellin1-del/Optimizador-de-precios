/* Fase 2 de la auditoria: reemplazo de src/domain/simulate-legacy.js.
   simulate-legacy.js queda INTACTO a proposito (no se edita) como registro
   historico del bug P4 — este archivo es el reemplazo que corrige el problema
   consumiendo quoteScenario() (fuente unica), y expone la MISMA forma de
   resultado que simulate-legacy.js para que index.html no tenga que reescribir
   el armado de HTML de renderSim(), solo el import.

   Fix P4: antes el LM se calculaba con el punto medio sintetico de la ventana y
   nights=1 fijo, ignorando los dias/noches reales que el usuario escribio en el
   simulador. quoteScenario() ya usa siempre los dias/noches reales del escenario
   (ver src/domain/quote.js) — este archivo ya no necesita (ni debe) recalcular
   nada por su cuenta. */
import {quoteScenario} from './quote.js';

/* config = {channels, discounts, windows, ceilings, fixedCost, varCost}
   scenario = {price, chId, days, nights} */
export function simulateReservation(config, scenario){
  const q = quoteScenario(
    {chId: scenario.chId || 'airbnb', days: scenario.days, nights: scenario.nights, price: scenario.price||0},
    config
  );
  return {
    price: q.price, chId: q.chId, ch: q.ch, days: q.days, nights: q.nights, w: q.w, ceil: q.ceil,
    maxN: q.maxNAtScenario, lm: q.lm,
    afterLm: q.priceAfterLm, off: q.off, afterOff: q.priceAfterOffset,
    applied: q.applied, ignored: q.ignored, appliedSteps: q.appliedSteps,
    guest: q.guest, feeTotal: q.feeTotal, feePerNight: q.feePerNight, guestForFees: q.guestWithFees,
    commAmt: q.commAmt, afterComm: q.guestWithFees - q.commAmt,
    bankAmt: q.bankAmt, afterBank: q.payout,
    cost: q.cost, margin: q.margin,
    totalDisc: 100*(1-q.guest/q.price), // identico a la formula original (puede dar NaN/Infinity si price=0; sin cambios, no es parte del alcance de Fase 2)
    assumptions: q.assumptions
  };
}
