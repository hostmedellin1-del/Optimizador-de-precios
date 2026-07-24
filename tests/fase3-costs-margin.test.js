/* Fase 3 — costo real por reserva en quoteScenario()/compute(), y distincion
   margen (sobre venta) vs markup (sobre costo). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

test('quoteScenario con costBreakdown: una reserva de 1 noche carga la limpieza COMPLETA, no diluida', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  discounts.forEach(d=>{ d.on=false; }); // sin descuentos: aislar el efecto del costo
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:90, laundry:0, consumables:0, supplies:0};
  const config = {channels, discounts, windows, ceilings, costBreakdown};

  const q1 = quoteScenario({chId:'direct', days:45, nights:1, price:200}, config);
  assert.equal(q1.cost, 90, 'reserva de 1 noche: costo por noche debe ser la limpieza completa (90), no diluida por avgNights');

  const q30 = quoteScenario({chId:'direct', days:45, nights:30, price:200}, config);
  assert.equal(q30.cost, 3, 'reserva de 30 noches: la MISMA limpieza (90) diluida entre 30 noches reales de ESTA reserva da 3/noche — no un avgNights generico');
});

test('quoteScenario sin costBreakdown: cae al modelo simple fixedCost+varCost (compatibilidad)', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const config = {channels, discounts, windows, ceilings, fixedCost:32, varCost:22};
  const q = quoteScenario({chId:'direct', days:45, nights:1, price:200}, config);
  assert.equal(q.cost, 54, 'sin costBreakdown, el costo debe seguir siendo fixedCost+varCost (54), igual que antes de Fase 3');
  assert.ok(q.assumptions.some(a=>a.includes('sin calculadora detallada')), 'debe documentar explicitamente que esta usando el modelo simple, no el real por reserva');
});

test('compute().floor con costBreakdown protege contra el peor caso (reserva de 1 noche), no el promedio', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:90, laundry:0, consumables:0, supplies:0};
  const model = compute({channels, discounts, windows, margin:0, marketBase:0, costBreakdown});
  assert.equal(model.cost, 90, 'compute() con costBreakdown debe usar el costo de la reserva de 1 noche (90), el peor caso real por noche');
});

test('margen (sobre venta) vs markup (sobre costo) son numeros DISTINTOS, no intercambiables', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  discounts.forEach(d=>{ d.on=false; });
  const config = {channels, discounts, windows, ceilings, fixedCost:50, varCost:0};
  // precio tal que el neto (payout) sea 100 y el costo 50: margen=50% (50/100), markup=100% (50/50)
  const q = quoteScenario({chId:'direct', days:45, nights:1, price:100}, config); // direct: comm 3%, bank 6% => payoutFactor ~0.91
  const expectedMargin = (q.payout-50)/q.payout*100;
  const expectedMarkup = (q.payout-50)/50*100;
  assert.ok(Math.abs(q.marginPct-expectedMargin)<1e-9);
  assert.ok(Math.abs(q.markupPct-expectedMarkup)<1e-9);
  assert.notEqual(Math.round(q.marginPct), Math.round(q.markupPct), 'margen y markup deben diferir salvo casos degenerados — no son el mismo numero con otro nombre');
});
