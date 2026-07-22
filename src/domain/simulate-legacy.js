/* Calculo puro del Simulador de reserva ("¿Cómo se calcula?"). Extraido de la parte
   NUMERICA de `renderSim()` en index.html (Fase 1) — separado de la construccion de
   HTML, que se queda en la UI. Los valores devueltos son identicos a los que
   `renderSim()` ya mostraba; esta extraccion no cambia ningun numero todavia.

   BUG CONOCIDO (P4 de la auditoria, sin corregir en esta Fase 1): `maxN`/`lm` se
   calculan con el punto medio de la ventana (`Math.min(w.lo+1,w.hi)`) y SIEMPRE con
   nights=1 — NO con los `days`/`nights` reales que el usuario escribio en el
   simulador. El resto de la funcion (r = combineChannel con days/nights reales) SI
   usa el escenario real, asi que dentro de la misma llamada hay dos "realidades"
   distintas para el mismo escenario. Se corrige en Fase 2 haciendo que todo el
   simulador consuma `quoteScenario()`. Aqui solo se relocaliza el codigo tal cual
   estaba, para poder escribirle un test rojo que lo demuestre. */
import {pct, pct2} from './percent.js';
import {combineChannel} from './engine.js';

/* config = {channels, discounts, windows, ceilings, fixedCost, varCost}
   scenario = {price, chId, days, nights} */
export function simulateReservation(config, scenario){
  const {channels, discounts, windows, ceilings} = config;
  const price = scenario.price || 0;
  const chId = scenario.chId || 'airbnb';
  const ch = channels.find(c=>c.id===chId);
  const days = Math.max(0, scenario.days||0);
  const nights = Math.max(1, scenario.nights||1);
  const w = windows.find(w=>days>=w.lo && days<=w.hi) || windows[windows.length-1];
  const ceil = pct(ceilings[w.id]);
  const maxN = Math.max(0, ...channels.map(c=>combineChannel(discounts, c.id, Math.min(w.lo+1,w.hi), 1).totalPct));
  const lm = maxN>ceil ? 0 : Math.max(0, 100*(1-(1-ceil/100)/(1-maxN/100)));
  const r = combineChannel(discounts, chId, days, nights);
  const cost = (parseFloat(config.fixedCost)||0)+(parseFloat(config.varCost)||0);

  let running = price;
  const afterLm = running*(1-lm/100);
  running = afterLm;
  const off = pct2(ch.offsetPct);
  let afterOff = running;
  if(off!==0){ afterOff = running*(1+off/100); running = afterOff; }

  const appliedSteps = [];
  r.applied.forEach(a=>{
    const before = running;
    const nx = running*(1-a.pct/100);
    appliedSteps.push({name:a.pct===0?a.name:a.name, pct:a.pct, why:a.why, before, after:nx});
    running = nx;
  });
  const guest = running;

  let guestForFees = guest, feeTotal = 0, feePerNight = 0;
  if(chId==='airbnb'){
    feeTotal = nights<=2 ? (parseFloat(ch.cleanFeeShort)||0) : (parseFloat(ch.cleanFeeLong)||0);
    if(feeTotal>0){ feePerNight = feeTotal/nights; guestForFees = guest+feePerNight; }
  }

  const commAmt = guestForFees*pct(ch.comm)/100;
  const afterComm = guestForFees - commAmt;
  let afterBank = afterComm, bankAmt = 0;
  if(pct(ch.bankFeePct)>0){ bankAmt = guestForFees*pct(ch.bankFeePct)/100; afterBank = afterComm - bankAmt; }

  const margin = afterBank - cost;
  const totalDisc = 100*(1-guest/price); /* identico al original: si price=0 esto puede dar NaN/Infinity, no se corrige aqui (Fase 1 = cero cambio de comportamiento) */

  return {
    price, chId, ch, days, nights, w, ceil, maxN, lm,
    afterLm, off, afterOff,
    applied: r.applied, ignored: r.ignored, appliedSteps,
    guest, feeTotal, feePerNight, guestForFees,
    commAmt, afterComm, bankAmt, afterBank,
    cost, margin, totalDisc
  };
}
