/* computeConfigForState() (src/domain/compute-config.js) — fuente UNICA del
   objeto de config que se le pasa a compute(). Antes index.html y
   src/domain/portfolio.js armaban cada uno su propia copia campo por campo;
   este test verifica que la funcion extraida trae todos los campos
   esperados y que el portafolio y compute() directo NUNCA pueden divergir,
   porque los dos pasan por la misma funcion. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeConfigForState} from '../src/domain/compute-config.js';
import {compute} from '../src/domain/engine.js';
import {buildPortfolioRow} from '../src/domain/portfolio.js';
import {EXAMPLE_COST_DEFAULTS} from '../src/domain/cost-mode.js';
import {freshChannels, freshDiscounts, defaultCeilings, freshCostBreakdown} from './helpers/state-factory.js';

function verifiedFlatLm(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
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

test('computeConfigForState() incluye todos los campos que compute() necesita', () => {
  const cfg = computeConfigForState(unitState());
  for(const field of ['fixedCost','varCost','margin','marketBase','channels','discounts','windows','ceilings','lmConfig','costBreakdown','costBreakdownConfirmed','usingExampleCosts','currency','usdManualReviewPending','usdManualReviewLog']){
    assert.ok(field in cfg, `falta el campo ${field}`);
  }
  assert.ok(Array.isArray(cfg.windows) && cfg.windows.length > 0);
});

test('usingExampleCosts refleja el gate real: true con 32/22 sin tocar, false con costos reales', () => {
  const example = computeConfigForState(unitState({fixedCost: EXAMPLE_COST_DEFAULTS.fixedCost, varCost: EXAMPLE_COST_DEFAULTS.varCost}));
  assert.equal(example.usingExampleCosts, true);

  const real = computeConfigForState(unitState({fixedCost: 40, varCost: 20}));
  assert.equal(real.usingExampleCosts, false);
});

test('buildPortfolioRow(state).floor == compute(computeConfigForState(state)).floor para una unidad lista — portafolio y calculo principal no pueden divergir', () => {
  const state = unitState({name:'902'});
  const row = buildPortfolioRow(state);
  const direct = compute(computeConfigForState(state));
  assert.equal(row.floor, direct.floor);
  assert.ok(typeof direct.floor === 'number' && direct.floor > 0);
});
