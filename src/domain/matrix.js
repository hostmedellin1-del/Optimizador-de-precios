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
import {netForNightFn} from './costs.js';

/* config = {channels, discounts, windows, ceilings, ...costBreakdown/fixedCost/
   varCost/lmConfig (todo lo que necesita quoteScenario)}
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
        grid.push({day:d, night:n, c, q: quoteScenario({chId:c.id, days:d, nights:n, price}, config, {excludeLmOnLongStay:true})});
      });
    });
  });
  const worstTecho = grid.reduce((a,b)=>b.q.maxNAtScenario>a.q.maxNAtScenario ? b : a, grid[0]);
  const worstPayoutRow = grid.reduce((a,b)=>b.q.payout<a.q.payout ? b : a, grid[0]);
  /* Fix sep 2026 — misma raiz que el fix del VALOR del Piso (engine.js) y el de
     la alerta PISO (alerts.js): el peor caso de un canal NO es el de menor
     `payout` a secas, porque el costo por noche tambien cambia con la duracion.
     Una estadia de 34 noches puede netear menos por noche que una de 1 y aun
     asi dejar mas margen (su costo por noche es ~42.6 contra 71.5 en la 902).
     Elegir por payout y despues comparar contra un costo hacia que la Matriz
     dijera "BAJO COSTO" con un escenario largo que en realidad es rentable
     (falso positivo) y, peor, que pudiera esconder un escenario corto que si
     vende bajo costo (falso negativo). Se elige por MARGEN real
     (`payout - cost`), que con costo constante (modelo simple fixedCost+
     varCost) es exactamente la misma eleccion de siempre — cero regresion ahi.
     `worstPayoutRow` NO cambia de definicion: sigue siendo el menor payout
     literal y tiene tests propios que lo fijan (ver `worstCaseRow` abajo para
     lo que consume hoy la UI). */
  const perChannel = channels.map(c=>{
    const rows = grid.filter(g=>g.c.id===c.id);
    const worstRow = rows.reduce((a,b)=>(b.q.payout-b.q.cost)<(a.q.payout-a.q.cost) ? b : a, rows[0]);
    return {chId:c.id, c, day:worstRow.day, night:worstRow.night, q:worstRow.q};
  });
  /* `worstCaseRow` = el peor MARGEN global de la ventana (mismo criterio que
     `perChannel`, sin separar por canal). Es lo que la Matriz debe resumir
     arriba del detalle: si ahí se mostrara `worstPayoutRow` (el menor payout a
     secas) el encabezado podría nombrar un día/noche que NO es el que aparece
     en la fila de ese mismo canal, porque las dos listas medirían cosas
     distintas. `worstPayoutRow` se conserva tal cual — sigue siendo el menor
     payout literal y tiene tests propios que lo fijan. */
  const worstCaseRow = grid.reduce((a,b)=>(b.q.payout-b.q.cost)<(a.q.payout-a.q.cost) ? b : a, grid[0]);
  return {daysGrid, nightsGrid, grid, worstTecho, worstPayoutRow, worstCaseRow, perChannel};
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
/* `worstPayoutRow` se sigue aceptando en la firma por compatibilidad con los
   callers/tests existentes, pero desde sep 2026 esta funcion NO lo usa: el LM
   que nombra el mensaje sale del escenario del canal mas ajustado (ver abajo),
   para que el % y el neto que se citan vengan del MISMO escenario. */
export function buildMatrixVerdict({model, ceil, worstTecho, perChannel, currency}){
  const breach = worstTecho.q.breach;
  const maxN = worstTecho.q.maxNAtScenario;
  const maxCh = worstTecho.q.worstChannelAtScenario;
  /* Fix sep 2026 (ver worstScenariosInWindow arriba): el canal "mas ajustado"
     es el de menor MARGEN (payout - costo de SU escenario), no el de menor
     payout — cada fila puede tener una duracion distinta y por tanto un costo
     por noche distinto. Con costo constante ambas reglas coinciden. */
  const worst = perChannel.reduce((a,b)=>(b.q.payout-b.q.cost)<(a.q.payout-a.q.cost) ? b : a, perChannel[0]);
  /* El LM que se nombra en el mensaje es el del escenario de ESE canal, no el
     del menor payout global (`worstPayoutRow`): el mensaje dice "con X% de LM,
     <canal> te dejaría Y", y X e Y tienen que venir del mismo escenario. Antes
     podían venir de dos escenarios distintos. */
  const lm = worst.q.lm;
  const worstAsNet = {c: worst.c, netV: worst.q.payout, costV: worst.q.cost};
  /* Fix sep 2026 (Piso vs Min Price): si el Min Price topó el precio en el peor
     escenario, decir a secas "con X% de LM te dejaría Y" es engañoso — ese X% no
     llegó a aplicarse sobre el precio publicado. El número (Y) ya es correcto
     porque quoteScenario() aplica el tope; lo que falta es nombrarlo. */
  const minCapNote = worst.q.minPriceApplied
    ? ` (el Min Price de ${f$(worst.q.minPrice,currency)} topó el precio: ese LM no llega a aplicarse al publicado)`
    : '';
  const lmCaveat = worst.q.lmBlocked
    ? ` (asume LM ${worst.q.lmMode==='ceiling_auto'?'automático':'"'+worst.q.lmMode+'"'} sin verificar — el número real podría variar, confírmalo en Resumen → "Last-Minute de PriceLabs")`
    : '';
  /* Fix sep 2026 ("objetivo por duracion", misma raiz que "BAJO COSTO" arriba
     y que el fix equivalente en alerts.js): "CUBRE COSTO, BAJO OBJETIVO"
     comparaba `worstAsNet.netV` (el payout del escenario del canal mas
     ajustado, que puede ser de CUALQUIER duracion) contra `model.net` — el
     objetivo evaluado SIEMPRE al costo de 1 noche. El margen es un
     PORCENTAJE que debe aplicarse sobre el costo REAL de ESE escenario
     (`worstAsNet.costV`), no sobre el de 1 noche.
     El margen se recupera del propio `model` (`model.net = model.cost/(1-m/100)`,
     ver engine.js) en vez de requerir un parametro nuevo en la firma: esta
     funcion no recibe `config`, y derivarlo de `model.cost`/`model.net` es
     matematicamente exacto (y evita que buildMatrixVerdict() necesite un
     segundo canal de entrada del mismo margen que ya viaja implicito en el
     modelo) — si `model.cost` es 0, el margen no importa: `netForNight(0)`
     da 0 para cualquier margen valido. */
  const marginPct = model.cost>0 ? 100*(1-model.cost/model.net) : 0;
  const netForNight = netForNightFn(marginPct);
  let vLvl, vTag, vMsg;
  if(breach){
    vLvl='bad'; vTag='TECHO EXCEDIDO';
    vMsg=`${maxCh?maxCh.name:'un canal'} ya suma ${fP(maxN)} de descuento propio — más que tu techo de ${fP(ceil)}. PriceLabs se queda en 0% de LM aquí y aun así se pasa: baja el descuento nativo de ${maxCh?maxCh.name:'ese canal'} o sube el techo.`;
  } else if(worstAsNet.netV<worstAsNet.costV){
    /* `worstAsNet.costV` (el costo de ESE escenario, con SU duracion), nunca
       `model.cost` (el costo de 1 noche) — ver el comentario de arriba. */
    vLvl='bad'; vTag='BAJO COSTO';
    vMsg=`Con ${fP(lm)} de LM${minCapNote}, ${worstAsNet.c.name} te dejaría ${f$(worstAsNet.netV,currency)} en su peor escenario (${worst.night} noche${worst.night===1?'':'s'}) — menos que el costo real de esa reserva (${f$(worstAsNet.costV,currency)} por noche). Súbele el Offset a ${worstAsNet.c.name} en su pestaña, o baja su descuento nativo.${lmCaveat}`;
  } else if(worstAsNet.netV<netForNight(worstAsNet.costV)){
    vLvl='warn'; vTag='CUBRE COSTO, BAJO OBJETIVO';
    vMsg=`Todos los canales quedan sobre tu costo, pero ${worstAsNet.c.name} solo te deja ${f$(worstAsNet.netV,currency)} en su peor escenario (${worst.night} noche${worst.night===1?'':'s'}) — por debajo de su margen objetivo para esa duración (${f$(netForNight(worstAsNet.costV),currency)}). Revisa su Offset si quieres acercarlo.${lmCaveat}`;
  } else if(worst.q.lmBlocked){
    vLvl='warn'; vTag='LM SIN VERIFICAR — NO USAR COMO RECOMENDACIÓN';
    vMsg = `Esta ventana solo sale "rentable" asumiendo Last-Minute ${worst.q.lmMode==='ceiling_auto'
      ? 'en modo automático (proyección propia, no verificable matemáticamente sin el precio diario real de PriceLabs)'
      : `en modo "${worst.q.lmMode}" configurado pero sin marcar como verificado`} — confírmalo en Resumen → "Last-Minute de PriceLabs" (modo real + casilla "Confirmé este modo directamente en PriceLabs") antes de tratar este veredicto como definitivo.`;
  } else if(model.costBlocked){
    /* BLOQUEANTE 2 (auditoria externa, ronda 4): mismo espiritu que
       lmBlocked/unready — "rentable en todos" tampoco se puede sostener si
       el costo contra el que se mide (model.cost) todavia no esta
       confirmado (ejemplo de fabrica, o desglose detallado sin confirmar).
       Solo reemplaza el veredicto POSITIVO — TECHO EXCEDIDO/BAJO COSTO/
       CUBRE COSTO siguen mostrandose igual (son advertencias reales, no una
       afirmacion de "todo bien"). Ver src/domain/cost-mode.js. */
    vLvl='warn'; vTag='COSTOS SIN CONFIRMAR — NO USAR COMO RECOMENDACIÓN';
    vMsg = `Esta ventana solo sale "rentable en todos" con el costo actual (${f$(model.cost,currency)}), que todavía no está confirmado como un dato real de esta unidad — confírmalo en Resumen → "Costos por noche" antes de tratar este veredicto como definitivo.`;
  } else {
    vLvl='ok'; vTag='RENTABLE EN TODOS';
    vMsg=`Los 4 canales quedan sobre tu objetivo de margen en esta ventana. El más ajustado es ${worstAsNet.c.name}, con ${f$(worstAsNet.netV,currency)}.`;
  }
  return {vLvl, vTag, vMsg, worst, worstAsNet, lm};
}
