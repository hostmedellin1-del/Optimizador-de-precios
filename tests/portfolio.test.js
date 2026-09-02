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

test('portfolioStatus(): un bloqueo de moneda tiene su propio chip "revisar_moneda", nunca cae en "faltan_costos" ni en "lista"', () => {
  // No hace falta reconstruir el gate completo de moneda: alcanza con un
  // model minimo que reproduzca el contrato real de compute() para este caso.
  const status = portfolioStatus({costBlocked:false, lmBlocked:false, floorReadinessBlocked:true, currencyBlocked:true});
  assert.equal(status, 'revisar_moneda');
});

test('portfolioStatus(): moneda tiene prioridad sobre costos y Last-Minute cuando los tres coinciden', () => {
  const status = portfolioStatus({costBlocked:true, lmBlocked:true, floorReadinessBlocked:true, currencyBlocked:true});
  assert.equal(status, 'revisar_moneda');
});

test('unidad realmente bloqueada por moneda (currency:"COP") -> chip Y motivo CONCUERDAN', () => {
  // Este es el punto del arreglo: antes el chip decia "Falta Last-Minute"
  // (lmBlocked es true por defecto en unitState()) mientras que el motivo de
  // la MISMA fila decia "requiere revision manual (moneda)" — dos criterios
  // paralelos contradiciendose. Ahora los dos deben salir de la misma tabla.
  const row = buildPortfolioRow(unitState({name:'Copia COP sin revisar', currency:'COP'}));
  assert.equal(row.status, 'revisar_moneda');
  assert.equal(row.floorBlockedReason, 'requiere revisión manual (moneda)');
  assert.equal(row.floor, null);
});

/* Residuo del mismo bug (BLOQUEANTE arriba), cerrado con una cuarta entrada
   en la tabla BLOCKS de portfolio.js: floorReadinessBlocked tambien puede
   quedar en true por un canal con datos financieros sin confirmar
   (unreadyChannels no vacio en src/domain/readiness.js) SIN que
   currencyBlocked/costBlocked/lmBlocked sean true — ej. costos confirmados,
   LM verificado, moneda USD, pero igual falta algo de un canal. Antes ese
   caso caia al mismo fallback que "sin bloqueo real" (chip 'faltan_costos',
   motivo 'sin resolver') — el chip mentia (los costos SI estan bien).

   Nota tecnica sobre el test que sigue: hoy `evaluateRecommendationReadiness()`
   (src/domain/readiness.js) marca TODOS los canales como listos siempre —
   es codigo de compatibilidad estructural de una fase de verificacion por
   canal que ya se retiro (ver CLAUDE.md, "Simplificacion jul 2026") — y
   ademas `config.verification` nunca se puebla desde ningun caller real
   (compute-config.js/index.html/portfolio.js). Confirmado con Node: pasarle
   `verification` a compute() no cambia nada, `unreadyChannels` siempre sale
   vacio. Por eso HOY no existe ningun `state` real que, pasando por
   buildPortfolioRow() -> compute(), produzca floorReadinessBlocked:true con
   los otros tres flags en false — ese branch de compute()/readiness.js esta
   momentaneamente inactivo (no es un bug de portfolio.js, es una fase que
   engine.js todavia no reactivo). El arreglo de portfolio.js es correcto y
   defensivo igual: si ese gate se reactiva mas adelante, el chip nuevo ya
   esta listo y sale de la misma tabla que el resto, no de un fallback
   aparte. Se prueba con un model sintetico (mismo patron ya usado arriba
   para moneda) — permitido explicitamente para este caso. */
test('portfolioStatus(): floorReadinessBlocked SIN costos/LM/moneda bloqueados tiene su propio chip "faltan_datos"', () => {
  const model = {costBlocked:false, lmBlocked:false, currencyBlocked:false, floorReadinessBlocked:true};
  assert.equal(portfolioStatus(model), 'faltan_datos');
});

test('portfolioStatus(): faltan_datos es el ultimo en prioridad — moneda/costos/LM ganan si tambien aplican', () => {
  assert.equal(portfolioStatus({currencyBlocked:true, costBlocked:false, lmBlocked:false, floorReadinessBlocked:true}), 'revisar_moneda');
  assert.equal(portfolioStatus({currencyBlocked:false, costBlocked:true, lmBlocked:false, floorReadinessBlocked:true}), 'faltan_costos');
  assert.equal(portfolioStatus({currencyBlocked:false, costBlocked:false, lmBlocked:true, floorReadinessBlocked:true}), 'falta_lm');
});

test('los cuatro casos anteriores (lista/faltan_costos/falta_lm/revisar_moneda) no cambiaron con la cuarta entrada de BLOCKS', () => {
  assert.equal(portfolioStatus({costBlocked:false, lmBlocked:false, currencyBlocked:false, floorReadinessBlocked:false}), 'lista');
  assert.equal(portfolioStatus({costBlocked:true, lmBlocked:false, currencyBlocked:false, floorReadinessBlocked:true}), 'faltan_costos');
  assert.equal(portfolioStatus({costBlocked:false, lmBlocked:true, currencyBlocked:false, floorReadinessBlocked:true}), 'falta_lm');
  assert.equal(portfolioStatus({costBlocked:false, lmBlocked:false, currencyBlocked:true, floorReadinessBlocked:true}), 'revisar_moneda');
});
