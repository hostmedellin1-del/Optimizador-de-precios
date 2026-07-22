/* Fase 2.1-fix (jul 2026) — CRITICO corregido: compute().floor y suggestedOffset()
   NO incorporaban Last-Minute (lmConfig) en absoluto — el Piso se calculaba como
   si PriceLabs nunca aplicara LM, aunque hubiera un modo LM configurado y
   VERIFICADO. Caso real que esto corrige (ver tests/fase-lm-floor.test.js):
   canal Directo, costo 100, margen 0, sin descuentos OTA, LM flat 50% verificado
   en días 0-3 — el Piso viejo daba 109.89 y `valid:true`, pero cotizar a ese
   precio en día 0 (con el LM real aplicado) netea 50, no 100. El Piso no
   protegía nada.

   Este modulo enumera el peor escenario REAL — canal x día crítico x noche
   crítica x descuento OTA x LM x offset — usando las MISMAS funciones fuente
   (combineChannel, priceLabsLm) que quoteScenario(), nunca reimplementando su
   lógica. NO incluye la tarifa de aseo (decisión de arquitectura preexistente,
   documentada en CLAUDE.md: el Piso/Base son modelos agregados por noche, sin
   reserva puntual — igual que antes de este fix). */
import {combineChannel, payoutFactor} from './engine.js';
import {pct, pct2} from './percent.js';
import {criticalDays, criticalNights} from './thresholds.js';
import {priceLabsLm, lmCriticalDays} from './pricelabs-lm.js';

/* Para UN canal: el peor multiplicador combinado (LM x nativo OTA x offset)
   sobre TODOS los días/noches críticos (unión de fronteras OTA y fronteras LM).
   También detecta escenarios de precio-fijo LM matemáticamente inviables: si
   PriceLabs va a publicar un precio FIJO en cierto rango de días
   (lmConfig.mode==='fixed_price'), ningún Piso puede protegerlos — se reportan
   aparte en `infeasible`, no participan en el cálculo de `worstFactor`.

   lmConfig=null/undefined => modo 'ceiling_auto' implícito (mismo default que
   priceLabsLm()) — usado para no romper compatibilidad con callers que todavía
   no pasan lmConfig explícito. */
export function worstScenarioFactor({chId, channels, discounts, windows, ceilings, lmConfig, cost}){
  const ch = channels.find(c=>c.id===chId);
  const off = pct2(ch.offsetPct)/100;
  const pf = payoutFactor(ch);
  const otaDays = criticalDays(discounts, windows);
  const lmDays = lmCriticalDays(lmConfig);
  const days = [...new Set([...otaDays, ...lmDays])].sort((a,b)=>a-b);
  const nights = criticalNights(discounts);
  const needsSharedCeiling = !lmConfig || lmConfig.mode==='ceiling_auto';

  let worstFactor = Infinity;
  let worstDay = days[0], worstNight = nights[0];
  const infeasible = [];

  days.forEach(d=>{
    const w = windows.find(win=>d>=win.lo && d<=win.hi) || windows[windows.length-1];
    const ceil = pct((ceilings||{})[w.id]);
    nights.forEach(n=>{
      const nativeFactor = combineChannel(discounts, chId, d, n).factor;
      // ceiling_auto es una politica COMPARTIDA entre canales: el LM depende del
      // peor nativo entre TODOS los canales a este mismo (dia,noche), no solo el propio.
      let sharedNative = 0;
      if(needsSharedCeiling){
        channels.forEach(c2=>{
          const f2 = combineChannel(discounts, c2.id, d, n).factor;
          const p2 = (1-f2)*100;
          if(p2>sharedNative) sharedNative=p2;
        });
      }
      const lmResult = priceLabsLm(lmConfig, {day:d, ceilingPct:ceil, nativePct:sharedNative});
      if(lmResult.priceOverride!=null){
        const payoutAtOverride = lmResult.priceOverride*(1+off)*nativeFactor*pf;
        if(typeof cost==='number' && payoutAtOverride < cost - 1e-9){
          infeasible.push({chId, day:d, night:n, overridePrice:lmResult.priceOverride, payoutAtOverride});
        }
        return; // el Piso no puede "arreglar" un precio fijo — no participa en worstFactor
      }
      const combinedFactor = (1-lmResult.lmPct/100)*(1+off)*nativeFactor;
      if(combinedFactor < worstFactor){ worstFactor=combinedFactor; worstDay=d; worstNight=n; }
    });
  });
  if(worstFactor===Infinity) worstFactor=0; // todo el dominio era precio-fijo inviable
  return {worstFactor, worstDay, worstNight, infeasible, pf};
}
