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
import {fP, f$} from './format.js';

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

/* Bloqueante CRITICO (revision externa, ronda 2) — selector puro del veredicto
   por ventana, extraido de renderMatrix() (index.html) para que sea testeable
   sin DOM, igual que worstScenariosInWindow(). Antes, un LM automatico sin
   verificar solo agregaba texto de advertencia AL FINAL del tag/mensaje,
   dejando vLvl='ok' y el tag "RENTABLE EN TODOS" intactos — una recomendacion
   de "estas bien" con una letra chica que nadie lee. Ahora, si el unico motivo
   por el que la ventana sale bien es que el peor canal no rompe techo/costo/
   objetivo, PERO ese resultado depende de un LM no verificable
   (worst.q.lmBlocked), el veredicto entero cambia de nivel y de tag — deja de
   decir "RENTABLE" y pasa a un estado propio que nombra exactamente que falta
   confirmar y en que pantalla hacerlo. Los veredictos negativos (TECHO
   EXCEDIDO/BAJO COSTO/CUBRE COSTO) NO se bloquean: son advertencias, no una
   afirmacion de que todo esta bien, asi que dejarlos con el numero real es mas
   util que ocultarlos (y esta es la unica lectura de "lmBlocked" que el
   encargo pide bloquear explicitamente: Min Price/Base/Offset/veredicto
   "Rentable"). */
export function buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency}){
  const breach = worstTecho.q.breach;
  const maxN = worstTecho.q.maxNAtScenario;
  const maxCh = worstTecho.q.worstChannelAtScenario;
  const lm = worstPayoutRow.q.lm;
  const worst = perChannel.reduce((a,b)=>b.q.payout<a.q.payout ? b : a, perChannel[0]);
  const worstAsNet = {c: worst.c, netV: worst.q.payout};
  const lmCaveat = worst.q.lmBlocked
    ? ` (asume LM ${worst.q.lmMode==='ceiling_auto'?'automático':'"'+worst.q.lmMode+'"'} sin verificar — el número real podría variar, confírmalo en Resumen → "Last-Minute de PriceLabs")`
    : '';
  let vLvl, vTag, vMsg;
  if(breach){
    vLvl='bad'; vTag='TECHO EXCEDIDO';
    vMsg=`${maxCh?maxCh.name:'un canal'} ya suma ${fP(maxN)} de descuento propio — más que tu techo de ${fP(ceil)}. PriceLabs se queda en 0% de LM aquí y aun así se pasa: baja el descuento nativo de ${maxCh?maxCh.name:'ese canal'} o sube el techo.`;
  } else if(worstAsNet.netV<model.cost){
    vLvl='bad'; vTag='BAJO COSTO';
    vMsg=`Con ${fP(lm)} de LM, ${worstAsNet.c.name} te dejaría ${f$(worstAsNet.netV,currency)} — menos que tu costo de ${f$(model.cost,currency)}. Súbele el Offset a ${worstAsNet.c.name} en su pestaña, o baja su descuento nativo.${lmCaveat}`;
  } else if(worstAsNet.netV<model.net){
    vLvl='warn'; vTag='CUBRE COSTO, BAJO OBJETIVO';
    vMsg=`Todos los canales quedan sobre tu costo, pero ${worstAsNet.c.name} solo te deja ${f$(worstAsNet.netV,currency)} — por debajo de tu margen objetivo (${f$(model.net,currency)}). Revisa su Offset si quieres acercarlo.${lmCaveat}`;
  } else if(worst.q.lmBlocked){
    vLvl='warn'; vTag='LM SIN VERIFICAR — NO USAR COMO RECOMENDACIÓN';
    vMsg = `Esta ventana solo sale "rentable" asumiendo Last-Minute ${worst.q.lmMode==='ceiling_auto'
      ? 'en modo automático (proyección propia, no verificable matemáticamente sin el precio diario real de PriceLabs)'
      : `en modo "${worst.q.lmMode}" configurado pero sin marcar como verificado`} — confírmalo en Resumen → "Last-Minute de PriceLabs" (modo real + casilla "Confirmé este modo directamente en PriceLabs") antes de tratar este veredicto como definitivo.`;
  } else {
    vLvl='ok'; vTag='RENTABLE EN TODOS';
    vMsg=`Los 4 canales quedan sobre tu objetivo de margen en esta ventana. El más ajustado es ${worstAsNet.c.name}, con ${f$(worstAsNet.netV,currency)}.`;
  }
  return {vLvl, vTag, vMsg, worst, worstAsNet, lm};
}
