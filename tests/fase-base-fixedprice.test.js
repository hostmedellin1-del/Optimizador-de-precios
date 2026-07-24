/* Bloqueante P1 (revision externa, ronda 3) — Base Price y Offset no cumplian
   su contrato cuando Last-Minute esta en modo 'fixed_price' y el rango activo
   cubre el dia de referencia (45, el que usan compute().base y
   suggestedOffset()).

   Caso reproducido exacto: Direct, costo 100/0, margen 50% (objetivo neto
   200), LM verificado fixed_price=150 en dias 40-50. Antes: compute() daba
   Base≈219.78 y suggestedOffset() daba 0% — pero PriceLabs publica 150 sin
   importar Base, y quoteScenario({days:45, price:base}) daba payout=136.50,
   MUY por debajo del objetivo de 200. La causa: lmPctAtDay45() devolvia 0 en
   silencio cuando habia priceOverride, como si no hubiera LM.

   Fix: lmPctAtDay45() ahora devuelve {lmPct, priceOverride} explicito.
   - compute().base: si priceOverride!=null en el dia 45, se marca
     `baseBlocked:true` con una razon clara (nunca se inventa un Base que
     "netea el objetivo" cuando el precio real ya esta decidido por el LM
     fijo, sin importar Base).
   - suggestedOffset(): si priceOverride!=null, resuelve el offset SOBRE el
     precio fijo real (no sobre effBase*(1-lm/100), que asumia erroneamente
     que no habia override) — el Offset SI puede seguir controlando el
     resultado porque se aplica DESPUES del precio fijo (mismo orden que
     quoteScenario). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, suggestedOffset} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function directoOnlyConfig(){
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  return {channels, discounts, windows, ceilings};
}

function fixedPriceLm(price, fromDay, toDay){
  return {mode:'fixed_price', verified:true,
    flat:{pct:0,fromDay:0,toDay:3,on:false}, gradual:{maxPct:0,days:3,on:false},
    fixedPrice:{price, fromDay, toDay, on:true}, tiers:[]};
}

test('CASO OBLIGATORIO — Directo/costo 100/margen 50%/LM fixed_price 150 en 40-50: Base queda baseBlocked, y el Offset corregido SÍ alcanza el objetivo cotizando el precio fijo real', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 40, 50);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});

  assert.equal(model.net, 200);
  assert.equal(model.baseBlocked, true, 'Base debe marcarse no aplicable — el precio fijo cubre el día 45');
  assert.match(model.baseBlockedReason, /Precio fijo/);
  assert.match(model.baseBlockedReason, /por debajo de tu objetivo/, 'debe indicar explícitamente que el precio fijo por sí solo no alcanza el objetivo');

  const off = suggestedOffset({chId:'direct', channels, discounts, avgNights:3, effBase: model.effBase, netObjetivo: model.net, lmConfig, windows, ceilings});
  assert.ok(off > 40, `el offset corregido debe ser sustancialmente positivo para compensar el precio fijo bajo; dio ${off}`);

  // Verificacion end-to-end: aplicar ESE offset al canal y cotizar el precio fijo real en día 45 debe dar EXACTAMENTE el objetivo.
  const channelsWithOffset = channels.map(c => c.id==='direct' ? {...c, offsetPct: off} : c);
  const q = quoteScenario({chId:'direct', days:45, nights:1, price: model.base}, {channels: channelsWithOffset, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.equal(q.priceAfterLm, 150, 'el precio real publicado debe ser el fijo (150), no Base');
  assert.ok(Math.abs(q.payout - model.net) < 1e-6, `el payout con el offset corregido debe netear exactamente el objetivo (${model.net}); dio ${q.payout}`);
});

test('ANTES del fix, el bug quedaba demostrado así (regresión negativa): sin el offset corregido, Base + offset 0% neta muy por debajo del objetivo', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 40, 50);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  const q = quoteScenario({chId:'direct', days:45, nights:1, price: model.base}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.ok(q.payout < model.net, 'sin el offset corregido (offsetPct:0 por defecto), el precio fijo por sí solo no alcanza el objetivo — por eso Base debe quedar bloqueado, no confiable');
});

test('bordes del rango de precio fijo — día 45 en el INICIO exacto del rango (fromDay:45) también bloquea', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 45, 60);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.baseBlocked, true);
});

test('bordes del rango de precio fijo — día 45 en el FIN exacto del rango (toDay:45) también bloquea', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 30, 45);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.baseBlocked, true);
});

test('justo FUERA del rango (toDay:44, día 45 no cae dentro) — Base NO se bloquea, usa la fórmula normal', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 40, 44);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.baseBlocked, false);
  assert.equal(model.baseBlockedReason, null);
});

test('justo FUERA del rango por el otro lado (fromDay:46, día 45 no cae dentro) — Base NO se bloquea', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = fixedPriceLm(150, 46, 60);
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.baseBlocked, false);
});

test('precio fijo que YA alcanza el objetivo por sí solo: baseBlockedReason lo indica explícitamente (no como falla)', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  // Precio fijo generoso (400) + margen bajo (10%, objetivo ~11.1 sobre costo 10) — el fijo solo ya sobra.
  const lmConfig = fixedPriceLm(400, 40, 50);
  const model = compute({fixedCost:10, varCost:0, margin:10, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.baseBlocked, true);
  assert.match(model.baseBlockedReason, /ya cubre tu objetivo/);
});

test('propiedad — siempre que Base esté baseBlocked por precio fijo (y sea matemáticamente alcanzable), el offset corregido de suggestedOffset() hace que el payout real en día 45 sea EXACTAMENTE el objetivo', () => {
  const casos = [
    {fixedCost:50, varCost:0, margin:20, price:80, from:40, to:50},
    {fixedCost:200, varCost:20, margin:35, price:120, from:0, to:9999},
    {fixedCost:30, varCost:10, margin:60, price:300, from:44, to:46},
  ];
  for(const caso of casos){
    const {channels, discounts, windows, ceilings} = directoOnlyConfig();
    const lmConfig = fixedPriceLm(caso.price, caso.from, caso.to);
    const model = compute({fixedCost:caso.fixedCost, varCost:caso.varCost, margin:caso.margin, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
    assert.equal(model.baseBlocked, true, `caso ${JSON.stringify(caso)}: debe bloquear Base`);
    const off = suggestedOffset({chId:'direct', channels, discounts, avgNights:3, effBase: model.effBase, netObjetivo: model.net, lmConfig, windows, ceilings});
    const channelsWithOffset = channels.map(c => c.id==='direct' ? {...c, offsetPct: off} : c);
    const q = quoteScenario({chId:'direct', days:45, nights:1, price: model.base}, {channels: channelsWithOffset, discounts, windows, ceilings, fixedCost:caso.fixedCost, varCost:caso.varCost, lmConfig});
    assert.ok(Math.abs(q.payout - model.net) < 1e-6, `caso ${JSON.stringify(caso)}: payout ${q.payout} debe ser exactamente el objetivo ${model.net}`);
  }
});
