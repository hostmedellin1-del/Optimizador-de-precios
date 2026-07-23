/* Reconciliación de reservas reales (src/domain/reconciliation.js) —
   preparación para datos reales. Cada caso trae la fórmula esperada a mano
   en el comentario, no solo el motor contra sí mismo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReservation} from '../src/domain/reconciliation.js';
import {quoteScenario} from '../src/domain/quote.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function quoteConfigFor(overrides = {}){
  return {
    channels: freshChannels(), discounts: freshDiscounts().map(d=>({...d, on:false})),
    windows: freshWindows(), ceilings: defaultCeilings(),
    fixedCost:32, varCost:22, ...overrides
  };
}

test('reserva real IGUAL al estimado: diferencia cero, severidad "ok", confiable, sin causas', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, false);
  assert.equal(r.diff.absolute, 0);
  assert.equal(r.diff.percent, 0);
  assert.equal(r.severity, 'ok');
  assert.equal(r.reliable, true);
  assert.deepEqual(r.breakdown, []);
  assert.deepEqual(r.causes, []);
});

test('comisión OTA real DISTINTA de la configurada: aparece en el desglose y en las causas, con el % exacto de cada lado', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout-20, otaCommissionPct: 20},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.ok, true);
  assert.equal(r.diff.absolute, -20);
  assert.equal(r.breakdown.length, 1);
  assert.equal(r.breakdown[0].component, 'Comisión OTA %');
  assert.equal(r.breakdown[0].configured, 15.5); // comisión Airbnb de fábrica
  assert.equal(r.breakdown[0].real, 20);
  assert.match(r.causes[0], /Comisión OTA real de Airbnb \(20%\)/);
});

test('payout real MENOR al estimado, más de 10%: severidad "bad" (alerta clara), no confiable', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'direct', days:20, nights:3, price:150}, quoteConfig);
  const real = est.payout*0.8; // 20% menos
  const r = reconcileReservation({
    real: {chId:'direct', price:150, nights:3, days:20, currency:'USD', payoutReceived: real},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.severity, 'bad');
  assert.equal(r.reliable, false);
  assert.ok(r.diff.percent < -10);
});

test('payout real MAYOR al estimado, más de 3%: severidad "warn" (informativo, no alarma), no "bad"', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'direct', days:20, nights:3, price:150}, quoteConfig);
  const real = est.payout*1.15; // 15% mas
  const r = reconcileReservation({
    real: {chId:'direct', price:150, nights:3, days:20, currency:'USD', payoutReceived: real},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.severity, 'warn');
  assert.equal(r.reliable, false);
});

test('diferencia pequeña (<=3%): severidad "ok" pese a no ser exactamente igual — ruido normal', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'direct', days:20, nights:3, price:150}, quoteConfig);
  const real = est.payout*1.02; // 2% mas, dentro del umbral
  const r = reconcileReservation({
    real: {chId:'direct', price:150, nights:3, days:20, currency:'USD', payoutReceived: real},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.severity, 'ok');
  assert.equal(r.reliable, true);
});

test('monedas DISTINTAS sin tipo de cambio verificado: consolidación bloqueada, sin diff numérico engañoso', () => {
  const quoteConfig = quoteConfigFor();
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'COP', payoutReceived: 400000},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, true);
  assert.match(r.currencyBlockedReason, /COP→USD/);
  assert.equal(r.diff, null);
  assert.equal(r.reliable, false);
});

test('conversión manual VERIFICADA: consolidación permitida, cálculo exacto con el rate configurado', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  // 1 COP = 1/4000 USD -> payoutReceived en COP que equivale EXACTO al estimado en USD
  const payoutCOP = est.payout*4000;
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'COP', payoutReceived: payoutCOP},
    quoteConfig, currency:'USD', fxRates: {COP: {rate: 1/4000, source:'TRM manual', date:'2026-07-01', status:'verificado'}}
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, false);
  assert.ok(Math.abs(r.diff.absolute) < 1e-6);
  assert.equal(r.severity, 'ok');
  assert.match(r.conversionCaveat, /REFERENCIA/);
});

test('tipo de cambio vacío/cero/negativo/NaN/inválido: bloqueado igual que sin entrada', () => {
  const quoteConfig = quoteConfigFor();
  for(const badRate of [null, 0, -100, NaN, 'texto']){
    const r = reconcileReservation({
      real: {chId:'airbnb', price:150, nights:3, days:20, currency:'COP', payoutReceived: 400000},
      quoteConfig, currency:'USD', fxRates: {COP: {rate: badRate, status:'verificado', source:'', date:''}}
    });
    assert.equal(r.currencyBlocked, true, `rate=${badRate} debe bloquear`);
  }
});

test('la reconciliación NUNCA cambia configuración financiera automáticamente — channels/discounts quedan bit-a-bit idénticos', () => {
  const quoteConfig = quoteConfigFor();
  const before = JSON.parse(JSON.stringify(quoteConfig.channels));
  const beforeDiscounts = JSON.parse(JSON.stringify(quoteConfig.discounts));
  reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: 50, otaCommissionPct: 99, bankFeePct: 99, cleaningFeeCharged: 999, nativeDiscountPct: 99},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.deepEqual(quoteConfig.channels, before);
  assert.deepEqual(quoteConfig.discounts, beforeDiscounts);
});

test('faltan datos esenciales (precio, noches o payout real): ok:false con motivo explícito, nunca calcula con un dato inventado', () => {
  const quoteConfig = quoteConfigFor();
  assert.equal(reconcileReservation({real:{chId:'airbnb', nights:3, days:20, payoutReceived:100}, quoteConfig, currency:'USD', fxRates:{}}).ok, false); // falta price
  assert.equal(reconcileReservation({real:{chId:'airbnb', price:150, days:20, payoutReceived:100}, quoteConfig, currency:'USD', fxRates:{}}).ok, false); // falta nights
  assert.equal(reconcileReservation({real:{chId:'airbnb', price:150, nights:3, days:20}, quoteConfig, currency:'USD', fxRates:{}}).ok, false); // falta payoutReceived
  assert.equal(reconcileReservation({real:{chId:'canal-inventado', price:150, nights:3, days:20, payoutReceived:100}, quoteConfig, currency:'USD', fxRates:{}}).ok, false); // canal desconocido
});

test('el estimado usa quoteScenario() REAL — no una fórmula paralela: coincide exacto con llamarlo directo', () => {
  const quoteConfig = quoteConfigFor();
  const directQuote = quoteScenario({chId:'booking', days:10, nights:5, price:200}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'booking', price:200, nights:5, days:10, currency:'USD', payoutReceived: directQuote.payout},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.estimate.payout, directQuote.payout);
  assert.equal(r.estimate.nativoPct, directQuote.nativoPct);
});

test('supuestos no verificados del estimado (LM sin verificar) se propagan como unverifiedAssumptions, sin reimplementar la regla de Fase 5', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig); // sin lmConfig -> ceiling_auto -> lmBlocked:true
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.estimate.lmBlocked, true);
  assert.ok(r.unverifiedAssumptions.some(a=>a.includes('Last-Minute')));
});
