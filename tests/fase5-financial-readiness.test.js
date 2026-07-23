/* Fase 5 (revision externa — "datos financieros verificados"): el codigo YA
   reconocia que ciertos datos (comision bancaria real, si Hospy aisla el
   Offset por canal, mezcla VIP de Expedia, Genius+Mobile de Booking,
   no-reembolsable de Airbnb) estaban "no verificados" (src/domain/
   verification.js), pero NINGUNA vista lo usaba para bloquear nada — era una
   etiqueta, no una regla financiera. Estos tests prueban el contrato nuevo:
   evaluateRecommendationReadiness() (src/domain/readiness.js) debe bloquear
   SOLO los canales realmente afectados por cada dato pendiente, desbloquear
   en cuanto se marca "verificado", y dejar los canales no afectados intactos.
   Tambien prueba que este bloqueo es ORTOGONAL a lmBlocked/baseBlocked (los
   dos P1 de la ronda 3) — ninguno de los dos debe dejar de funcionar. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {evaluateRecommendationReadiness, unreadyChannels, globalRecommendationReady} from '../src/domain/readiness.js';
import {defaultVerification, isVerified} from '../src/domain/verification.js';
import {buildMatrixVerdict, worstScenariosInWindow} from '../src/domain/matrix.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

/* LM verificado y generoso en todos los tests de este archivo — asi el unico
   motivo de bloqueo posible es el dato de negocio bajo prueba, nunca LM
   (que ya tiene su propia cobertura completa en fase-lm-blocking.test.js). */
function verifiedLmConfig(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}

function config(overrides={}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = overrides.windows || freshWindows();
  const ceilings = overrides.ceilings || defaultCeilings(windows);
  const verification = overrides.verification || defaultVerification();
  return {fixedCost:32, varCost:22, margin:45, marketBase:0, lmConfig: verifiedLmConfig(), ...overrides, channels, discounts, windows, ceilings, verification};
}

test('un Offset distinto de cero sin hospyOffsetIsolated verificado bloquea SOLO el canal con ese Offset', () => {
  const channels = freshChannels().map(c => c.id==='booking' ? {...c, offsetPct:-15} : c);
  const r = evaluateRecommendationReadiness({channels, discounts: freshDiscounts(), verification: defaultVerification()});
  assert.equal(r.byChannel.booking.ready, false, 'Booking tiene Offset != 0 y el dato no esta verificado');
  assert.ok(r.byChannel.booking.missing.some(m=>m.key==='hospyOffsetIsolated'));
  assert.equal(r.byChannel.airbnb.ready, true, 'Airbnb no tiene Offset configurado — no debe bloquearse por este dato');
  assert.equal(r.byChannel.expedia.ready, false, 'Expedia sigue bloqueado por su propio dato (VIP), no por Offset');
  assert.ok(!r.byChannel.expedia.missing.some(m=>m.key==='hospyOffsetIsolated'));
});

test('marcar hospyOffsetIsolated como verificado desbloquea el canal con Offset (y solo ese motivo)', () => {
  const channels = freshChannels().map(c => c.id==='booking' ? {...c, offsetPct:-15} : c);
  const verification = defaultVerification();
  verification.hospyOffsetIsolated = {status:'verificado', source:'soporte Hospy', date:'2026-07-20', note:'confirmado por chat'};
  const r = evaluateRecommendationReadiness({channels, discounts: freshDiscounts(), verification});
  assert.ok(!r.byChannel.booking.missing.some(m=>m.key==='hospyOffsetIsolated'), 'el motivo Offset debe desaparecer');
});

test('comision bancaria/pasarela no verificada bloquea SOLO los canales que realmente la cobran', () => {
  // Catalogo por defecto: booking y direct tienen bankFeePct=6; airbnb y expedia tienen 0.
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts: freshDiscounts(), verification: defaultVerification()});
  assert.equal(r.byChannel.booking.ready, false);
  assert.ok(r.byChannel.booking.missing.some(m=>m.key==='bankFeePctByChannel'));
  assert.equal(r.byChannel.direct.ready, false);
  assert.ok(r.byChannel.direct.missing.some(m=>m.key==='bankFeePctByChannel'));
  assert.ok(!r.byChannel.airbnb.missing.some(m=>m.key==='bankFeePctByChannel'), 'Airbnb no cobra comision bancaria en el catalogo por defecto — no debe bloquearse por este dato');
});

test('confirmar bankFeePctByChannel de UN canal desbloquea solo ese canal — el otro (misma clave, canal distinto) sigue pendiente', () => {
  // Aisla el hecho bajo prueba: sin Genius/Mobile activos, Booking solo puede
  // quedar bloqueado por su propia comision bancaria (bankFeePctByChannel).
  const discounts = freshDiscounts().map(d=>['bk_gen','bk_mob'].includes(d.id) ? {...d, on:false} : d);
  const verification = defaultVerification();
  verification.bankFeePctByChannel.booking = {status:'verificado', source:'extracto Bancolombia jul-2026', date:'2026-07-15', note:''};
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification});
  assert.equal(r.byChannel.booking.ready, true, 'Booking ya confirmo su comision bancaria y no tiene otro motivo pendiente');
  assert.equal(r.byChannel.direct.ready, false, 'Directo tiene su PROPIO registro por canal, todavia no confirmado');
  assert.ok(r.byChannel.direct.missing.some(m=>m.key==='bankFeePctByChannel'));
});

test('"no_aplica" tambien resuelve el dato (no bloquea) — es una respuesta explicita, distinta de pendiente', () => {
  const verification = defaultVerification();
  verification.bankFeePctByChannel.direct = {status:'no_aplica', source:'', date:'', note:'este canal cobra por transferencia directa sin comision'};
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts: freshDiscounts(), verification});
  assert.equal(r.byChannel.direct.ready, true);
});

test('Booking: Genius+Mobile ambos activos sin bookingGeniusMobileBoth verificado bloquea Booking, no otros canales', () => {
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts: freshDiscounts(), verification: defaultVerification()});
  // catalogo por defecto: bk_gen y bk_mob ambos on:true
  assert.ok(r.byChannel.booking.missing.some(m=>m.key==='bookingGeniusMobileBoth'));
  assert.ok(!r.byChannel.airbnb.missing.some(m=>m.key==='bookingGeniusMobileBoth'));
});

test('Booking: si Mobile Rate esta apagado, no se exige verificar Genius+Mobile (el hecho ya no aplica)', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'bk_mob').on = false;
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification: defaultVerification()});
  assert.ok(!r.byChannel.booking.missing.some(m=>m.key==='bookingGeniusMobileBoth'));
});

test('Expedia: VIP asumido (ex_mod on) sin expediaVipTierMix verificado bloquea SOLO Expedia', () => {
  // Aisla el hecho bajo prueba: sin Offset/comision bancaria/Genius+Mobile activos,
  // el UNICO motivo de bloqueo posible en cualquier canal es la mezcla VIP de Expedia.
  const channels = freshChannels().map(c=>({...c, bankFeePct:0, offsetPct:0}));
  const discounts = freshDiscounts().map(d=>['bk_gen','bk_mob'].includes(d.id) ? {...d, on:false} : d);
  const r = evaluateRecommendationReadiness({channels, discounts, verification: defaultVerification()});
  assert.equal(r.byChannel.expedia.ready, false);
  assert.ok(r.byChannel.expedia.missing.some(m=>m.key==='expediaVipTierMix'));
  assert.equal(r.byChannel.booking.ready, true, 'sin Genius/Mobile/Offset/comision bancaria activos, Booking no tiene ningun motivo pendiente');
  assert.equal(r.byChannel.airbnb.ready, true);
  assert.equal(r.byChannel.direct.ready, true);
});

test('Airbnb: descuento no reembolsable activo sin airbnbNonRefundable verificado bloquea SOLO Airbnb', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ab_nonref').on = true;
  findDiscount(discounts, 'ab_nonref').pct = 10;
  const r = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification: defaultVerification()});
  assert.equal(r.byChannel.airbnb.ready, false);
  assert.ok(r.byChannel.airbnb.missing.some(m=>m.key==='airbnbNonRefundable'));
});

test('Airbnb: no reembolsable APAGADO (default) no exige nada — el canal queda listo si no tiene otros pendientes', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts().map(d=>d.id==='ex_mod'?{...d,on:false}:d); // apaga el unico pendiente de otro canal, sin efecto en airbnb
  const r = evaluateRecommendationReadiness({channels, discounts, verification: defaultVerification()});
  assert.equal(r.byChannel.airbnb.ready, true);
});

test('canal totalmente limpio (sin Offset, sin comision bancaria, sin promos que requieran verificacion) queda listo con verification por defecto', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb'?{...c, offsetPct:0}:c);
  const discounts = freshDiscounts().map(d=>['ex_mod'].includes(d.id) ? {...d, on:false} : d);
  const r = evaluateRecommendationReadiness({channels, discounts, verification: defaultVerification()});
  assert.equal(r.byChannel.airbnb.ready, true);
});

test('verificar TODOS los datos pendientes da ready:true global', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = defaultVerification();
  verification.hospyOffsetIsolated.status = 'verificado';
  verification.bookingGeniusMobileBoth.status = 'verificado';
  verification.expediaVipTierMix.status = 'verificado';
  verification.airbnbNonRefundable.status = 'verificado';
  Object.keys(verification.bankFeePctByChannel).forEach(chId=>{ verification.bankFeePctByChannel[chId].status='verificado'; });
  const r = evaluateRecommendationReadiness({channels, discounts, verification});
  assert.equal(r.ready, true);
  Object.values(r.byChannel).forEach(c=>assert.equal(c.ready, true));
});

test('compute(): floorReadinessBlocked/baseReadinessBlocked se activan cuando el canal que fija Piso/Base depende de un dato sin confirmar', () => {
  const model = compute(config());
  assert.equal(model.lmBlocked, false, 'este test usa LM ya verificado — el bloqueo bajo prueba es el de datos financieros, no LM');
  assert.equal(model.floorReadinessBlocked, true);
  assert.ok(model.floorReadinessBlockedReason && model.floorReadinessBlockedReason.length>0);
  assert.equal(model.baseReadinessBlocked, true);
  assert.ok(model.baseReadinessBlockedReason && model.baseReadinessBlockedReason.length>0);
});

test('compute(): sin config.verification (callers viejos/tests que no lo pasan), el gate nuevo NO se activa — regresion cero', () => {
  const c = config();
  delete c.verification;
  const model = compute(c);
  assert.equal(model.readiness, null);
  assert.equal(model.floorReadinessBlocked, false);
  assert.equal(model.baseReadinessBlocked, false);
});

test('compute(): al verificar todos los datos pendientes, floorReadinessBlocked/baseReadinessBlocked se apagan', () => {
  const verification = defaultVerification();
  verification.hospyOffsetIsolated.status = 'verificado';
  verification.bookingGeniusMobileBoth.status = 'verificado';
  verification.expediaVipTierMix.status = 'verificado';
  verification.airbnbNonRefundable.status = 'verificado';
  Object.keys(verification.bankFeePctByChannel).forEach(chId=>{ verification.bankFeePctByChannel[chId].status='verificado'; });
  const model = compute(config({verification}));
  assert.equal(model.floorReadinessBlocked, false);
  assert.equal(model.baseReadinessBlocked, false);
});

test('LOS DOS P1 DE LA RONDA 3 SIGUEN PROTEGIDOS: baseBlocked (precio LM fijo en dia 45) sigue funcionando con verification presente', () => {
  const lmConfig = {mode:'fixed_price', verified:true, flat:{pct:0,fromDay:0,toDay:3,on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:150, fromDay:40, toDay:50, on:true}, tiers:[]};
  const channels = freshChannels().map(c=>c.id==='direct'?{...c, comm:0, bankFeePct:0, offsetPct:0}:c);
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const verification = defaultVerification();
  Object.keys(verification.bankFeePctByChannel).forEach(chId=>{ verification.bankFeePctByChannel[chId].status='no_aplica'; });
  verification.hospyOffsetIsolated.status = 'no_aplica';
  verification.bookingGeniusMobileBoth.status = 'no_aplica';
  verification.expediaVipTierMix.status = 'no_aplica';
  verification.airbnbNonRefundable.status = 'no_aplica';
  const model = compute({fixedCost:100, varCost:0, margin:50, marketBase:0, channels, discounts, windows: freshWindows(), ceilings: defaultCeilings(), lmConfig, verification});
  assert.equal(model.baseBlocked, true, 'el bloqueo de precio fijo (ronda 3) sigue activo — orthogonal al nuevo gate de datos financieros');
  assert.ok(model.baseBlockedReason.includes('Precio fijo'));
});

/* Config generosa (sin nativos, comision baja) tomada del mismo patron que ya
   prueba fase-lm-blocking.test.js (linea 92) para "RENTABLE EN TODOS" con LM
   verificado — aqui se le agrega EXACTAMENTE un hecho de negocio pendiente
   (un Offset != 0 en Airbnb) sin tocar nada mas del escenario financiero, para
   que el UNICO motivo de diferencia entre los dos tests sea ese hecho. */
function generousChannelsWithOneOffset(){
  return freshChannels().map(c=>({...c, comm:5, bankFeePct:0, offsetPct: c.id==='airbnb' ? 1 : 0}));
}

test('Matriz: un veredicto que seria "RENTABLE EN TODOS" NO se muestra asi si CUALQUIER canal involucrado tiene un dato financiero sin verificar (aunque no sea el mas ajustado)', () => {
  const channels = generousChannelsWithOneOffset();
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const verification = defaultVerification(); // nada verificado — el Offset de Airbnb queda pendiente
  const lmConfig = {mode:'flat', verified:true, flat:{pct:20, fromDay:0, toDay:3, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:20, varCost:0, lmConfig, verification};
  const model = compute({...qConfig, margin:10, marketBase:0});
  assert.equal(model.lmBlocked, false);
  assert.equal(model.readiness.byChannel.airbnb.ready, false, 'precondicion del test: Airbnb debe tener exactamente un hecho pendiente (su Offset)');
  const w5 = windows.find(w=>w.id==='w5');
  const ceil = ceilings[w5.id];
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w5, model.effBase || 150);
  const {vLvl, vTag, vMsg} = buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.notEqual(vTag, 'RENTABLE EN TODOS');
  assert.equal(vLvl, 'warn');
  assert.match(vTag, /DATOS SIN VERIFICAR/);
  assert.match(vMsg, /Verificación de datos financieros/);
});

test('Matriz: con todos los datos financieros verificados y LM verificado, el mismo escenario generoso SI puede quedar "RENTABLE EN TODOS"', () => {
  const channels = generousChannelsWithOneOffset();
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const verification = defaultVerification();
  verification.hospyOffsetIsolated.status = 'verificado'; // el unico hecho pendiente en este escenario
  const lmConfig = {mode:'flat', verified:true, flat:{pct:20, fromDay:0, toDay:3, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:20, varCost:0, lmConfig, verification};
  const model = compute({...qConfig, margin:10, marketBase:0});
  assert.equal(model.readiness.ready, true);
  const w5 = windows.find(w=>w.id==='w5');
  const ceil = ceilings[w5.id];
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w5, model.effBase || 150);
  const {vLvl, vTag} = buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.equal(vLvl, 'ok');
  assert.equal(vTag, 'RENTABLE EN TODOS');
});

test('Alertas: el fallback "OK: sin conflictos" no se muestra si un canal tiene un dato financiero sin verificar — se reemplaza el veredicto entero, no se agrega solo una advertencia', () => {
  const channels = freshChannels().map(c=>({...c, comm:5, bankFeePct:0, offsetPct:0}));
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  // Reactiva un solo hecho pendiente (Genius/Mobile de Booking) para que quede EXACTAMENTE un canal bloqueado.
  findDiscount(discounts, 'bk_gen').on = true;
  findDiscount(discounts, 'bk_mob').on = true;
  const windows = freshWindows();
  const ceilings = Object.fromEntries(windows.map(w=>[w.id, 100])); // techo alto: aisla el hecho bajo prueba, sin ruido de TECHO EXCEDIDO
  const verification = defaultVerification();
  const lmConfig = {mode:'flat', verified:true, flat:{pct:5, fromDay:0, toDay:3, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const alertConfig = {discounts, channels, ceilings, marketWindow:16, marketBase:0, windows, chTab:{airbnb:'ch-airbnb',booking:'ch-booking',expedia:'ch-expedia',direct:'ch-direct'}, currency:'USD', margin:5, lmConfig, verification};
  const model = compute({...alertConfig, fixedCost:10, varCost:0});
  const alerts = buildAlerts(alertConfig, model);
  assert.ok(!alerts.some(a=>a.tag==='OK'), 'no debe quedar ningun veredicto "OK: sin conflictos" mientras Booking siga sin confirmar Genius+Mobile');
  assert.ok(alerts.some(a=>a.tag==='DATOS SIN VERIFICAR'), 'debe explicar exactamente que dato falta y de que canal');
});

/* ============================================================================
   P1 (revision externa — "Min Price y Base Price globales siguen siendo
   inseguros"): floorReadinessBlocked/baseReadinessBlocked ANTES solo miraban
   si el canal que HOY fija el numero (floorChId/baseChId) tenia un dato
   pendiente. Min Price/Base Price son numeros GLOBALES que PriceLabs aplica a
   TODOS los canales — un canal que HOY no fija el numero pero tiene un dato
   pendiente (comision bancaria, Offset, etc.) puede pasar a fijarlo en cuanto
   se conozca su valor real. Caso obligatorio del encargo: Airbnb fija hoy el
   Piso/Base; Directo NO lo fija hoy; Directo tiene comision bancaria sin
   confirmar (default de fabrica) -> el Piso/Base global deben seguir
   bloqueados aunque Airbnb (el canal que manda hoy) este perfectamente
   confirmado. ============================================================ */

function readyCatalogExcept(pendingKey){
  // Config aislada: todos los hechos de negocio resueltos EXCEPTO uno, para
  // que el unico motivo de bloqueo posible sea el que el test declara.
  const discounts = freshDiscounts().map(d=>['bk_gen','bk_mob','ex_mod'].includes(d.id) ? {...d, on:false} : d);
  const verification = defaultVerification();
  verification.hospyOffsetIsolated.status = 'no_aplica';
  verification.bookingGeniusMobileBoth.status = 'no_aplica';
  verification.expediaVipTierMix.status = 'no_aplica';
  verification.airbnbNonRefundable.status = 'no_aplica';
  Object.keys(verification.bankFeePctByChannel).forEach(chId=>{ verification.bankFeePctByChannel[chId].status = 'verificado'; });
  if(pendingKey==='direct-bank-fee') verification.bankFeePctByChannel.direct.status = 'no_verificado';
  return {discounts, verification};
}

test('P1: Directo NO fija hoy el Piso (lo fija Airbnb) pero tiene comisión bancaria sin confirmar — Min Price y Base Price GLOBALES quedan bloqueados igual', () => {
  const {discounts, verification} = readyCatalogExcept('direct-bank-fee');
  const model = compute(config({discounts, verification}));
  assert.equal(model.floorChId, 'airbnb', 'precondicion del test: Airbnb debe ser quien fija el Piso hoy, no Directo');
  assert.equal(model.readiness.byChannel.airbnb.ready, true, 'Airbnb (el canal que fija hoy) esta perfectamente confirmado');
  assert.equal(model.readiness.byChannel.direct.ready, false, 'Directo tiene su comision bancaria sin confirmar');
  assert.equal(model.floorReadinessBlocked, true, 'el Piso GLOBAL debe bloquearse aunque el canal que lo fija hoy este confirmado, porque Directo podria pasar a fijarlo');
  assert.match(model.floorReadinessBlockedReason, /Directo/);
  assert.match(model.floorReadinessBlockedReason, /GLOBAL/);
  assert.equal(model.baseReadinessBlocked, true, 'lo mismo aplica al Base Price global');
  assert.match(model.baseReadinessBlockedReason, /Directo/);
});

test('P1: al confirmar TAMBIÉN el dato pendiente de Directo (aunque Directo no fije el número hoy), el Piso/Base global se desbloquean', () => {
  const {discounts, verification} = readyCatalogExcept('direct-bank-fee');
  verification.bankFeePctByChannel.direct.status = 'verificado'; // ahora TODOS confirmados
  const model = compute(config({discounts, verification}));
  assert.equal(model.readiness.ready, true);
  assert.equal(model.floorReadinessBlocked, false);
  assert.equal(model.baseReadinessBlocked, false);
});

test('P1: unreadyChannels() es la fuente central — devuelve el canal pendiente aunque no sea el que fija Piso/Base, y [] si todo está resuelto', () => {
  const {discounts, verification} = readyCatalogExcept('direct-bank-fee');
  const readiness = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification});
  const unready = unreadyChannels(readiness, freshChannels());
  assert.equal(unready.length, 1);
  assert.equal(unready[0].id, 'direct');
  verification.bankFeePctByChannel.direct.status = 'verificado';
  const readiness2 = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification});
  assert.deepEqual(unreadyChannels(readiness2, freshChannels()), []);
});

test('P1: globalRecommendationReady() combina readiness + lmBlocked + baseBlocked en una sola regla — cualquiera de los tres bloquea el global', () => {
  const {discounts, verification} = readyCatalogExcept('direct-bank-fee');
  const readiness = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification});
  // Solo el dato de negocio pendiente:
  assert.equal(globalRecommendationReady({readiness, channels: freshChannels(), lmBlocked:false, baseBlocked:false}).ready, false);
  // Todo resuelto salvo LM:
  verification.bankFeePctByChannel.direct.status = 'verificado';
  const readinessAllDone = evaluateRecommendationReadiness({channels: freshChannels(), discounts, verification});
  assert.equal(globalRecommendationReady({readiness: readinessAllDone, channels: freshChannels(), lmBlocked:true, baseBlocked:false}).ready, false, 'LM sin verificar tambien debe bloquear el global');
  assert.equal(globalRecommendationReady({readiness: readinessAllDone, channels: freshChannels(), lmBlocked:false, baseBlocked:true}).ready, false, 'precio fijo activo tambien debe bloquear el global');
  assert.equal(globalRecommendationReady({readiness: readinessAllDone, channels: freshChannels(), lmBlocked:false, baseBlocked:false}).ready, true, 'con los tres gates resueltos, el global queda listo');
});

test('P1: Matriz — "RENTABLE EN TODOS" sigue bloqueado si un canal AJENO a la ventana peor caso tiene un dato pendiente (regresion del refactor a unreadyChannels compartido)', () => {
  const channels = generousChannelsWithOneOffset();
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const verification = defaultVerification();
  const lmConfig = {mode:'flat', verified:true, flat:{pct:20, fromDay:0, toDay:3, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:20, varCost:0, lmConfig, verification};
  const model = compute({...qConfig, margin:10, marketBase:0});
  const w5 = windows.find(w=>w.id==='w5');
  const ceil = ceilings[w5.id];
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w5, model.effBase || 150);
  const {vTag} = buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.notEqual(vTag, 'RENTABLE EN TODOS');
});

test('P1: las simulaciones/diagnósticos POR CANAL siguen disponibles pese al gate global — readiness.byChannel de un canal confirmado sigue en ready:true aunque el global (floorReadinessBlocked) esté bloqueado por otro canal', () => {
  const {discounts, verification} = readyCatalogExcept('direct-bank-fee');
  const model = compute(config({discounts, verification}));
  assert.equal(model.floorReadinessBlocked, true, 'precondicion: el global esta bloqueado por Directo');
  assert.equal(model.readiness.byChannel.airbnb.ready, true, 'Airbnb sigue disponible para simulacion/diagnostico individual pese al bloqueo global');
  assert.equal(model.readiness.byChannel.booking.ready, true);
  assert.equal(model.readiness.byChannel.expedia.ready, true);
});

test('isVerified()/defaultVerification(): unidad nueva arranca 100% no_verificado, nunca verificado por defecto (ninguna clave, ni global ni por canal)', () => {
  const v = defaultVerification();
  assert.equal(isVerified(v, 'hospyOffsetIsolated'), false);
  assert.equal(isVerified(v, 'bookingGeniusMobileBoth'), false);
  assert.equal(isVerified(v, 'expediaVipTierMix'), false);
  assert.equal(isVerified(v, 'airbnbNonRefundable'), false);
  ['airbnb','booking','expedia','direct'].forEach(chId=>{
    assert.equal(isVerified(v, 'bankFeePctByChannel', chId), false);
  });
});
