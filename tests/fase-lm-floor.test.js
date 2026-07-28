/* Contrato corregido — Min Price es el precio FINAL que PriceLabs no cruza.
   Los factores internos de PriceLabs (LM, demanda, ocupación, temporada) no
   se descuentan una segunda vez del Piso. Los descuentos posteriores de OTA,
   Offset, comisiones y costos sí se resuelven exhaustivamente. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, suggestedOffset} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {criticalDays, criticalNights} from '../src/domain/thresholds.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function directoOnlyConfig(){
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows)};
}

test('Min Price final no vuelve a descontar un LM plano: cotizado como precio final sigue cubriendo costo', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};
  const withLm = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  const withoutLm = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings});

  assert.equal(withLm.floor, withoutLm.floor, 'un LM interno no cambia el Piso FINAL de PriceLabs');
  const finalQuote = quoteScenario({chId:'direct', days:0, nights:1, price:withLm.floor, priceStage:'price_labs_final'}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.equal(finalQuote.lm, 0, 'el simulador/cotización final no vuelve a aplicar LM');
  assert.ok(finalQuote.payout >= 100-1e-6, `Piso final ${withLm.floor} debe cubrir costo; neto ${finalQuote.payout}`);

  const legacyPlanningQuote = quoteScenario({chId:'direct', days:0, nights:1, price:withLm.floor}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.ok(legacyPlanningQuote.payout < 100, 'la misma cifra tratada incorrectamente como PRE-LM demuestra el doble descuento que se eliminó del Piso');
});

test('LM gradual y por tramos tampoco cambian el Piso final; son análisis de Base, no descuentos posteriores', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const normal = compute({fixedCost:80, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings});
  const gradual = compute({fixedCost:80, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings,
    lmConfig:{...defaultLmConfig(), mode:'gradual', verified:true, gradual:{maxPct:40, days:5, on:true}}});
  const tiers = compute({fixedCost:80, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings,
    lmConfig:{...defaultLmConfig(), mode:'tiers', verified:true, tiers:[{id:'a', label:'A', fromDay:0, toDay:5, pct:30, on:true}]}});
  assert.equal(gradual.floor, normal.floor);
  assert.equal(tiers.floor, normal.floor);
});

test('Piso con precio fijo LM inviable se bloquea: un fijo puede saltarse el mínimo final', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', verified:true, fixedPrice:{price:10, fromDay:0, toDay:3, on:true}};
  const model = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, false);
  assert.ok(model.errors.some(e=>e.field==='lmConfig.fixedPrice'));
});

test('PROPIEDAD EXHAUSTIVA — Piso final cubre costo en cada OTA/día/noche aun si la OTA baja el precio por debajo de PriceLabs', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const cost = 70;
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:35, fromDay:0, toDay:7, on:true}};
  const model = compute({fixedCost:cost, varCost:0, margin:30, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);
  const failures=[];
  for(const c of channels) for(const d of criticalDays(discounts, windows)) for(const n of criticalNights(discounts)){
    const q = quoteScenario({chId:c.id, days:d, nights:n, price:model.floor, priceStage:'price_labs_final'}, {channels, discounts, windows, ceilings, fixedCost:cost, varCost:0, lmConfig});
    if(q.payout<cost-1e-6) failures.push(`${c.id} día=${d} noches=${n}: ${q.payout.toFixed(2)} < ${cost}`);
  }
  assert.equal(failures.length, 0, `Piso final no protegió: ${failures.slice(0,8).join(' · ')}`);
});

test('suggestedOffset sigue incluyendo LM en su día de referencia para Base Price', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'tiers', verified:true, tiers:[{id:'t1', label:'largo', fromDay:30, toDay:9999, pct:25, on:true}]};
  const base = {chId:'direct', channels, discounts, avgNights:3, effBase:200, netObjetivo:100};
  assert.ok(suggestedOffset({...base, lmConfig, windows, ceilings}) > suggestedOffset(base));
});
