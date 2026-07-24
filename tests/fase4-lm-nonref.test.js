/* Fase 4 — PriceLabs Last-Minute configurable (5 modos) + descuento Airbnb no
   reembolsable (capa post-promo). Ninguno de estos tests asume un % real de
   negocio: todos los valores de ejemplo son arbitrarios para probar la mecanica,
   no numeros de la cuenta real de Dani. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combineChannel} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {priceLabsLm, gradualCurve, lmCriticalDays} from '../src/domain/pricelabs-lm.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

function baseQuoteConfig(overrides={}){
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  discounts.forEach(d=>{ d.on=false; }); // aislar: sin descuentos nativos de por medio
  return {channels, discounts, windows, ceilings, fixedCost:0, varCost:0, ...overrides};
}

test('LM modo 1 (ceiling_auto) — sin lmConfig, comportamiento identico al de siempre (regresion cero)', () => {
  const config = baseQuoteConfig();
  const withConfig = {...config, lmConfig: defaultLmConfig()};
  const q1 = quoteScenario({chId:'direct', days:2, nights:1, price:100}, config);
  const q2 = quoteScenario({chId:'direct', days:2, nights:1, price:100}, withConfig);
  assert.equal(q1.lm, q2.lm, 'lmConfig por defecto (ceiling_auto) debe dar exactamente el mismo LM que sin lmConfig');
  assert.ok(q2.assumptions.some(a=>a.includes('no verificable matematicamente')), 'modo automatico debe advertir que no es verificable matematicamente sin precio diario real');
});

test('LM modo 2 (flat) — % fijo solo dentro del rango de dias configurado', () => {
  const lmConfig = {...defaultLmConfig(), mode:'flat', flat:{pct:12, fromDay:0, toDay:3, on:true}};
  assert.equal(priceLabsLm(lmConfig, {day:0}).lmPct, 12);
  assert.equal(priceLabsLm(lmConfig, {day:3}).lmPct, 12);
  assert.equal(priceLabsLm(lmConfig, {day:4}).lmPct, 0, 'fuera del rango, el flat no debe aplicar');
});

test('LM modo 3 (gradual) — calcula el % real de CADA dia, no aplica el maximo plano a todos', () => {
  const lmConfig = {...defaultLmConfig(), mode:'gradual', gradual:{maxPct:20, days:4, on:true}};
  assert.equal(priceLabsLm(lmConfig, {day:0}).lmPct, 20, 'dia 0 debe dar el maximo completo');
  assert.equal(priceLabsLm(lmConfig, {day:2}).lmPct, 10, 'dia intermedio (2 de 4) debe dar la mitad, no el maximo plano');
  assert.equal(priceLabsLm(lmConfig, {day:4}).lmPct, 0, 'en el limite (days) ya debe ser 0');
  const curve = gradualCurve(lmConfig.gradual);
  assert.equal(curve.length, 5, 'la curva dia-a-dia debe cubrir dias 0..4 (5 puntos)');
  assert.deepEqual(curve.map(p=>p.pct), [20,15,10,5,0], 'la curva debe decaer linealmente punto a punto, no ser un valor unico repetido');
});

test('LM modo 4 (fixed_price) — reemplaza el precio y advierte si cae bajo el Piso', () => {
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', fixedPrice:{price:40, fromDay:0, toDay:1, on:true}};
  const r1 = priceLabsLm(lmConfig, {day:0, floor:60});
  assert.equal(r1.priceOverride, 40);
  assert.ok(r1.note && r1.note.includes('Piso'), 'debe advertir si el precio fijo cae bajo el Piso');
  const r2 = priceLabsLm(lmConfig, {day:0, floor:20});
  assert.equal(r2.note, null, 'si el precio fijo SI cubre el Piso, no debe advertir');
  const r3 = priceLabsLm(lmConfig, {day:5, floor:20});
  assert.equal(r3.priceOverride, null, 'fuera de rango, no debe reemplazar el precio');
});

test('LM modo 5 (tramos) — el primer tramo activo que aplica gana; NO se suman tramos solapados', () => {
  const lmConfig = {...defaultLmConfig(), mode:'tiers', tiers:[
    {id:'t1', label:'Tramo A', fromDay:0, toDay:5, pct:15, on:true},
    {id:'t2', label:'Tramo B', fromDay:2, toDay:8, pct:25, on:true} // se solapa con t1 en 2-5
  ]};
  const r = priceLabsLm(lmConfig, {day:3}); // dentro del solape
  assert.equal(r.lmPct, 15, 'el dia 3 cae en ambos tramos; debe ganar el PRIMERO del arreglo (t1=15), no sumar 15+25=40');
  const r2 = priceLabsLm(lmConfig, {day:7}); // solo t2
  assert.equal(r2.lmPct, 25, 'fuera del tramo A pero dentro de B, debe aplicar B');
  const r3 = priceLabsLm(lmConfig, {day:0}); // dia 0 explicito
  assert.equal(r3.lmPct, 15, 'dia 0 debe evaluarse igual que cualquier otro dia del tramo');
});

test('lmCriticalDays expone los bordes de la config para que la enumeracion de peor-caso los evalue', () => {
  const lmConfig = {...defaultLmConfig(), mode:'tiers', tiers:[{id:'t1', label:'A', fromDay:5, toDay:9, pct:10, on:true}]};
  const days = lmCriticalDays(lmConfig);
  assert.ok(days.includes(5) && days.includes(9), `debe incluir los bordes exactos del tramo (5 y 9): ${days}`);
});

test('descuento no reembolsable de Airbnb: se aplica DESPUES de la promo ganadora, no compite con ella', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts,'ab_los4').on = false; // limpiar defaults para aislar
  findDiscount(discounts,'ab_eb3').on = true;
  findDiscount(discounts,'ab_eb3').pct = 20; // promo ganadora: early-bird 20%
  const nonref = findDiscount(discounts,'ab_nonref');
  nonref.on = true; nonref.pct = 10; nonref.verified = true;

  const r = combineChannel(discounts, 'airbnb', 100, 1);
  assert.equal(r.applied.length, 2, 'deben aplicar exactamente 2 capas: la promo ganadora + el no reembolsable');
  assert.equal(r.applied[0].name, 'Early-bird (3 meses / ≥90 días)', 'la promo gana y se aplica PRIMERO');
  assert.equal(r.applied[1].name, 'Descuento no reembolsable (por listing)', 'el no reembolsable se aplica DESPUES, como capa aparte');
  // factor esperado: (1-0.20)*(1-0.10) = 0.72 -> 28% de descuento combinado total (no 30%, porque son capas multiplicativas, no una suma)
  assert.ok(Math.abs(r.factor - 0.8*0.9) < 1e-12, 'el no reembolsable debe multiplicar sobre lo que dejo la promo, no sumarse aparte');

  // Regresion: verificar que el precio ANTES/DESPUES de cada capa queda expuesto en el breakdown de quoteScenario
  const config = {channels: freshChannels(), discounts, windows: freshWindows(), ceilings: defaultCeilings(freshWindows())};
  const q = quoteScenario({chId:'airbnb', days:100, nights:1, price:200}, config);
  assert.equal(q.appliedSteps.length, 2);
  assert.equal(q.appliedSteps[0].name, 'Early-bird (3 meses / ≥90 días)');
  assert.equal(q.appliedSteps[1].name, 'Descuento no reembolsable (por listing)');
  assert.ok(q.appliedSteps[1].before > q.appliedSteps[1].after, 'el paso no reembolsable debe mostrar un precio ANTES y DESPUES distintos');
  assert.ok(Math.abs(q.appliedSteps[0].after - q.appliedSteps[1].before) < 1e-9, 'el "despues" de la promo debe ser exactamente el "antes" del no reembolsable (capas encadenadas, no paralelas)');
});

test('descuento no reembolsable apagado por defecto (0%, on:false) — no inventa un 10% de negocio', () => {
  const discounts = freshDiscounts();
  const nonref = findDiscount(discounts,'ab_nonref');
  assert.equal(nonref.on, false);
  assert.equal(nonref.pct, 0);
  assert.equal(nonref.verified, false);
});
