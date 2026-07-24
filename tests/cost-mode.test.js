/* evaluateCostReadiness()/costBreakdownIsFilled() (src/domain/cost-mode.js)
   — auditoria externa, ronda 4, BLOQUEANTE 2: reproduce explicitamente el
   hallazgo confirmado ("costos simples 32/22 dan costo 54 y Piso 90; agregar
   solo consumables:5 no puede bajar el Piso a 8.33") a nivel del contrato de
   costos puro, sin pasar por engine.js — ver tests/fase-cost-blocker.test.js
   para la reproducción completa contra compute(). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCostReadiness, costBreakdownIsFilled, EXAMPLE_COST_DEFAULTS} from '../src/domain/cost-mode.js';

function cb(overrides={}){
  return {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:0, laundry:0, consumables:0, supplies:0, ...overrides};
}

test('costBreakdownIsFilled: todo en 0 (default de fábrica) -> false', () => {
  assert.equal(costBreakdownIsFilled(cb()), false);
});

test('costBreakdownIsFilled: UN solo campo > 0 (ej. consumables) -> true (esto es "tocado", no "usable")', () => {
  assert.equal(costBreakdownIsFilled(cb({consumables:5})), true);
});

test('desglose nunca tocado, sin usingExampleCosts: modo "simple", no bloqueado', () => {
  const r = evaluateCostReadiness({costBreakdown: cb(), costBreakdownConfirmed: false, usingExampleCosts: false});
  assert.equal(r.mode, 'simple');
  assert.equal(r.blocked, false);
  assert.equal(r.useDetailed, false);
});

test('desglose nunca tocado, CON usingExampleCosts:true (costos de fábrica, sin tocar): modo "simple_example", BLOQUEADO', () => {
  const r = evaluateCostReadiness({costBreakdown: cb(), costBreakdownConfirmed: false, usingExampleCosts: true});
  assert.equal(r.mode, 'simple_example');
  assert.equal(r.blocked, true);
  assert.equal(r.useDetailed, false);
  assert.match(r.reason, new RegExp(EXAMPLE_COST_DEFAULTS.fixedCost));
  assert.match(r.reason, new RegExp(EXAMPLE_COST_DEFAULTS.varCost));
});

/* BLOQUEANTE 2 — el hallazgo exacto: un campo suelto (consumables:5) sin
   confirmar NUNCA puede alimentar una recomendación. */
test('BLOQUEANTE 2: desglose PARCIAL (solo consumables:5) SIN confirmar -> "detailed_incomplete", BLOQUEADO, useDetailed:false', () => {
  const r = evaluateCostReadiness({costBreakdown: cb({consumables:5}), costBreakdownConfirmed: false, usingExampleCosts: false});
  assert.equal(r.mode, 'detailed_incomplete');
  assert.equal(r.blocked, true);
  assert.equal(r.useDetailed, false, 'el desglose parcial NUNCA debe usarse para calcular el costo real');
  assert.ok(r.reason && r.reason.length>0);
});

test('desglose completo pero SIN confirmar: sigue "detailed_incomplete" (llenar todos los campos no basta, hace falta la confirmación explícita)', () => {
  const r = evaluateCostReadiness({
    costBreakdown: cb({rent:500, admin:100, utilities:50, insurance:30, tech:20, cleaning:40, laundry:10, supplies:5, consumables:5}),
    costBreakdownConfirmed: false, usingExampleCosts: false
  });
  assert.equal(r.mode, 'detailed_incomplete');
  assert.equal(r.blocked, true);
  assert.equal(r.useDetailed, false);
});

test('desglose tocado Y confirmado explícitamente (costBreakdownConfirmed:true): "detailed_confirmed", usable', () => {
  const r = evaluateCostReadiness({costBreakdown: cb({consumables:5}), costBreakdownConfirmed: true, usingExampleCosts: false});
  assert.equal(r.mode, 'detailed_confirmed');
  assert.equal(r.blocked, false);
  assert.equal(r.useDetailed, true);
  assert.equal(r.reason, null);
});

test('cero legítimo CONFIRMADO: desglose totalmente en 0 pero costBreakdownConfirmed:true explícito -> "detailed_confirmed", usable (la confirmación explícita manda sobre la heurística de "tocado")', () => {
  const r = evaluateCostReadiness({costBreakdown: cb(), costBreakdownConfirmed: true, usingExampleCosts: false});
  assert.equal(r.mode, 'detailed_confirmed');
  assert.equal(r.blocked, false);
  assert.equal(r.useDetailed, true);
});

test('costBreakdownConfirmed AUSENTE (undefined, callers de test que no participan del contrato): con un desglose presente, se trata como usable — regresión cero para tests/quoteScenario existentes', () => {
  const r = evaluateCostReadiness({costBreakdown: cb({consumables:5})});
  assert.equal(r.mode, 'detailed_confirmed');
  assert.equal(r.blocked, false);
  assert.equal(r.useDetailed, true);
});

test('usingExampleCosts AUSENTE (undefined): nunca bloquea por sí solo, aunque el desglose esté vacío', () => {
  const r = evaluateCostReadiness({costBreakdown: cb()});
  assert.equal(r.blocked, false);
  assert.equal(r.mode, 'simple');
});

test('config completamente vacío/ausente: modo "simple", no bloqueado, no rompe', () => {
  const r = evaluateCostReadiness();
  assert.equal(r.mode, 'simple');
  assert.equal(r.blocked, false);
});
