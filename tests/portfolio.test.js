/* Fase 2 de usabilidad (ago 2026) — vista de portafolio (src/domain/portfolio.js).

   Dani pidio explicitamente "una lista de todas [sus unidades]" — hoy la app
   trabaja de a una a la vez y el opera ~36. Estos tests prueban la logica
   PURA que arma cada fila, sin DOM ni storage — index.html solo la llama con
   las unidades ya normalizadas y renderiza lo que devuelve. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPortfolioRow, buildPortfolioRows, portfolioStatus} from '../src/domain/portfolio.js';
import {EXAMPLE_COST_DEFAULTS} from '../src/domain/cost-mode.js';
import {freshChannels, freshDiscounts, defaultCeilings, freshCostBreakdown} from './helpers/state-factory.js';

function verifiedFlatLm(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}
function unverifiedAutoLm(){
  return {mode:'ceiling_auto', verified:false, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}
function unitState(overrides={}){
  return {
    id: overrides.id || 'unit-id',
    name: overrides.name || 'Unidad de prueba',
    currency: 'USD',
    fixedCost: 40, varCost: 20, margin: 45, marketBase: 0, avgNights: 3,
    channels: freshChannels(), discounts: freshDiscounts(),
    ceilings: defaultCeilings(),
    costBreakdown: freshCostBreakdown(), costBreakdownConfirmed: false,
    lmConfig: verifiedFlatLm(),
    usdManualReviewPending: false, usdManualReviewLog: [],
    pricelabsSync: null,
    ...overrides
  };
}

test('unidad lista (costos reales + LM verificado) -> chip "lista", Piso numerico', () => {
  const row = buildPortfolioRow(unitState({name:'902'}));
  assert.equal(row.status, 'lista');
  assert.equal(typeof row.floor, 'number');
  assert.ok(row.floor > 0);
  assert.equal(row.floorBlockedReason, null);
});

test('unidad sin costos confirmados (ejemplo de fabrica 32/22 sin tocar) -> chip "faltan_costos", Piso null', () => {
  const row = buildPortfolioRow(unitState({
    name:'Sin costos', fixedCost: EXAMPLE_COST_DEFAULTS.fixedCost, varCost: EXAMPLE_COST_DEFAULTS.varCost
  }));
  assert.equal(row.status, 'faltan_costos');
  assert.equal(row.floor, null);
  assert.ok(row.floorBlockedReason);
});

test('unidad sin Last-Minute verificado (costos reales, LM automatico sin confirmar) -> chip "falta_lm", Piso null', () => {
  const row = buildPortfolioRow(unitState({name:'Sin LM', lmConfig: unverifiedAutoLm()}));
  assert.equal(row.status, 'falta_lm');
  assert.equal(row.floor, null);
});

test('tres unidades con estados distintos producen los tres chips correctos', () => {
  const rows = buildPortfolioRows([
    unitState({name:'Lista'}),
    unitState({name:'Sin costos', fixedCost: EXAMPLE_COST_DEFAULTS.fixedCost, varCost: EXAMPLE_COST_DEFAULTS.varCost}),
    unitState({name:'Sin LM', lmConfig: unverifiedAutoLm()})
  ]);
  assert.deepEqual(rows.map(r=>r.status), ['lista', 'faltan_costos', 'falta_lm']);
});

test('unidad con snapshot de PriceLabs cuyo Min esta POR DEBAJO del Piso queda marcada', () => {
  const base = unitState({name:'902'});
  const withoutSync = buildPortfolioRow(base);
  assert.ok(withoutSync.floor > 1); // confirma que el piso real no es minusculo, para que min:1 quede debajo con margen
  const row = buildPortfolioRow(unitState({
    name:'902',
    pricelabsSync: {min: 1, base: 50, recommendedBasePrice: 50, fetchedAt: new Date().toISOString()}
  }));
  assert.ok(row.pricelabsSync);
  assert.equal(row.pricelabsSync.minBelowFloor, true);
});

test('unidad con snapshot de PriceLabs cuyo Min CUBRE el Piso no queda marcada', () => {
  const row = buildPortfolioRow(unitState({
    name:'902',
    pricelabsSync: {min: 1e6, base: 1e6, recommendedBasePrice: 1e6, fetchedAt: new Date().toISOString()}
  }));
  assert.ok(row.pricelabsSync);
  assert.equal(row.pricelabsSync.minBelowFloor, false);
});

test('unidad SIN snapshot no rompe ni inventa la comparacion', () => {
  const row = buildPortfolioRow(unitState({name:'Sin snapshot', pricelabsSync: null}));
  assert.equal(row.pricelabsSync, null);
});

test('lista vacia devuelve un resultado vacio manejable, sin excepcion', () => {
  assert.deepEqual(buildPortfolioRows([]), []);
  assert.deepEqual(buildPortfolioRows(undefined), []);
  assert.deepEqual(buildPortfolioRows(null), []);
});

test('portfolioStatus(): un bloqueo de moneda (caso raro) cae en "faltan_costos", nunca en "lista"', () => {
  // No hace falta reconstruir el gate completo de moneda: alcanza con un
  // model minimo que reproduzca el contrato real de compute() para este caso.
  const status = portfolioStatus({costBlocked:false, lmBlocked:false, floorReadinessBlocked:true, currencyBlocked:true});
  assert.equal(status, 'faltan_costos');
});
