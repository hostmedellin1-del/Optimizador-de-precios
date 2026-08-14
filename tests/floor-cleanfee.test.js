/* Regresión de la tarifa de aseo de Airbnb en Piso/Base.
   La tarifa se cobra una vez por reserva y Airbnb cobra comisión sobre ella;
   por eso el ingreso que aporta debe diluirse por las noches del escenario,
   no tratarse como un descuento ni como un costo nocturno. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, cleanFeePerNight} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

function lmFlat(pct=0){
  return {
    mode:'flat', verified:true,
    flat:{pct, fromDay:0, toDay:9999, on:pct>0},
    gradual:{maxPct:0, days:3, on:false},
    fixedPrice:{price:0, fromDay:0, toDay:3, on:false}, tiers:[]
  };
}

function airbnb({feeShort=0, feeLong=0, offsetPct=0, comm=15.5}={}){
  return {id:'airbnb', name:'Airbnb', comm, offsetPct, bankFeePct:0,
    cleanFeeShort:feeShort, cleanFeeLong:feeLong};
}

function airbnbConfig({channel=airbnb(), costBreakdown, fixedCost=60, varCost=0,
  margin=0, lmConfig=lmFlat(), discounts=freshDiscounts()}={}){
  const channels=[channel];
  const windows=freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows),
    fixedCost, varCost, margin, marketBase:0, avgNights:4, lmConfig,
    costBreakdown, costBreakdownConfirmed:costBreakdown ? true : undefined,
    usingExampleCosts:false, currency:'USD'};
}

test('tarifa 0: el Piso conserva exactamente el resultado de main antes del cambio', () => {
  const cfg=airbnbConfig({fixedCost:60, varCost:0});
  const model=compute(cfg);
  /* Este valor se obtuvo ejecutando la misma configuración sobre main (82b4010)
     antes de incluir cleanFeePerNight en worstScenarioFactor(). */
  assert.equal(model.floor, 94.67455621301775);
});

test('tarifa corta real baja el Piso de forma notoria', () => {
  const discounts=freshDiscounts().filter(d=>d.ch==='airbnb').map(d=>({...d,on:false}));
  const base=airbnbConfig({discounts, fixedCost:60, varCost:0});
  const withFee=airbnbConfig({discounts, channel:airbnb({feeShort:25, feeLong:25}), fixedCost:60, varCost:0});
  const noFeeScenario=worstScenarioFactor({...base, chId:'airbnb', cost:60});
  const feeScenario=worstScenarioFactor({...withFee, chId:'airbnb', cost:60});
  const noFeeShort=60/(noFeeScenario.worstFactor*noFeeScenario.pf);
  const feeShort=(60/feeScenario.pf-cleanFeePerNight(withFee.channels[0],1))/feeScenario.worstFactor;
  assert.ok(feeShort < noFeeShort-20,
    `el aseo de una reserva corta debe bajar su precio requerido (${noFeeShort} → ${feeShort})`);
  const modelWithout=compute(base), modelWith=compute(withFee);
  assert.ok(modelWith.floor < modelWithout.floor,
    `el Piso global también debe reflejar el ingreso (${modelWithout.floor} → ${modelWith.floor})`);
});

test('caso 902: el Piso baja de USD 140.22 a USD 138.69 y el peor caso pasa de 21 a 27 noches', () => {
  const channels=[airbnb({feeShort:20, feeLong:25, offsetPct:16})];
  const discounts=freshDiscounts().filter(d=>d.ch==='airbnb').map(d=>({...d, on:false}));
  const duration=findDiscount(discounts, 'ab_los6');
  Object.assign(duration, {on:true, pct:15, minN:21});
  /* Factor equivalente a la configuración LM verificada de la unidad 902 en
     este caso aislado: el objetivo del test es la dilución del ingreso fijo,
     no volver a probar el catálogo completo de PriceLabs. */
  const cfg=airbnbConfig({channel:channels[0], discounts, lmConfig:lmFlat(38.79844523125162),
    costBreakdown:{rent:700,admin:140,utilities:108,insurance:5,tech:22,occNights:26,
      cleaning:20,laundry:5,supplies:5,consumables:4}, fixedCost:0, varCost:0});
  const legacy=worstScenarioFactor({...cfg, chId:'airbnb'});
  const current=worstScenarioFactor({...cfg, chId:'airbnb', cost:71.5});
  const oldFloor=71.5/(legacy.worstFactor*legacy.pf);
  const model=compute(cfg);
  assert.equal(legacy.worstNight, 21);
  assert.equal(current.worstNight, 27);
  assert.equal(oldFloor.toFixed(2), '140.22');
  assert.equal(model.floor.toFixed(2), '138.69');
});

test('worstFeePerNight coincide con cleanFeePerNight del escenario devuelto', () => {
  const cfg=airbnbConfig({channel:airbnb({feeShort:20, feeLong:25}), fixedCost:60});
  const result=worstScenarioFactor({...cfg, chId:'airbnb', cost:60});
  assert.equal(result.worstFeePerNight, cleanFeePerNight(cfg.channels[0], result.worstNight));
});

test('sin cost numérico conserva el criterio legado: minimiza combinedFactor e ignora la tarifa', () => {
  const cfg=airbnbConfig({channel:airbnb({feeShort:20, feeLong:25}), fixedCost:60});
  const result=worstScenarioFactor({...cfg, chId:'airbnb'});
  const noFee=worstScenarioFactor({...airbnbConfig({channel:airbnb(), fixedCost:60}), chId:'airbnb'});
  assert.equal(result.worstFactor, noFee.worstFactor);
  assert.equal(result.worstDay, noFee.worstDay);
  assert.equal(result.worstNight, noFee.worstNight);
});

test('Base baja coherentemente con una tarifa de aseo en su referencia de 1 noche', () => {
  const noFee=compute(airbnbConfig({fixedCost:60, margin:25}));
  const cfg=airbnbConfig({channel:airbnb({feeShort:20, feeLong:25}), fixedCost:60, margin:25});
  const withFee=compute(cfg);
  assert.ok(withFee.base < noFee.base, `Base con aseo (${withFee.base}) debe ser menor que sin aseo (${noFee.base})`);
  const q=quoteScenario({chId:'airbnb', days:45, nights:1, price:withFee.base}, cfg);
  assert.ok(q.payout >= withFee.net-1e-9, `el Base cotizado debe netear el objetivo (${q.payout} < ${withFee.net})`);
});

test('Base bloqueado por precio fijo LM mantiene exactamente la rama existente', () => {
  const fixed={mode:'fixed_price', verified:true,
    flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0, days:3, on:false},
    fixedPrice:{price:70, fromDay:45, toDay:45, on:true}, tiers:[]};
  const a=compute(airbnbConfig({lmConfig:fixed, channel:airbnb({feeShort:20, feeLong:25}), fixedCost:60}));
  const b=compute(airbnbConfig({lmConfig:fixed, channel:airbnb({feeShort:0, feeLong:0}), fixedCost:60}));
  assert.equal(a.baseBlocked, true);
  assert.equal(b.baseBlocked, true);
  assert.notEqual(a.baseBlockedReason, null);
  assert.notEqual(b.baseBlockedReason, null);
});

test('precio fijo que queda bajo costo antes del aseo deja de ser infeasible cuando el aseo lo cubre', () => {
  const fixed={mode:'fixed_price', verified:true,
    flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0, days:3, on:false},
    fixedPrice:{price:71, fromDay:0, toDay:9999, on:true}, tiers:[]};
  const discounts=freshDiscounts().filter(d=>d.ch==='airbnb').map(d=>({...d,on:false}));
  const cfg=airbnbConfig({lmConfig:fixed, discounts, channel:airbnb({feeShort:25, feeLong:25}), fixedCost:60});
  const result=worstScenarioFactor({...cfg, chId:'airbnb', cost:60});
  assert.equal(result.infeasible.length, 0);
});
