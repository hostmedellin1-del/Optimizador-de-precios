import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDuplicateUnit, normalizeUnit} from '../src/domain/persistence.js';
import {compute} from '../src/domain/engine.js';
import {CHANNELS, defaultDiscounts, WINDOWS, defaultCostBreakdown, defaultLmConfig} from '../src/catalog/discounts.js';
import {VERIFICATION_KEYS, defaultVerification} from '../src/domain/verification.js';
import {EXAMPLE_COST_DEFAULTS} from '../src/domain/cost-mode.js';

function resolvedVerification(){
  const verification = defaultVerification();
  Object.entries(VERIFICATION_KEYS).forEach(([key, meta]) => {
    if(meta.scope === 'channel'){
      Object.values(verification[key]).forEach(entry => { entry.status = 'no_aplica'; entry.source = 'Cuenta real'; });
    } else {
      verification[key].status = 'no_aplica';
      verification[key].source = 'Cuenta real';
    }
  });
  return verification;
}

function configuredSource(){
  const discounts = defaultDiscounts().map((discount, index) => ({
    ...discount,
    on: index % 2 === 0,
    pct: (index % 19) + 1,
    verified: true
  }));
  const channels = CHANNELS.map((channel, index) => ({
    ...channel,
    comm: 11 + index,
    bankFeePct: index + 1,
    offsetPct: index - 2,
    settlementCurrency: index === 1 ? 'USD' : null,
    ...(channel.id === 'airbnb' ? {cleanFeeShort:31, cleanFeeLong:47} : {})
  }));
  const lmConfig = defaultLmConfig();
  Object.assign(lmConfig, {
    mode:'tiers', verified:true,
    flat:{pct:17, fromDay:1, toDay:4, on:true},
    gradual:{maxPct:24, days:6, on:true},
    fixedPrice:{price:143, fromDay:2, toDay:5, on:true},
    tiers:[{id:'tier-source', label:'Semana especial', fromDay:3, toDay:8, pct:13, on:true}]
  });
  return {
    id:'origin-id', name:'Unidad origen', currency:'USD', fixedCost:47, varCost:18,
    margin:37, marketWindow:12, marketBase:155, avgNights:4,
    channels, discounts,
    ceilings:Object.fromEntries(WINDOWS.map((window, index) => [window.id, index + 3])),
    lmConfig, verification:resolvedVerification(),
    costBreakdown:{...defaultCostBreakdown(), rent:950, admin:45, utilities:70, insurance:12, tech:8, cleaning:35, laundry:6, consumables:4, supplies:5},
    costBreakdownConfirmed:true,
    usdManualReviewPending:false,
    usdManualReviewLog:[]
  };
}

function expectedResetVerification(){
  return defaultVerification();
}

test('buildDuplicateUnit copia exactamente la configuración de 4 canales, 37 descuentos, techos y LM; nunca sus confirmaciones', () => {
  const origin = configuredSource();
  const result = buildDuplicateUnit(origin, 'Unidad clon');

  assert.equal(result.ok, true);
  const copy = result.state;
  assert.equal(copy.name, 'Unidad clon');
  assert.equal(copy.currency, origin.currency);
  assert.equal(copy.margin, origin.margin);
  assert.equal(copy.marketWindow, origin.marketWindow);
  assert.equal(copy.marketBase, origin.marketBase);
  assert.equal(copy.avgNights, origin.avgNights);
  assert.deepEqual(copy.channels, origin.channels, 'canales: comisión, banco, Offset, aseo y settlementCurrency se copian tal cual');
  assert.equal(copy.discounts.length, 37);
  assert.deepEqual(copy.discounts.map(({verified, ...discount}) => discount), origin.discounts.map(({verified, ...discount}) => discount), 'las 37 configuraciones de descuento se conservan exactamente');
  assert.deepEqual(copy.ceilings, origin.ceilings);
  assert.deepEqual({...copy.lmConfig, verified:undefined}, {...origin.lmConfig, verified:undefined});

  assert.equal(copy.id, undefined);
  assert.deepEqual(copy.verification, expectedResetVerification());
  assert.equal(copy.lmConfig.verified, false);
  assert.ok(copy.discounts.every(discount => discount.verified === false));
  assert.equal(copy.costBreakdownConfirmed, false);
  assert.deepEqual(copy.costBreakdown, defaultCostBreakdown());
  assert.equal(copy.fixedCost, EXAMPLE_COST_DEFAULTS.fixedCost);
  assert.equal(copy.varCost, EXAMPLE_COST_DEFAULTS.varCost);
  assert.equal(copy.usdManualReviewPending, false);
  assert.deepEqual(copy.usdManualReviewLog, []);
});

test('todos los estados de verificación, incluso verificado y no_aplica, vuelven individualmente a no_verificado', () => {
  const origin = configuredSource();
  origin.verification.hospyOffsetIsolated.status = 'verificado';
  origin.verification.bookingGeniusMobileBoth.status = 'no_aplica';
  origin.verification.bankFeePctByChannel.airbnb.status = 'verificado';
  origin.verification.bankFeePctByChannel.booking.status = 'no_aplica';
  const {state: copy} = buildDuplicateUnit(origin, 'Clon sin afirmaciones');

  Object.entries(VERIFICATION_KEYS).forEach(([key, meta]) => {
    if(meta.scope === 'channel'){
      Object.values(copy.verification[key]).forEach(entry => {
        assert.equal(entry.status, 'no_verificado', `${key} por canal no puede heredar ningún estado`);
      });
    } else {
      assert.equal(copy.verification[key].status, 'no_verificado', `${key} no puede heredar ningún estado`);
    }
  });
});

test('buildDuplicateUnit no muta profundamente el origen y devuelve arreglos/objetos independientes', () => {
  const origin = configuredSource();
  const before = structuredClone(origin);
  const {state: copy} = buildDuplicateUnit(origin, 'Clon independiente');
  copy.channels[0].comm = 99;
  copy.discounts[0].pct = 99;
  copy.lmConfig.tiers[0].pct = 99;
  copy.ceilings.w0 = 99;

  assert.deepEqual(origin, before);
  assert.equal(copy.id, undefined);
});

test('una copia USD pendiente de revisión manual no se puede duplicar de nuevo', () => {
  const origin = configuredSource();
  origin.usdManualReviewPending = true;
  const result = buildDuplicateUnit(origin, 'No debe crearse');
  assert.deepEqual(result, {ok:false, reason:'No se puede duplicar una copia USD que todavía está pendiente de revisión manual.'});
});

test('la copia pasa por normalizeUnit sin warnings y conserva todos los reseteos de seguridad', () => {
  const result = buildDuplicateUnit(configuredSource(), 'Clon normalizado');
  const {state, warnings} = normalizeUnit(result.state);

  assert.deepEqual(warnings, []);
  assert.equal(state.id, undefined);
  assert.equal(state.lmConfig.verified, false);
  assert.equal(state.costBreakdownConfirmed, false);
  assert.equal(state.fixedCost, EXAMPLE_COST_DEFAULTS.fixedCost);
  assert.equal(state.varCost, EXAMPLE_COST_DEFAULTS.varCost);
  assert.ok(state.discounts.every(discount => discount.verified === false));
  assert.deepEqual(state.verification, defaultVerification());
});

test('aunque la unidad origen está desbloqueada, el duplicado queda bloqueado para Min Price por confirmaciones reseteadas', () => {
  const origin = configuredSource();
  const originalModel = compute({...origin, windows:WINDOWS.map(window => ({...window}))});
  const {state: duplicate} = buildDuplicateUnit(origin, 'Clon bloqueado');
  const duplicateModel = compute({...duplicate, windows:WINDOWS.map(window => ({...window}))});

  assert.equal(originalModel.floorReadinessBlocked, false, 'el origen es una unidad completamente confirmada');
  assert.equal(duplicateModel.floorReadinessBlocked, true, 'el clon no puede producir una recomendación hasta confirmar sus propios datos');
});
