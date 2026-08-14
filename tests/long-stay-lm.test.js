/* Regla de negocio de estancias largas (jul 2026).
   Last-Minute solo se excluye de las búsquedas de peor caso: el simulador y
   cualquier cotización normal siguen aplicando exactamente el LM configurado. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LONG_STAY_NIGHTS} from '../src/domain/pricelabs-lm.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {compute} from '../src/domain/engine.js';
import {CHANNELS, WINDOWS, defaultDiscounts, defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

function gradualConfig(){
  return {...defaultLmConfig(), mode:'gradual', verified:true,
    gradual:{maxPct:28, days:6, on:true}};
}

function isolatedAirbnb(){
  const channels = freshChannels().filter(c=>c.id==='airbnb');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows)};
}

test('LONG_STAY_NIGHTS es el umbral único de estancia larga y coincide con el catálogo', () => {
  assert.equal(LONG_STAY_NIGHTS, 28);
  const discounts = defaultDiscounts();
  assert.equal(findDiscount(discounts, 'ab_los4').minN, LONG_STAY_NIGHTS);
});

test('quoteScenario: el flag excluye LM a partir de 28 noches, sin importar el día', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const config = {channels, discounts, windows, ceilings, fixedCost:1, varCost:0, lmConfig:gradualConfig()};
  for(const days of [0, 3, 6, 45]){
    const q = quoteScenario({chId:'airbnb', days, nights:34, price:200}, config, {excludeLmOnLongStay:true});
    assert.equal(q.lm, 0, `día ${days}: una estancia larga no debe recibir LM en la búsqueda de peor caso`);
    assert.match(q.assumptions.join(' '), /excluido del peor caso/);
  }
});

test('quoteScenario: sin el flag, una estancia larga sigue aplicando el LM real (contrato del Simulador)', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const config = {channels, discounts, windows, ceilings, fixedCost:1, varCost:0, lmConfig:gradualConfig()};
  const q = quoteScenario({chId:'airbnb', days:0, nights:34, price:200}, config);
  assert.equal(q.lm, 28);
  assert.equal(q.priceAfterLm, 144);
});

test('worstScenarioFactor: 28+ noches excluye el LM combinado del peor factor', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const longStay = findDiscount(discounts, 'ab_los4');
  longStay.on = true;
  longStay.pct = 80;
  const result = worstScenarioFactor({
    chId:'airbnb', channels, discounts, windows, ceilings,
    lmConfig:gradualConfig(), cost:1
  });
  /* A 28 noches el nativo deja 20%; si se multiplicara además el LM de 28%
     del día 0, el factor sería 0.144. La regla correcta conserva 0.20. */
  assert.ok(Math.abs(result.worstFactor-0.2)<1e-12,
    `factor=${result.worstFactor}, no debe combinar LM 28% con la estadía larga`);
  assert.equal(result.worstNight, LONG_STAY_NIGHTS);
});

test('caso numérico de referencia: quitar el combo LM+larga estadía reduce el Piso, no el simulador', () => {
  const windows = WINDOWS.map(w=>({...w}));
  const ceilings = Object.fromEntries(windows.map(w=>[w.id,w.ceil]));
  const channels = CHANNELS.filter(c=>c.id==='airbnb').map(c=>({...c, offsetPct:1.2}));
  const discounts = defaultDiscounts().map(d=>({...d, on:false}));
  const longStay = findDiscount(discounts, 'ab_los4');
  longStay.on = true;
  longStay.pct = 11.75;
  const lmConfig = gradualConfig();
  const base = {fixedCost:64, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig};
  const model = compute(base);
  /* En este equivalente aislado el caso viejo (LM×larga) queda en
     ~117.80 USD; con la regla nueva el Piso es ~103.94 USD. */
  assert.ok(Math.abs(model.floor-103.94)<0.02, `Piso nuevo inesperado: ${model.floor}`);
  const q = quoteScenario({chId:'airbnb', days:0, nights:34, price:200}, base);
  assert.equal(q.lm, 28, 'el simulador conserva el LM aun en 34 noches');
});
