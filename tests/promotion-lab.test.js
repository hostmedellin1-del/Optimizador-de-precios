import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePromotionProposal, configWithPromotionProposal, offsetForTargetPayout} from '../src/domain/promotion-lab.js';
import {quoteScenario} from '../src/domain/quote.js';
import {baseConfig, findDiscount} from './helpers/state-factory.js';

function config(){
  const cfg = baseConfig({
    fixedCost:30,
    varCost:20,
    margin:25,
    ceilings:{w0:35,w1:28,w2:18,w3:8,w4:0,w5:15}
  });
  const airbnb = cfg.channels.find(channel => channel.id === 'airbnb');
  airbnb.offsetPct = 0;
  findDiscount(cfg.discounts, 'ab_lm2').on = false;
  findDiscount(cfg.discounts, 'ab_lm2').pct = 0;
  return cfg;
}

test('el probador crea una configuración temporal y nunca muta la configuración guardada', () => {
  const original = config();
  const snapshot = structuredClone(original);
  const result = configWithPromotionProposal(original, {discountId:'ab_lm2', pct:30, from:0, to:4});

  assert.equal(result.ok, true);
  assert.equal(findDiscount(original.discounts, 'ab_lm2').on, false);
  assert.equal(findDiscount(original.discounts, 'ab_lm2').pct, 0);
  assert.deepEqual(original, snapshot);
  assert.equal(findDiscount(result.config.discounts, 'ab_lm2').on, true);
  assert.equal(findDiscount(result.config.discounts, 'ab_lm2').pct, 30);
});

test('el Offset sugerido para cubrir costo se resuelve con quoteScenario, después de la promoción', () => {
  const original = config();
  const result = analyzePromotionProposal(original, {
    discountId:'ab_lm2', pct:30, from:0, to:4, days:2, nights:1, finalPrice:60
  });

  assert.equal(result.ok, true);
  assert.equal(result.promoApplies, true);
  assert.ok(result.proposed.payout < result.targetCost, 'sin nuevo Offset esta promo deja pérdida');
  assert.ok(result.offsetForCost.ok);
  assert.ok(Math.abs(result.offsetForCost.quote.payout - result.targetCost) < 1e-7);
  assert.ok(result.offsetForMargin.ok);
  assert.ok(Math.abs(result.offsetForMargin.quote.payout - result.targetMargin) < 1e-7);
  assert.ok(result.offsetForMargin.offsetPct > result.offsetForCost.offsetPct);
});

test('la tabla por duración usa el costo real de cada reserva, no el promedio', () => {
  const original = config();
  original.costBreakdown = {rent:700,admin:140,utilities:108,insurance:5,tech:22,occNights:26,cleaning:15,laundry:4,supplies:4,consumables:4};
  original.costBreakdownConfirmed = true;
  const result = analyzePromotionProposal(original, {
    discountId:'ab_lm2', pct:20, from:0, to:4, days:2, nights:2, finalPrice:120,
    nightSamples:[1, 4]
  });

  assert.equal(result.ok, true);
  assert.ok(result.durationRows[0].cost > result.durationRows[1].cost, 'una noche absorbe todo el turno');
  const directQuote = quoteScenario({chId:'airbnb',days:2,nights:1,price:120,priceStage:'price_labs_final'}, result.config);
  assert.equal(result.durationRows[0].cost, directQuote.cost);
});

test('un escenario no aplicable se informa y no se disfraza como descuento activo', () => {
  const result = analyzePromotionProposal(config(), {
    discountId:'ab_lm2', pct:30, from:0, to:4, days:10, nights:2, finalPrice:100
  });
  assert.equal(result.ok, true);
  assert.equal(result.promoApplies, false);
  assert.equal(result.proposed.payout, result.baseline.payout);
});

test('Booking suma Genius, Mobile y el deal propuesto cuando sus categorías son compatibles', () => {
  const original = config();
  const result = analyzePromotionProposal(original, {
    discountId:'bk_lmd', pct:15, from:0, to:3, days:2, nights:2, finalPrice:100
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.proposed.applied.map(item=>item.name), [
    'Genius (constante)', 'Mobile Rate', 'Last-Minute Deal'
  ]);
  assert.ok(Math.abs(result.proposed.nativoFactor - (0.9 * 0.9 * 0.85)) < 1e-12);
});

test('el probador puede agregar dos promociones nuevas al mismo tiempo y multiplica ambas si Booking las permite', () => {
  const original = config();
  const result = analyzePromotionProposal(original, {
    promotions:[
      {discountId:'bk_lmd', pct:15, from:0, to:3},
      {discountId:'bk_los1', pct:10, minN:3}
    ],
    days:2, nights:3, finalPrice:100
  });
  assert.equal(result.ok, true);
  assert.equal(result.discounts.length, 2);
  assert.deepEqual(result.proposed.applied.map(item=>item.name), [
    'Genius (constante)', 'Mobile Rate', 'Duración de estadía A (≥7 noches)', 'Last-Minute Deal'
  ]);
  assert.ok(Math.abs(result.proposed.nativoFactor - (0.9 * 0.9 * 0.9 * 0.85)) < 1e-12);
});

test('un único precio final de PriceLabs se cotiza para todas las OTAs y resuelve Offsets de Kunas independientes', () => {
  const original = config();
  const result = analyzePromotionProposal(original, {
    promotions:[
      {discountId:'ab_lm2', pct:20, from:0, to:3},
      {discountId:'bk_lmd', pct:15, from:0, to:3}
    ],
    detailChannelId:'airbnb', days:2, nights:2, finalPrice:100
  });

  assert.equal(result.ok, true);
  assert.equal(result.channelResults.length, original.channels.length);
  assert.deepEqual(result.channelResults.map(row=>row.chId), original.channels.map(channel=>channel.id));
  const airbnb=result.channelResults.find(row=>row.chId==='airbnb');
  const booking=result.channelResults.find(row=>row.chId==='booking');
  assert.equal(airbnb.scenario.price, 100);
  assert.equal(booking.scenario.price, 100);
  assert.ok(airbnb.proposed.applied.some(item=>item.name==='Last-minute 2'));
  assert.ok(booking.proposed.applied.some(item=>item.name==='Last-Minute Deal'));
  assert.ok(airbnb.offsetForCost.ok);
  assert.ok(booking.offsetForCost.ok);
  assert.notEqual(airbnb.offsetForCost.offsetPct, booking.offsetForCost.offsetPct, 'cada OTA debe resolver su propio Offset');
});

test('Airbnb muestra la promoción que gana y explica la que no puede sumarse', () => {
  const original = config();
  const result = analyzePromotionProposal(original, {
    discountId:'ab_lm2', pct:20, from:0, to:3, days:2, nights:28, finalPrice:100
  });
  assert.equal(result.ok, true);
  assert.equal(result.promoApplies, false);
  assert.ok(result.proposed.applied.some(item=>item.name==='Larga estadía (≥28 noches)'));
  assert.ok(result.proposed.ignored.some(item=>item.name==='Last-minute 2'));
});

test('el solver rechaza precio final inválido sin inventar un Offset', () => {
  const result = offsetForTargetPayout(config(), {chId:'airbnb',days:1,nights:1,price:0,priceStage:'price_labs_final'}, 50);
  assert.equal(result.ok, false);
});
