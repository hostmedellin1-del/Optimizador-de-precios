/* Auditoria externa (ronda 5) — BLOQUEANTE 3: "recuperación segura de COP no
   es segura". Reproduce el bug real reportado: crear una copia USD de una
   unidad COP con costos simples 40/25 copia los NUMEROS sin convertir nada,
   pero antes de este fix, en cuanto se resolvían LM/verificaciones, la
   copia ya podía mostrar Piso/Base como si esos números fueran USD reales
   (el encargo reporta Piso USD 108,33 y Base USD 196,97 disponibles sin
   revisión manual real). `usdManualReviewPending` (src/domain/usd-only.js)
   es el gate que cierra ese hueco — bloquea aunque `unitCurrency` YA sea
   'USD', porque la moneda por sí sola no prueba que alguien revisó los
   números. Este archivo prueba el contrato completo contra compute()
   (engine.js), reconcileReservation() y computeMonthlyEconomics() — no solo
   contra evaluateUsdOnlyReadiness() en aislamiento (ver tests/usd-only.test.js
   para esas pruebas puras). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {reconcileReservation} from '../src/domain/reconciliation.js';
import {quoteScenario} from '../src/domain/quote.js';
import {computeMonthlyEconomics} from '../src/domain/monthly-economics.js';
import {buildAuditChecklist} from '../src/domain/audit.js';
import {defaultVerification} from '../src/domain/verification.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function verifiedLmConfig(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}
function resolveAll(verification){
  verification.hospyOffsetIsolated.status = 'no_aplica';
  verification.bookingGeniusMobileBoth.status = 'no_aplica';
  verification.expediaVipTierMix.status = 'no_aplica';
  verification.airbnbNonRefundable.status = 'no_aplica';
  Object.keys(verification.bankFeePctByChannel).forEach(id=>{ verification.bankFeePctByChannel[id].status = 'verificado'; });
  return verification;
}
/* Caso reproducido EXACTO del encargo: unidad COP con costos simples 40/25,
   convertida a copia USD sin tocar ningún número. */
function copyConfig(overrides={}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = overrides.windows || freshWindows();
  const ceilings = overrides.ceilings || defaultCeilings(windows);
  const verification = overrides.verification || resolveAll(defaultVerification());
  return {
    fixedCost:40, varCost:25, margin:45, marketBase:0, lmConfig: verifiedLmConfig(),
    currency:'USD', // la copia YA quedó marcada USD — ese es justamente el hueco
    ...overrides, channels, discounts, windows, ceilings, verification
  };
}

test('unidad COP original (sin usdManualReviewPending) sigue bloqueada por moneda, como siempre', () => {
  const model = compute(copyConfig({currency:'COP', usdManualReviewPending: undefined}));
  assert.equal(model.currencyBlocked, true);
  assert.match(model.currencyBlockedReason, /COP/);
});

test('BLOQUEANTE 3 (reproducción exacta): copia USD con usdManualReviewPending:true, LM y verificaciones RESUELTAS — Piso/Base/Offset/Matriz/Alertas SIGUEN bloqueados', () => {
  const model = compute(copyConfig({usdManualReviewPending: true}));
  assert.equal(model.currencyBlocked, true, 'ANTES del fix esto daba false — currency ya era "USD", nada distinguía la copia de una unidad real y verificada');
  assert.match(model.currencyBlockedReason, /pendiente de revisión manual/);
  assert.equal(model.floorReadinessBlocked, true, 'no debe aparecer un Piso disponible (el reportado: USD 108.33)');
  assert.equal(model.baseReadinessBlocked, true, 'no debe aparecer un Base disponible (el reportado: USD 196.97)');
});

test('usdManualReviewPending:false (revisión manual ya confirmada) + todo lo demás resuelto — Piso/Base SÍ quedan disponibles', () => {
  const model = compute(copyConfig({usdManualReviewPending: false}));
  assert.equal(model.currencyBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
  assert.equal(model.baseReadinessBlocked, false);
  assert.ok(model.floor > 0);
});

test('usdManualReviewPending ausente (undefined) — unidad USD normal preexistente, cero regresión', () => {
  const model = compute(copyConfig({usdManualReviewPending: undefined}));
  assert.equal(model.currencyBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
});

test('dos unidades simultáneas: una copia USD pendiente y una unidad USD normal — la pendiente no contamina a la normal', () => {
  const pending = compute(copyConfig({usdManualReviewPending: true}));
  const normal = compute(copyConfig({usdManualReviewPending: undefined}));
  assert.equal(pending.currencyBlocked, true);
  assert.equal(normal.currencyBlocked, false, 'la unidad normal no debe heredar el bloqueo de la copia — son configs independientes');
  assert.ok(normal.floor > 0);
});

/* ======================= reconciliation.js ======================= */

function quoteConfigFor(overrides={}){
  return {
    channels: freshChannels(), discounts: freshDiscounts().map(d=>({...d, on:false})),
    windows: freshWindows(), ceilings: defaultCeilings(),
    fixedCost:40, varCost:25, ...overrides
  };
}

test('BLOQUEANTE 3: reconcileReservation() bloquea con usdManualReviewPending:true aunque currency ya sea USD', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', usdManualReviewPending: true
  });
  assert.equal(r.ok, true);
  assert.equal(r.currencyBlocked, true);
  assert.match(r.currencyBlockedReason, /revisión manual/);
  assert.equal(r.diff, null, 'no debe calcular ninguna diferencia mientras la revisión siga pendiente');
});

test('reconcileReservation() con usdManualReviewPending:false conciliaciones funcionan con normalidad', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', usdManualReviewPending: false
  });
  assert.equal(r.currencyBlocked, false);
  assert.equal(r.diff.absolute, 0);
});

/* ======================= monthly-economics.js ======================= */

test('BLOQUEANTE 3: computeMonthlyEconomics() bloquea con usdManualReviewPending:true aunque currency ya sea USD', () => {
  const quoteConfig = quoteConfigFor();
  const res = computeMonthlyEconomics({
    costBreakdown: {rent:500, admin:100, utilities:50, insurance:30, tech:20, occNights:22, cleaning:40, laundry:10, consumables:5, supplies:5},
    avgNights: 3,
    incomeScenario: {type:'manual', manualNetPerNight:100, mix:[]},
    quoteConfig, currency:'USD', usdManualReviewPending: true
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /revisión manual/);
});

test('computeMonthlyEconomics() con usdManualReviewPending:false calcula con normalidad', () => {
  const quoteConfig = quoteConfigFor();
  const res = computeMonthlyEconomics({
    costBreakdown: {rent:500, admin:100, utilities:50, insurance:30, tech:20, occNights:22, cleaning:40, laundry:10, consumables:5, supplies:5},
    avgNights: 3,
    incomeScenario: {type:'manual', manualNetPerNight:100, mix:[]},
    quoteConfig, currency:'USD', usdManualReviewPending: false
  });
  assert.equal(res.ok, true);
});

/* ======================= audit.js ======================= */

test('BLOQUEANTE 3: buildAuditChecklist() nunca marca "listo_supervisado" mientras usdManualReviewPending sea true', () => {
  const channels = freshChannels();
  const verification = resolveAll(defaultVerification());
  const audit = buildAuditChecklist({
    usingExampleCosts: false, readiness: null, lmBlocked: false,
    channels, currency:'USD', usdManualReviewPending: true, lastReconciliation: null
  });
  const currencyItem = audit.items.find(i=>i.key==='currency');
  assert.equal(currencyItem.ok, false);
  assert.match(currencyItem.detail, /revisión manual/);
  assert.notEqual(audit.status, 'listo_supervisado');
});

test('buildAuditChecklist() con usdManualReviewPending:false — el item de moneda pasa (si el resto también aplica)', () => {
  const channels = freshChannels();
  const audit = buildAuditChecklist({
    usingExampleCosts: false, readiness: null, lmBlocked: false,
    channels, currency:'USD', usdManualReviewPending: false, lastReconciliation: null
  });
  const currencyItem = audit.items.find(i=>i.key==='currency');
  assert.equal(currencyItem.ok, true);
});

/* ======================= BLOQUEANTE (ronda 6) — bypass por importación ===
   Reproduce el hallazgo exacto: JSON con usdManualReviewPending:false pero
   usdManualReviewLog con un copy_created SIN review_confirmed posterior —
   a nivel de DOMINIO (sin pasar por persistence.js/normalizeUnit()), para
   confirmar que compute()/reconcileReservation()/computeMonthlyEconomics()/
   buildAuditChecklist() NUNCA confían en el booleano crudo por su cuenta —
   la defensa vive en evaluateUsdOnlyReadiness() (via
   evaluateUsdManualReviewState()), no solo en la capa de persistencia. */

const bypassLog = [{at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'}];

test('BYPASS: compute() con usdManualReviewPending:false + log copy_created sin confirmar — currencyBlocked SIGUE true, Piso/Base SIGUEN bloqueados', () => {
  const model = compute(copyConfig({usdManualReviewPending: false, usdManualReviewLog: bypassLog}));
  assert.equal(model.currencyBlocked, true, 'ANTES del fix esto daba false — el booleano crudo bastaba para desbloquear');
  assert.match(model.currencyBlockedReason, /revisión manual/);
  assert.equal(model.floorReadinessBlocked, true);
  assert.equal(model.baseReadinessBlocked, true);
});

test('compute() con log copy_created + review_confirmed VÁLIDO posterior y usdManualReviewPending:false — SÍ desbloquea (si el resto también está resuelto)', () => {
  const validLog = [
    {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'},
    {at:'2026-07-24T11:00:00.000Z', event:'review_confirmed', text:'Revisé manualmente todos los valores...'}
  ];
  const model = compute(copyConfig({usdManualReviewPending: false, usdManualReviewLog: validLog}));
  assert.equal(model.currencyBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
  assert.ok(model.floor > 0);
});

test('BYPASS: reconcileReservation() con usdManualReviewPending:false + log sin confirmar — sigue bloqueada', () => {
  const quoteConfig = quoteConfigFor();
  const est = quoteScenario({chId:'airbnb', days:20, nights:3, price:150}, quoteConfig);
  const r = reconcileReservation({
    real: {chId:'airbnb', price:150, nights:3, days:20, currency:'USD', payoutReceived: est.payout},
    quoteConfig, currency:'USD', usdManualReviewPending: false, usdManualReviewLog: bypassLog
  });
  assert.equal(r.currencyBlocked, true);
  assert.equal(r.diff, null);
});

test('BYPASS: computeMonthlyEconomics() con usdManualReviewPending:false + log sin confirmar — sigue bloqueada', () => {
  const quoteConfig = quoteConfigFor();
  const res = computeMonthlyEconomics({
    costBreakdown: {rent:500, admin:100, utilities:50, insurance:30, tech:20, occNights:22, cleaning:40, laundry:10, consumables:5, supplies:5},
    avgNights: 3,
    incomeScenario: {type:'manual', manualNetPerNight:100, mix:[]},
    quoteConfig, currency:'USD', usdManualReviewPending: false, usdManualReviewLog: bypassLog
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /revisión manual/);
});

test('BYPASS: buildAuditChecklist() con usdManualReviewPending:false + log sin confirmar — item de moneda sigue fallando, nunca "listo_supervisado"', () => {
  const channels = freshChannels();
  const audit = buildAuditChecklist({
    usingExampleCosts: false, readiness: null, lmBlocked: false,
    channels, currency:'USD', usdManualReviewPending: false, usdManualReviewLog: bypassLog, lastReconciliation: null
  });
  const currencyItem = audit.items.find(i=>i.key==='currency');
  assert.equal(currencyItem.ok, false);
  assert.notEqual(audit.status, 'listo_supervisado');
});

test('unidad USD normal (sin log, sin usdManualReviewPending) sigue funcionando exactamente igual — cero regresión del cruce nuevo', () => {
  const model = compute(copyConfig({usdManualReviewPending: undefined, usdManualReviewLog: undefined}));
  assert.equal(model.currencyBlocked, false);
  assert.ok(model.floor > 0);
});
