/* BUG REAL (sep 2026) — la Matriz (Comparación) tenía la MISMA confusión que el
   Piso y las alertas: comparaba el neto de un escenario de N noches contra
   `model.cost`, el costo de UNA noche.

   Dos consecuencias, ambas del mismo error:
   1. `worstScenariosInWindow()` elegía el peor caso por MENOR PAYOUT. Con el
      desglose detallado activo, una estadía larga netea menos POR NOCHE pero
      también CUESTA menos por noche — puede ser la de menor payout y a la vez la
      más rentable. Elegirla y compararla contra un costo daba falsos positivos
      ("BAJO COSTO" sobre un escenario rentable) y podía tapar un escenario corto
      que sí vende bajo costo (falso NEGATIVO, el peligroso).
   2. `buildMatrixVerdict()` comparaba ese payout contra `model.cost`.

   Ahora ambos usan el MARGEN real del escenario (`q.payout - q.cost`). Con el
   modelo simple (costo constante para toda duración) las dos reglas coinciden
   exactamente, así que no hay regresión para quien no llenó el desglose. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worstScenariosInWindow, buildMatrixVerdict} from '../src/domain/matrix.js';
import {compute} from '../src/domain/engine.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function syntheticConfig(){
  /* Un solo canal, sin comisiones ni LM, con un costo por turno grande (se
     diluye entre las noches) y un descuento por duración que hunde el payout de
     la estadía larga:
       1 noche  → costo 110/noche, payout 100  (PIERDE 10)
       20 noches → costo  15/noche, payout  40  (GANA 25, con payout menor) */
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:60, minN:20, on:true}];
  const windows = [{id:'w0', label:'todo', lo:0, hi:9999, ceil:100}];
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:1, cleaning:100, laundry:0, supplies:0, consumables:10};
  return {channels, discounts, windows, ceilings:{w0:100}, lmConfig,
    costBreakdown, costBreakdownConfirmed:true, fixedCost:0, varCost:0, margin:0, marketBase:0};
}

test('worstScenariosInWindow — el peor caso POR CANAL es el de peor margen, no el de menor payout', () => {
  const config = syntheticConfig();
  const {perChannel, worstPayoutRow} = worstScenariosInWindow(config, config.windows[0], 100);
  const direct = perChannel.find(p=>p.chId==='direct');
  assert.equal(direct.night, 1, `el peor caso debe ser la reserva de 1 noche (pierde 10) — dio ${direct.night} noches`);
  assert.ok(direct.q.payout < direct.q.cost, `a 1 noche el payout (${direct.q.payout}) queda bajo el costo (${direct.q.cost})`);

  /* `worstPayoutRow` NO cambia: la Matriz lo muestra con el rótulo "Peor payout
     real detectado" y tiene que seguir diciendo la verdad literal. */
  assert.equal(worstPayoutRow.night, 20, 'el peor PAYOUT sigue siendo la estadía larga — ese rótulo no cambia de significado');
});

test('buildMatrixVerdict — "BAJO COSTO" se decide contra el costo del escenario, no contra el de 1 noche', () => {
  const config = syntheticConfig();
  const model = compute(config);
  assert.equal(model.cost, 110);
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(config, config.windows[0], 100);
  const v = buildMatrixVerdict({model, ceil:100, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.equal(v.vTag, 'BAJO COSTO', 'la reserva de 1 noche vende bajo su propio costo: el veredicto debe marcarlo');
  assert.match(v.vMsg, /1 noche/, `el veredicto debe nombrar el escenario real (1 noche) — dio: ${v.vMsg}`);
  assert.match(v.vMsg, /costo real de esa reserva/, 'el mensaje debe dejar claro que el costo es el de ESA reserva');
});

test('buildMatrixVerdict — una estadía larga rentable ya NO se marca "BAJO COSTO" solo por netear menos por noche', () => {
  /* Mismo escenario pero con un precio que hace rentable también la reserva de
     1 noche: 150 → 1 noche netea 150 > 110; 20 noches netea 60 > 15. Ninguna
     pierde. Antes, comparar los 60 de la estadía larga contra el costo de 1
     noche (110) daba "BAJO COSTO" sobre un escenario que gana 45 por noche. */
  const config = syntheticConfig();
  const model = compute(config);
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(config, config.windows[0], 150);
  const v = buildMatrixVerdict({model, ceil:100, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.notEqual(v.vTag, 'BAJO COSTO', `ningún escenario pierde plata acá — dio "${v.vTag}": ${v.vMsg}`);
});

test('no-regresión — con el modelo simple (costo constante) la elección por margen es idéntica a la de payout', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const config = {channels, discounts, windows, ceilings, fixedCost:50, varCost:10};
  for(const w of windows){
    const {perChannel, grid} = worstScenariosInWindow(config, w, 120);
    for(const p of perChannel){
      const rows = grid.filter(g=>g.c.id===p.chId);
      const minPayout = Math.min(...rows.map(g=>g.q.payout));
      assert.ok(Math.abs(p.q.payout - minPayout) < 1e-12,
        `${w.id}/${p.chId}: sin desglose el costo es constante, así que el de peor margen DEBE ser el de menor payout (${p.q.payout} vs ${minPayout})`);
    }
  }
});
