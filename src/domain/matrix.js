/* Fase Comparación — selector puro del peor escenario real dentro de UNA ventana
   UI, para que renderMatrix() (index.html) no reimplemente esta busqueda ni
   quede desalineada de alerts.js. Enumera dia critico (OTA + LM) x noche
   critica x canal, cotiza cada combinacion con quoteScenario() (fuente unica),
   y devuelve el peor caso por TECHO (mayor nativo compartido) y por PAYOUT
   (el que realmente neta menos) — pueden no ser el mismo escenario.

   BLOQUEANTE CRITICO corregido (revision externa): antes se elegia "el peor
   dia" solo por el descuento nativo OTA mas profundo, ignorando las fronteras
   de Last-Minute y sin enumerar noches — un LM configurado (flat/gradual/
   precio fijo/tramos) podia producir el peor payout real en un dia/noche que
   la matriz ni siquiera evaluaba. */
import {quoteScenario} from './quote.js';
import {criticalDaysInWindow, criticalNights} from './thresholds.js';
import {lmCriticalDays} from './pricelabs-lm.js';

/* config = {channels, discounts, windows, ceilings, ...costBreakdown/fixedCost/
   varCost/lmConfig/verification (todo lo que necesita quoteScenario)}
   w = una ventana de WINDOWS ({id,label,lo,hi,ceil})
   price = precio de referencia a cotizar (normalmente model.effBase) */
export function worstScenariosInWindow(config, w, price){
  const {discounts, channels, lmConfig} = config;
  const lmDays = lmCriticalDays(lmConfig);
  const daysGrid = [...new Set([...criticalDaysInWindow(discounts, w), ...lmDays.filter(d=>d>=w.lo && d<=w.hi)])].sort((a,b)=>a-b);
  const nightsGrid = criticalNights(discounts);
  const grid = [];
  daysGrid.forEach(d=>{
    nightsGrid.forEach(n=>{
      channels.forEach(c=>{
        grid.push({day:d, night:n, c, q: quoteScenario({chId:c.id, days:d, nights:n, price}, config)});
      });
    });
  });
  const worstTecho = grid.reduce((a,b)=>b.q.maxNAtScenario>a.q.maxNAtScenario ? b : a, grid[0]);
  const worstPayoutRow = grid.reduce((a,b)=>b.q.payout<a.q.payout ? b : a, grid[0]);
  const perChannel = channels.map(c=>{
    const rows = grid.filter(g=>g.c.id===c.id);
    const worstRow = rows.reduce((a,b)=>b.q.payout<a.q.payout ? b : a, rows[0]);
    return {chId:c.id, c, day:worstRow.day, night:worstRow.night, q:worstRow.q};
  });
  return {daysGrid, nightsGrid, grid, worstTecho, worstPayoutRow, perChannel};
}
