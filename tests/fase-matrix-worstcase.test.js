/* BLOQUEANTE CRITICO (revision externa) — la matriz elegia el "peor dia" por
   mayor descuento NATIVO OTA solamente, ignorando fronteras de LM y noches
   criticas. src/domain/matrix.js (worstScenariosInWindow) corrige esto:
   enumera dia x noche x canal (OTA + LM) y elige por PAYOUT real, no por %
   nativo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {worstScenariosInWindow} from '../src/domain/matrix.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

test('worstScenariosInWindow: el peor PAYOUT puede estar en un día donde el LM pega fuerte, aunque el descuento OTA ahí sea menor', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  discounts.forEach(d=>{ d.on=false; });
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const w5 = windows.find(w=>w.id==='w5'); // "30+ dias"

  // Airbnb: un descuento OTA PEQUEÑO (10%) activo desde el día 30 en adelante —
  // si la matriz solo mirara el nativo mas profundo, este seria "el peor caso".
  const eb = findDiscount(discounts, 'ab_eb1');
  eb.on = true; eb.pct = 10; // from:30, to:9999 (catalogo)

  // LM flat MUCHO mas agresivo (60%), pero solo en un rango de dias ESPECIFICO
  // (40-45) que un selector "por dia critico OTA" ni siquiera enumeraria, porque
  // 40/45 no son fronteras de ningun descuento OTA.
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:60, fromDay:40, toDay:45, on:true}};

  const config = {channels, discounts, windows, ceilings, fixedCost:50, varCost:0, lmConfig};
  const {worstPayoutRow, daysGrid} = worstScenariosInWindow(config, w5, 200);

  assert.ok(daysGrid.includes(40) && daysGrid.includes(45), `la enumeracion de dias debe incluir las fronteras del LM (40,45), no solo las de OTA: ${daysGrid}`);
  assert.equal(worstPayoutRow.day >= 40 && worstPayoutRow.day <= 45, true, `el peor payout real debe caer dentro del rango del LM agresivo (40-45), no en un dia OTA-only; dio dia ${worstPayoutRow.day}`);
  assert.equal(worstPayoutRow.q.lm, 60, 'el escenario de peor payout debe reflejar el LM de 60%, no solo el nativo OTA de 10%');
});

test('Bloqueante BAJO (revision externa, ronda 2) — worstPayoutRow expone day/night, NUNCA d/n: index.html leia .d/.n (inexistentes) y siempre mostraba "día undefined"', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const w0 = windows.find(w=>w.id==='w0');
  const config = {channels, discounts, windows, ceilings, fixedCost:50, varCost:0};
  const {worstPayoutRow} = worstScenariosInWindow(config, w0, 200);
  assert.equal(typeof worstPayoutRow.day, 'number', 'worstPayoutRow.day debe ser un numero real, no undefined');
  assert.equal(typeof worstPayoutRow.night, 'number', 'worstPayoutRow.night debe ser un numero real, no undefined');
  assert.equal(worstPayoutRow.d, undefined, 'worstPayoutRow.d nunca existió — cualquier lectura de este campo es el bug que se está guardando aquí');
  assert.equal(worstPayoutRow.n, undefined, 'worstPayoutRow.n nunca existió — cualquier lectura de este campo es el bug que se está guardando aquí');
});

test('worstScenariosInWindow: enumera noches criticas, no solo una noche fija', () => {
  const channels = freshChannels().filter(c=>c.id==='booking');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const w0 = windows.find(w=>w.id==='w0');
  // Descuento por duracion de Booking: solo pega en noches >=7
  const los = findDiscount(discounts, 'bk_los1'); // minN:7
  const freshDiscountsArr = discounts.map(d=>d.id==='bk_los1' ? {...d, on:true, pct:40} : d);

  const config = {channels, discounts: freshDiscountsArr, windows, ceilings, fixedCost:50, varCost:0};
  const {worstPayoutRow, nightsGrid} = worstScenariosInWindow(config, w0, 200);
  assert.ok(nightsGrid.includes(7), `debe enumerar la noche critica 7 (umbral del descuento por duracion): ${nightsGrid}`);
  assert.equal(worstPayoutRow.night >= 7, true, 'el peor payout debe ocurrir en una reserva de 7+ noches (donde aplica el descuento por duracion), no en 1 noche');
});
