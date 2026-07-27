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
   (engine.js) y evaluateUsdOnlyReadiness() directamente — no solo
   contra la normalización de persistencia. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {evaluateUsdOnlyReadiness} from '../src/domain/usd-only.js';
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

test('BLOQUEANTE 3: evaluateUsdOnlyReadiness bloquea con usdManualReviewPending:true aunque currency ya sea USD', () => {
  const gate = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels:freshChannels(), usdManualReviewPending:true});
  assert.equal(gate.blocked, true);
  assert.match(gate.reason, /revisión manual/);
});

test('evaluateUsdOnlyReadiness con usdManualReviewPending:false permite una unidad USD limpia', () => {
  const gate = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels:freshChannels(), usdManualReviewPending:false});
  assert.equal(gate.blocked, false);
});

/* ======================= BLOQUEANTE (ronda 6) — bypass por importación ===
   Reproduce el hallazgo exacto: JSON con usdManualReviewPending:false pero
   usdManualReviewLog con un copy_created SIN review_confirmed posterior —
   a nivel de DOMINIO (sin pasar por persistence.js/normalizeUnit()), para
   confirmar que compute()/evaluateUsdOnlyReadiness() NUNCA confían en el booleano crudo por su cuenta —
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

test('BYPASS: evaluateUsdOnlyReadiness con booleano falso y log sin confirmar sigue bloqueada', () => {
  const gate = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels:freshChannels(), usdManualReviewPending:false, usdManualReviewLog:bypassLog});
  assert.equal(gate.blocked, true);
  assert.match(gate.reason, /revisión manual/);
});

test('unidad USD normal (sin log, sin usdManualReviewPending) sigue funcionando exactamente igual — cero regresión del cruce nuevo', () => {
  const model = compute(copyConfig({usdManualReviewPending: undefined, usdManualReviewLog: undefined}));
  assert.equal(model.currencyBlocked, false);
  assert.ok(model.floor > 0);
});
