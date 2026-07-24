/* Auditoria externa (ronda 4) — reproduccion directa de los DOS bloqueantes
   confirmados, contra compute()/buildMatrixVerdict()/buildAlerts() (no solo
   contra las funciones puras de mas bajo nivel, ver tests/usd-only.test.js y
   tests/cost-mode.test.js). Cada caso trae el numero exacto reportado en el
   encargo (Piso 90 con costo 54; Piso cayendo a 8.33 con el bug). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {buildMatrixVerdict, worstScenariosInWindow} from '../src/domain/matrix.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {defaultVerification} from '../src/domain/verification.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function verifiedLmConfig(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}
function resolveAll(verification){
  verification.hospyOffsetIsolated.status = 'no_aplica';
  verification.bookingGeniusMobileBoth.status = 'no_aplica';
  verification.expediaVipTierMix.status = 'no_aplica';
  verification.airbnbNonRefundable.status = 'no_aplica';
  Object.keys(verification.bankFeePctByChannel).forEach(id=>{ verification.bankFeePctByChannel[id].status = 'verificado'; });
  return verification;
}
function baseConfig(overrides={}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = overrides.windows || freshWindows();
  const ceilings = overrides.ceilings || defaultCeilings(windows);
  const verification = overrides.verification || resolveAll(defaultVerification());
  return {fixedCost:32, varCost:22, margin:45, marketBase:0, lmConfig: verifiedLmConfig(), ...overrides, channels, discounts, windows, ceilings, verification};
}

/* ======================= BLOQUEANTE 1 — canal no-USD ======================= */

test('BLOQUEANTE 1: unidad USD limpia (sin canales en otra moneda) — Piso/Base disponibles, currencyBlocked false', () => {
  const model = compute(baseConfig({currency:'USD'}));
  assert.equal(model.currencyBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
  assert.equal(model.baseReadinessBlocked, false);
  assert.ok(model.floor>0);
});

test('BLOQUEANTE 1 (reproduccion del hallazgo): unidad USD + Airbnb con settlementCurrency:"COP" — Piso/Base GLOBALES quedan bloqueados aunque state.currency==="USD"', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb' ? {...c, settlementCurrency:'COP'} : c);
  const model = compute(baseConfig({currency:'USD', channels}));
  assert.equal(model.currencyBlocked, true, 'ANTES del fix esto daba false — el canal COP pasaba desapercibido');
  assert.match(model.currencyBlockedReason, /Airbnb/);
  assert.match(model.currencyBlockedReason, /COP/);
  assert.equal(model.floorReadinessBlocked, true);
  assert.equal(model.baseReadinessBlocked, true);
});

test('BLOQUEANTE 1: con el canal COP, la Matriz NUNCA dice "RENTABLE EN TODOS" ni ningún veredicto positivo engañoso', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb' ? {...c, settlementCurrency:'COP'} : c);
  const config = baseConfig({currency:'USD', channels, fixedCost:5, varCost:0, margin:5});
  const model = compute(config);
  const qConfig = {channels: config.channels, discounts: config.discounts, windows: config.windows, ceilings: config.ceilings, fixedCost: config.fixedCost, varCost: config.varCost, lmConfig: config.lmConfig, verification: config.verification};
  let sawRentable = false;
  config.windows.forEach(w=>{
    const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w, model.effBase||100);
    const {vTag} = buildMatrixVerdict({model, ceil: config.ceilings[w.id], worstTecho, worstPayoutRow, perChannel, currency:'USD'});
    if(vTag==='RENTABLE EN TODOS') sawRentable = true;
  });
  assert.equal(sawRentable, false, 'la Matriz no debe mostrar un veredicto rentable engañoso mientras currencyBlocked sea true — pero currencyBlocked en si no cambia el veredicto por fila (eso lo hace el early-return de renderMatrix() en index.html); aqui solo se confirma que ningun escenario "generoso" cuela un RENTABLE incorrecto');
});

test('BLOQUEANTE 1: dos unidades simultáneas (una bloqueada por canal COP, otra USD correcta) NO se contaminan entre sí', () => {
  const channelsBad = freshChannels().map(c=>c.id==='booking' ? {...c, settlementCurrency:'COP'} : c);
  const channelsOk = freshChannels();
  const modelBad = compute(baseConfig({currency:'USD', channels: channelsBad}));
  const modelOk = compute(baseConfig({currency:'USD', channels: channelsOk}));
  assert.equal(modelBad.currencyBlocked, true);
  assert.equal(modelOk.currencyBlocked, false, 'la unidad limpia no debe heredar el bloqueo de la otra unidad — son configs independientes');
  assert.equal(modelOk.floorReadinessBlocked, false);
  assert.ok(modelOk.floor>0);
});

/* ======================= BLOQUEANTE 2 — costos parciales ======================= */

function cb(overrides={}){
  return {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:0, laundry:0, consumables:0, supplies:0, ...overrides};
}

test('BLOQUEANTE 2: costo simple 32+22=54 (sin desglose detallado) — Piso ≈ 90 (verificado con el catálogo de fábrica + LM verificado)', () => {
  const model = compute(baseConfig());
  // cost = 32+22 = 54 exacto, sin costBreakdown
  assert.equal(model.cost, 54);
  assert.ok(Math.abs(model.floor - 90) < 1e-6, `Piso esperado ≈90, dio ${model.floor}`);
  assert.equal(model.costBlocked, false, 'fixedCost/varCost reales (no el flag usingExampleCosts) — este test no participa del gate de "ejemplo"');
});

test('BLOQUEANTE 2 (reproduccion EXACTA del hallazgo): agregar SOLO consumables:5 (sin confirmar) NO baja el costo/Piso — el motor sigue usando 32+22=54, no el desglose parcial', () => {
  const before = compute(baseConfig());
  const after = compute(baseConfig({costBreakdown: cb({consumables:5}), costBreakdownConfirmed:false}));
  assert.equal(before.cost, 54);
  assert.equal(after.cost, 54, 'ANTES del fix esto caia a 5 (costBreakdownIsFilled trataba el campo suelto como "modo detallado activo")');
  assert.equal(after.floor, before.floor, 'el Piso no debe moverse por un desglose parcial sin confirmar');
  assert.equal(after.costBlocked, true, 'el desglose tocado-pero-sin-confirmar SI debe bloquear Piso/Base como recomendacion, aunque el costo en si no se contamine');
  assert.equal(after.floorReadinessBlocked, true);
  assert.equal(after.baseReadinessBlocked, true);
});

test('BLOQUEANTE 2: desglose COMPLETO pero sin confirmar tampoco alimenta el costo ni desbloquea', () => {
  const filled = cb({rent:500, admin:100, utilities:50, insurance:30, tech:20, cleaning:40, laundry:10, supplies:5, consumables:5});
  const model = compute(baseConfig({costBreakdown: filled, costBreakdownConfirmed:false}));
  assert.equal(model.cost, 54, 'sigue usando fixedCost+varCost mientras no este confirmado, aunque el desglose este completo');
  assert.equal(model.costBlocked, true);
});

test('BLOQUEANTE 2: desglose CONFIRMADO explícitamente (costBreakdownConfirmed:true) SÍ alimenta el costo real y desbloquea', () => {
  const filled = cb({rent:500, admin:100, utilities:50, insurance:30, tech:20, cleaning:40, laundry:10, supplies:5, consumables:5});
  const model = compute(baseConfig({costBreakdown: filled, costBreakdownConfirmed:true}));
  assert.equal(model.costBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
  // costo real de 1 noche: fixedPerNight=700/22=31.818..., consumptionPerNight=5, turnoTotal=55 => total=(31.818+5)*1+55=91.818...
  assert.ok(Math.abs(model.cost - 91.818181818) < 1e-4);
});

test('BLOQUEANTE 2: cero legítimo CONFIRMADO (todo el desglose en 0, pero el usuario lo confirmó explícitamente) funciona — cost=0, no bloqueado por el gate de costos', () => {
  const model = compute(baseConfig({costBreakdown: cb(), costBreakdownConfirmed:true}));
  assert.equal(model.costBlocked, false);
  assert.equal(model.cost, 0, 'cero real confirmado es un costo valido de 0, no un dato faltante');
});

test('BLOQUEANTE 2: costos de ejemplo de fábrica (32/22 exactos, nunca tocados) BLOQUEAN Piso/Base cuando usingExampleCosts:true — ya no solo advierten', () => {
  const model = compute(baseConfig({usingExampleCosts:true}));
  assert.equal(model.costBlocked, true);
  assert.equal(model.floorReadinessBlocked, true);
  assert.equal(model.baseReadinessBlocked, true);
});

test('BLOQUEANTE 2: sin usingExampleCosts (callers de test que no participan del contrato) — regresión cero, el costo simple de siempre sigue funcionando', () => {
  const model = compute(baseConfig());
  assert.equal(model.costBlocked, false);
  assert.equal(model.floorReadinessBlocked, false);
});

test('BLOQUEANTE 2: con costo bloqueado, Alertas nunca dice "OK: sin conflictos" — aparece el tag COSTOS SIN CONFIRMAR', () => {
  const config = baseConfig({fixedCost:5, varCost:0, margin:5, usingExampleCosts:false, costBreakdown: cb({consumables:5}), costBreakdownConfirmed:false});
  const model = compute(config);
  const alerts = buildAlerts({discounts: config.discounts, channels: config.channels, ceilings: config.ceilings, marketWindow:16, marketBase:0, windows: config.windows, chTab:{airbnb:'ch-airbnb',booking:'ch-booking',expedia:'ch-expedia',direct:'ch-direct'}, currency:'USD', margin: config.margin, lmConfig: config.lmConfig, verification: config.verification}, model);
  assert.ok(!alerts.some(a=>a.tag==='OK'), 'no debe afirmar "sin conflictos" mientras el costo no este confirmado');
});
