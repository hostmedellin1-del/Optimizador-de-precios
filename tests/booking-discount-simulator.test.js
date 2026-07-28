import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combineChannel, maximumDiscountScenario, compensationOffsetPct} from '../src/domain/engine.js';
import {freshChannels, freshDiscounts, freshWindows, findDiscount} from './helpers/state-factory.js';

function bookingOnly(){
  const discounts=freshDiscounts();
  discounts.forEach(discount=>{ discount.on=discount.ch==='booking' ? false : discount.on; });
  return discounts;
}

test('Booking — el simulador usa el peor grupo elegible: Mobile y Country compiten, no se suman',()=>{
  const discounts=bookingOnly();
  const genius=findDiscount(discounts,'bk_gen'); genius.on=true; genius.pct=10;
  const mobile=findDiscount(discounts,'bk_mob'); mobile.on=true; mobile.pct=50;
  const country=findDiscount(discounts,'bk_cty'); country.on=true; country.pct=10;

  const result=combineChannel(discounts,'booking',10,1);
  assert.equal(result.factor,0.45,'debe proteger al huésped Mobile: Genius 10% × Mobile 50%');
  assert.equal(result.totalPct,55);
  assert.ok(result.applied.some(item=>item.name==='Mobile Rate'));
  assert.ok(!result.applied.some(item=>item.name==='Country Rate'));
  assert.ok(result.ignored.some(item=>item.name==='Country Rate' && item.reason.includes('alternativos')));
});

test('Booking — replica el simulador oficial: dos descuentos de 10% dan 19%, no 20%',()=>{
  const discounts=bookingOnly();
  const mobile=findDiscount(discounts,'bk_mob'); mobile.on=true; mobile.pct=10;
  const country=findDiscount(discounts,'bk_cty'); country.on=true; country.pct=10;
  const basic=findDiscount(discounts,'bk_bas'); basic.on=true; basic.pct=10;
  const lm=findDiscount(discounts,'bk_lmd'); lm.on=true; lm.pct=10; lm.from=0; lm.to=3;
  const early=findDiscount(discounts,'bk_ebd'); early.on=true; early.pct=10; early.from=30; early.to=9999;

  const result=combineChannel(discounts,'booking',0,1);
  assert.equal(result.factor,0.81,'un grupo recibe Mobile O Country y un Portfolio deal, nunca todos');
  assert.equal(result.totalPct,19);
  assert.equal(50*result.factor,40.5,'USD 50 con dos descuentos secuenciales de 10% debe dar USD 40.50');
});

test('Booking — Campaign/Limited solo se combina con Genius y puede ser el peor grupo',()=>{
  const discounts=bookingOnly();
  const genius=findDiscount(discounts,'bk_gen'); genius.on=true; genius.pct=10;
  const mobile=findDiscount(discounts,'bk_mob'); mobile.on=true; mobile.pct=20;
  const limited=findDiscount(discounts,'bk_ltd'); limited.on=true; limited.pct=50;

  const result=combineChannel(discounts,'booking',10,1);
  assert.equal(result.factor,0.45,'Genius 10% + Campaign 50% debe ganar sobre Genius + Mobile');
  assert.ok(result.applied.some(item=>item.name==='Genius (constante)'));
  assert.ok(result.applied.some(item=>item.name==='Limited-time Deal'));
  assert.ok(!result.applied.some(item=>item.name==='Mobile Rate'));
});

test('maximumDiscountScenario encuentra el día y noches donde vive el descuento máximo',()=>{
  const discounts=bookingOnly();
  const early=findDiscount(discounts,'bk_ebd'); early.on=true; early.pct=35; early.from=30; early.to=9999;
  const mobile=findDiscount(discounts,'bk_mob'); mobile.on=true; mobile.pct=10;
  const result=maximumDiscountScenario(discounts,'booking',freshWindows());
  assert.equal(result.totalPct,41.5,'Mobile 10% × Early 35% = 41.5% efectivo');
  assert.ok(result.days>=30);
  assert.ok(result.applied.some(item=>item.name==='Early Booker Deal'));
});

test('Airbnb — respeta la prioridad oficial: una promo principal por noche (nuevo > personalizada > duración > anticipada > último minuto)',()=>{
  const discounts=freshDiscounts();
  discounts.filter(discount=>discount.ch==='airbnb').forEach(discount=>{discount.on=false;});
  const newListing=findDiscount(discounts,'ab_new'); newListing.on=true; newListing.pct=20;
  const custom=findDiscount(discounts,'ab_cus'); custom.on=true; custom.pct=40;
  const longStay=findDiscount(discounts,'ab_los4'); longStay.on=true; longStay.pct=25;
  const early=findDiscount(discounts,'ab_eb1'); early.on=true; early.pct=35;
  const lastMinute=findDiscount(discounts,'ab_lm2'); lastMinute.on=true; lastMinute.pct=50;

  const result=combineChannel(discounts,'airbnb',0,28);
  assert.equal(result.totalPct,20,'la promo de anuncio nuevo gana aun si otra tendría un porcentaje mayor');
  assert.deepEqual(result.applied.map(item=>item.name),['Promo anuncio nuevo (20%)']);
});

test('Offset de compensación: Airbnb 25% de descuento + 15.5% de comisión requiere +57.8% en Kunas, no sumar 40.5%',()=>{
  const airbnb=freshChannels().find(channel=>channel.id==='airbnb');
  const result=compensationOffsetPct(airbnb,0.75);
  assert.ok(Math.abs(result-57.7909270217)<1e-9);
});
