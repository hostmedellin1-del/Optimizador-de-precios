/* Comisiones adicionales por programas de visibilidad.
   Booking Preferred Partner y Expedia Accelerator son cargos OTA al host, no
   descuentos del huésped: deben afectar payout/Piso y quedar visibles aparte. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, payoutFactor, extraCommPct} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {validateChannelInputs} from '../src/domain/validate.js';
import {normalizeUnit} from '../src/domain/persistence.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function isolatedConfig(channels){
  const discounts=freshDiscounts().map(d=>({...d,on:false}));
  const windows=freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows),
    fixedCost:100, varCost:0, margin:0, marketBase:0, avgNights:3,
    lmConfig:{mode:'flat', verified:true,
      flat:{pct:0, fromDay:0, toDay:9999, on:false},
      gradual:{maxPct:0, days:3, on:false},
      fixedPrice:{price:0, fromDay:0, toDay:3, on:false}, tiers:[]},
    currency:'USD', usingExampleCosts:false};
}

test('payoutFactor suma Preferred/Accelerator como comisión adicional, no como descuento', () => {
  const booking={id:'booking', name:'Booking.com', comm:18, bankFeePct:6, preferredPct:5, offsetPct:0};
  const expedia={id:'expedia', name:'Expedia', comm:25, bankFeePct:0, acceleratorPct:3, offsetPct:0};
  assert.equal(extraCommPct(booking), 5);
  assert.equal(extraCommPct(expedia), 3);
  assert.equal(payoutFactor(booking), 0.71); // 1 - .18 - .05 - .06
  assert.equal(payoutFactor(expedia), 0.72); // 1 - .25 - .03
});

test('compute().floor sube cuando Booking activa 5% de Alojamientos preferentes', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  booking.comm=18; booking.bankFeePct=6;
  const without=compute(isolatedConfig(channels));
  booking.preferredPct=5;
  const withExtra=compute(isolatedConfig(channels));
  assert.equal(withExtra.floorChId, 'booking');
  assert.ok(withExtra.floor>without.floor, `${withExtra.floor} debe superar ${without.floor}`);
  assert.equal(withExtra.floor, 100/(1-0.18-0.05-0.06));
  assert.match(withExtra.floorCh, /comisión extra 5/);
});

test('quoteScenario mantiene payout como una sola resta sobre guestWithFees', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  Object.assign(booking,{comm:18, bankFeePct:6, preferredPct:5});
  const cfg=isolatedConfig(channels);
  const q=quoteScenario({chId:'booking', days:45, nights:1, price:100}, cfg);
  assert.equal(q.extraCommAmt, q.guestWithFees*0.05);
  assert.equal(q.payout, q.guestWithFees*(1-0.18-0.05-0.06));
  assert.notEqual(q.payout, q.guestWithFees*(1-0.18)*(1-0.05)*(1-0.06));
});

test('worstScenarioFactor hereda el payoutFactor con comisión extra y aumenta el precio requerido', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  Object.assign(booking,{comm:18, bankFeePct:6});
  const cfg=isolatedConfig(channels);
  const without=worstScenarioFactor({...cfg, chId:'booking', cost:100});
  booking.preferredPct=5;
  const withExtra=worstScenarioFactor({...cfg, chId:'booking', cost:100});
  assert.equal(without.pf, 0.76);
  assert.equal(withExtra.pf, 0.71);
  assert.ok(100/(withExtra.worstFactor*withExtra.pf)>100/(without.worstFactor*without.pf));
});

test('validateChannelInputs suma comisión base + extra + bancaria: 99.999 pasa, 100 o más falla', () => {
  const almost={id:'booking',name:'Booking.com',comm:90,bankFeePct:4.999,preferredPct:2.5,acceleratorPct:2.5,offsetPct:0};
  assert.equal(validateChannelInputs([almost]).some(e=>e.level==='error'), false);
  almost.acceleratorPct=2.501;
  const errors=validateChannelInputs([almost]);
  assert.equal(errors.some(e=>e.level==='error'), true);
  assert.match(errors.find(e=>e.level==='error').msg, /comision extra/);
});

test('Airbnb y Directo sin comisión adicional conservan exactamente su payout previo', () => {
  assert.equal(payoutFactor({comm:15.5, bankFeePct:0}), 1-0.155);
  assert.equal(payoutFactor({comm:3, bankFeePct:6}), 1-0.03-0.06);
  const withCatalog=freshChannels();
  const withoutFields=withCatalog.map(c=>{
    const copy={...c};
    delete copy.preferredPct; delete copy.acceleratorPct;
    return copy;
  });
  const a=compute(isolatedConfig(withCatalog));
  const b=compute(isolatedConfig(withoutFields));
  assert.equal(a.floor, b.floor);
  assert.equal(a.base, b.base);
});

test('normalizeUnit agrega los campos nuevos a canales correctos y conserva compatibilidad', () => {
  const {state,warnings}=normalizeUnit({name:'Vieja'});
  assert.equal(state.channels.find(c=>c.id==='booking').preferredPct, 0);
  assert.equal(state.channels.find(c=>c.id==='expedia').acceleratorPct, 0);
  assert.equal(warnings.some(w=>w.includes('preferredPct')||w.includes('acceleratorPct')), false);
});

test('normalizeUnit corrige comisión extra inválida y no copia preferredPct a Airbnb', () => {
  const {state,warnings}=normalizeUnit({name:'Invalid', channels:[
    {id:'booking', preferredPct:-1},
    {id:'expedia', acceleratorPct:101},
    {id:'airbnb', preferredPct:7}
  ]});
  assert.equal(state.channels.find(c=>c.id==='booking').preferredPct, 0);
  assert.equal(state.channels.find(c=>c.id==='expedia').acceleratorPct, 0);
  assert.equal('preferredPct' in state.channels.find(c=>c.id==='airbnb'), false);
  assert.ok(warnings.some(w=>w.includes('preferredPct')));
  assert.ok(warnings.some(w=>w.includes('acceleratorPct')));
});
