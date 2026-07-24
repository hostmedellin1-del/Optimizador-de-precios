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

/* Correcciones adicionales (auditoria externa, ronda 4): `quoteConfigFor()`
   no pasa `lmConfig` — quoteScenario() cae a 'ceiling_auto' sin verificar
   (ver pricelabs-lm.js), asi que CUALQUIER estimado armado con este helper
   depende de un supuesto sin confirmar (`estimate.lmBlocked===true`). Antes
   del fix, `reliable` era `true` aqui solo porque el numero coincidia — el
   bug exacto que este round corrige: coincidir en el numero NO es lo mismo
   que un estimado con el modelo verificado. Ahora `numericMatch` (el hecho
   puramente numerico) sigue siendo `true`, pero `modelVerified`/`reliable`
   son `false` hasta que el LM este verificado. Ver el test de
   "CONCILIACIÓN CONFIABLE" mas abajo para el camino contrario. */
test('reserva real IGUAL al estimado: numericMatch true (severidad "ok"), pero modelVerified/reliable false por LM sin verificar', () => {
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
  assert.equal(r.numericMatch, true, 'coincide numericamente');
  assert.equal(r.modelVerified, false, 'el estimado depende de LM sin verificar');
  assert.equal(r.reliable, false, 'coincidir en el numero NO basta si el modelo detras no esta verificado');
  assert.deepEqual(r.breakdown, []);
  assert.deepEqual(r.causes, []);
});

/* Correcciones adicionales (auditoria externa, ronda 4): con un LM VERIFICADO
   (y sin ningun dato de negocio pendiente, catalogo de fabrica normal — sin
   Genius+Mobile/VIP/Offset/no-reembolsable activos aqui), el mismo escenario
   IGUAL al estimado SI puede llegar a "reliable: true" — numericMatch Y
   modelVerified ambos true. */
test('reserva real IGUAL al estimado, CON LM verificado: numericMatch Y modelVerified true => reliable true ("CONCILIACIÓN CONFIABLE")', () => {
  const verifiedLm = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const quoteConfig = quoteConfigFor({lmConfig: verifiedLm});
  const est = quoteScenario({chId:'direct', days:20, nights:3, price:150}, quoteConfig);
  assert.equal(est.lmBlocked, false, 'precondicion: LM verificado, no bloqueado');
  const r = reconcileReservation({
    real: {chId:'direct', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.numericMatch, true);
  assert.equal(r.modelVerified, true);
  assert.equal(r.reliable, true);
  assert.deepEqual(r.unverifiedAssumptions, []);
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

test('diferencia pequeña (<=3%): severidad "ok" y numericMatch true pese a no ser exactamente igual — ruido normal; reliable sigue dependiendo de modelVerified (LM sin verificar aquí)', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'direct', days:20, nights:3, price:150}, quoteConfig);
  const real = est.payout*1.02; // 2% mas, dentro del umbral
  const r = reconcileReservation({
    real: {chId:'direct', price:150, nights:3, days:20, currency:'USD', payoutReceived: real},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.severity, 'ok');
  assert.equal(r.numericMatch, true);
  assert.equal(r.modelVerified, false, 'quoteConfigFor() no verifica LM — el estimado sigue dependiendo de un supuesto sin confirmar');
  assert.equal(r.reliable, false, 'numericMatch solo no basta para "reliable"');
});

/* Simplificacion a USD unico (revision externa): esta version NUNCA convierte
   — cualquier moneda distinta de 'USD' en el payout real bloquea la
   conciliacion explicitamente, sin calcular diferencia ni severidad. Nunca
   asume 1:1, nunca llama a currency.js/resolveConversion(). */
test('payout real marcado en COP: bloqueado explícitamente, sin diff/severidad — nunca se convierte ni se asume 1:1', () => {
  const quoteConfig = quoteConfigFor();
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'COP', payoutReceived: 400000},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, true);
  assert.match(r.currencyBlockedReason, /COP/);
  assert.match(r.currencyBlockedReason, /solo admite USD/);
  assert.equal(r.diff, null);
  assert.equal(r.severity, null);
  assert.equal(r.reliable, false);
});

test('payout real marcado en EUR (moneda nunca soportada por esta app): bloqueado igual que COP', () => {
  const quoteConfig = quoteConfigFor();
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'EUR', payoutReceived: 130},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.currencyBlocked, true);
  assert.match(r.currencyBlockedReason, /EUR/);
});

test('moneda del payout real vacía/ausente: se asume USD (el formulario ya no ofrece otra moneda), calcula normalmente', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  for(const emptyCurrency of [undefined, null, '']){
    const r = reconcileReservation({
      real: {chId:'airbnb', price:150, nights:3, days:20, currency: emptyCurrency, payoutReceived: est.payout},
      quoteConfig, currency:'USD'
    });
    assert.equal(r.currencyBlocked, false, `currency=${JSON.stringify(emptyCurrency)} debe asumirse USD, no bloquear`);
    assert.equal(r.diff.absolute, 0);
  }
});

test('la UNIDAD misma está marcada "requiere revisión manual" (moneda guardada != USD): bloquea TODO, ni siquiera cotiza el estimado', () => {
  const quoteConfig = quoteConfigFor();
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: 100},
    quoteConfig, currency:'COP' // la unidad misma quedó guardada en COP
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, true);
  assert.match(r.currencyBlockedReason, /requiere revisión manual/);
  assert.match(r.currencyBlockedReason, /COP/);
  assert.equal(r.estimate, null, 'ni siquiera se cotiza un estimado — la moneda de la unidad no es confiable');
});

test('quoteScenario() usado internamente por el estimado siempre declara currency:\'USD\' explícito', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  assert.equal(est.currency, 'USD');
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
