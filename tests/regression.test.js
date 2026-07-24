/* Fase 1 de la auditoria tecnica (jul 2026): tests de regresion que reproducen los
   bugs YA CONFIRMADOS en el motor actual. Se escriben como el comportamiento
   CORRECTO esperado — no como "lo que el codigo hace hoy" — asi que varios de
   estos tests DEBIAN fallar en rojo en Fase 1. Eso fue intencional: probaban que
   el bug existia. NINGUNA expectativa/aserto se toco al pasar a Fase 2 — solo se
   corrigio la implementacion (engine.js/alerts.js/simulate.js) hasta que estos
   mismos tests, sin cambios, pasaron a verde.

   ESTADO FASE 2: los 6 tests requeridos (early-bird 90d, promo dia 0, proteccion
   del piso, propiedad exhaustiva, alerta PISO Booking con banco, simulador con
   dias/noches reales) estan en VERDE. El test de reservationCost() (P5/P13) sigue
   en ROJO A PROPOSITO — el modelo de costo a nivel de reserva es Fase 3, todavia
   no implementado; no se le puso ningun promedio ni atajo para "taparlo".

   No usar --skip ni ocultar ningun caso: un test rojo aqui es la prueba de que la
   auditoria tenia razon, y la referencia contra la que se mide la correccion. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combineChannel, worstNative, compute} from '../src/domain/engine.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {simulateReservation} from '../src/domain/simulate.js'; // Fase 2: reemplaza simulate-legacy.js (que se deja intacto como registro historico del bug P4)
import {costCalcTotals} from '../src/domain/costs-legacy.js';
import {reservationCost} from '../src/domain/costs.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount, baseConfig} from './helpers/state-factory.js';

/* ============================================================================
   CASO OBLIGATORIO 1 — Airbnb early-bird desde 90 dias al 50%
   ========================================================================== */
test('P1 — combineChannel: a 100 dias, early-bird >=90d al 50% SI debe aplicar 50%', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ab_eb3').on = true;
  findDiscount(discounts, 'ab_eb3').pct = 50;
  const r = combineChannel(discounts, 'airbnb', 100, 1);
  assert.equal(r.totalPct, 50, 'a 100 dias el 50% de ab_eb3 (>=90d) debe ser el unico aplicado');
});

test('P1 — worstNative: el peor caso de Airbnb debe detectar AL MENOS el 50% del early-bird de 90d', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ab_eb3').on = true;
  findDiscount(discounts, 'ab_eb3').pct = 50;
  const windows = freshWindows();
  const worst = worstNative(discounts, 'airbnb', windows);
  // BUG CONOCIDO (P1): worstNative() solo muestrea el punto medio de cada ventana
  // (dia 31 para "30+"), asi que nunca evalua el dia 90+ real y hoy devuelve 25%
  // (el 25% de "Larga estadia >=28 noches", que SI esta activa por defecto),
  // ignorando por completo el 50% real alcanzable a 100 dias. Este test debe fallar
  // HOY (rojo) y pasar despues del fix de Fase 2 (enumeracion exhaustiva de umbrales).
  assert.ok(worst >= 50, `worstNative('airbnb') debe ser >= 50, dio ${worst} — el piso no protege contra el early-bird de 90 dias`);
});

test('P1 — el Piso (compute().floor) debe proteger el caso del early-bird de 90d al 50%', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ab_eb3').on = true;
  findDiscount(discounts, 'ab_eb3').pct = 50;
  const channels = freshChannels();
  const windows = freshWindows();
  const cost = 100;
  const model = compute({fixedCost: cost, varCost: 0, margin: 45, marketBase: 0, channels, discounts, windows});
  // Si el piso protegiera de verdad, vender a `model.floor` en Airbnb con el 50%
  // aplicado (peor caso real) deberia netear >= cost. Con el bug, el piso se calcula
  // sobre un worstNative demasiado bajo (25%), asi que neteando al 50% real cae bajo costo.
  const airbnb = channels.find(c => c.id === 'airbnb');
  const netAt50 = model.floor * (1 - 0.5) * (1 - (airbnb.comm/100) - (airbnb.bankFeePct/100));
  assert.ok(netAt50 >= cost - 0.5, `vendiendo al Piso (${model.floor}) con el 50% real de descuento, el neto (${netAt50.toFixed(2)}) debe cubrir el costo (${cost}) — hoy no lo cubre porque el piso subestima el peor caso`);
});

/* ============================================================================
   CASO OBLIGATORIO 2 — Airbnb promocion 0-0 dias al 50% (dia 0 omitido)
   ========================================================================== */
test('P1 — combineChannel: a dia 0, una promo 0-0 dias al 50% SI debe aplicar', () => {
  const discounts = freshDiscounts();
  const promo = findDiscount(discounts, 'ab_lm1');
  promo.on = true; promo.from = 0; promo.to = 0; promo.pct = 50;
  const r = combineChannel(discounts, 'airbnb', 0, 1);
  assert.equal(r.totalPct, 50, 'a dia 0 la promo 0-0 dias al 50% debe ser la unica aplicada');
});

test('P1 — worstNative: debe detectar una promo configurada SOLO para el dia 0', () => {
  const discounts = freshDiscounts();
  // Apagamos Larga estadia (on por defecto) para aislar el caso: si esta prendida,
  // su 25% podria "tapar" el resultado incorrecto y dar un falso verde por otra razon.
  findDiscount(discounts, 'ab_los4').on = false;
  const promo = findDiscount(discounts, 'ab_lm1');
  promo.on = true; promo.from = 0; promo.to = 0; promo.pct = 50;
  const windows = freshWindows();
  const worst = worstNative(discounts, 'airbnb', windows);
  // BUG CONOCIDO (P1): worstNative() prueba el dia `Math.min(w.lo+1,w.hi)` para la
  // ventana "0-1 dia" (lo=0,hi=1) => dia 1, NUNCA el dia 0 exacto. Una promo con
  // `to:0` no aplica en dia 1 (1<=0 es falso), asi que el 50% queda invisible y
  // worstNative da 0 hoy. Debe fallar en rojo ahora, pasar tras el fix de Fase 2.
  assert.ok(worst >= 50, `worstNative('airbnb') debe ser >= 50 (promo del dia 0), dio ${worst}`);
});

/* ============================================================================
   CASO OBLIGATORIO 3 — Alerta PISO debe usar banco + OTA + offset + aseo
   Booking, precio de referencia 100, nativo 19% (Genius 10% + Mobile 10%),
   comision OTA 18%, comision bancaria 6%, costo 64 => neto real ~61.56 < costo.
   ========================================================================== */
test('P3 — Booking: neto real con banco (~61.56) queda bajo costo (64) — verificacion aritmetica del caso', () => {
  const channels = freshChannels();
  const booking = channels.find(c => c.id === 'booking');
  const discounts = freshDiscounts();
  const r = combineChannel(discounts, 'booking', 5, 1); // Genius+Mobile son 'constant', aplican a cualquier dia
  assert.equal(r.totalPct, 19, 'Genius 10% + Mobile 10% deben combinar a 19% (redondeado)');
  const guestPrice = 100 * (1 - r.totalPct/100);
  const netReal = guestPrice * (1 - booking.comm/100 - booking.bankFeePct/100);
  assert.ok(Math.abs(netReal - 61.56) < 0.5, `neto real esperado ~61.56, dio ${netReal.toFixed(2)}`);
  assert.ok(netReal < 64, 'el neto real debe quedar bajo el costo de 64');
});

test('P3 — buildAlerts DEBE emitir alerta PISO para Booking en el caso 100/19%/18%/6%/costo 64', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ex_mod').on = false; // aisla: sin el VIP de Expedia (20%, on por defecto) interfiriendo con el maxN/techo de otros canales
  const windows = freshWindows();
  // Techos deliberadamente bajos (5% en TODAS las ventanas): fuerzan breach en cada
  // una (el 19% nativo de Booking siempre supera 5%), asi que lm=0 SIEMPRE, sin
  // importar la ventana ni su techo real por defecto. Esto aisla el caso exacto del
  // bug: netAtBase deja de depender de la dinamica del LM y se reduce a
  // effBase*(1-nat)*(1-comision) — precisamente la formula a la que le falta el banco.
  const ceilings = Object.fromEntries(windows.map(w => [w.id, 5]));
  // marketBase=100 fuerza effBase=100 ("precio de referencia") sin depender de margen/base calculado.
  const model = compute({fixedCost: 64, varCost: 0, margin: 45, marketBase: 100, channels, discounts, windows});
  assert.equal(model.cost, 64);
  assert.equal(model.effBase, 100);
  const alerts = buildAlerts({discounts, channels, ceilings, marketWindow: 16, marketBase: 100, windows, chTab: {airbnb:'ch-airbnb',booking:'ch-booking',expedia:'ch-expedia',direct:'ch-direct'}, currency: 'USD', margin: 45}, model);
  // BUG CONOCIDO (P3): la alerta PISO calcula netAtBase = effBase*(1-lm)*(1-nat)*(1-comision),
  // SIN restar bankFeePct. Con lm=0 forzado en todas las ventanas, el neto "sin banco"
  // de Booking (100*0.81*0.82=66.42) queda POR ENCIMA de 64 en TODAS, aunque el neto
  // real (con banco, 61.56) este por debajo en todas. Hoy no hay ninguna alerta PISO
  // para Booking en ninguna ventana — este test debe fallar en rojo y pasar cuando la
  // alerta use la formula completa (Fase 2).
  const pisoBooking = alerts.filter(a => a.tag === 'PISO' && /Booking/.test(a.msg));
  assert.ok(pisoBooking.length > 0, 'debe existir al menos una alerta PISO mencionando a Booking (venta bajo costo por comision bancaria omitida)');
});

/* ============================================================================
   CASO OBLIGATORIO 4 — El simulador debe usar los dias/noches reales, no el
   punto medio de la ventana ni nights=1 fijo, para calcular el LM.
   ========================================================================== */
test('P4 — simulateReservation: el LM debe reflejar el descuento real a los dias/noches simulados, no el punto medio de la ventana', () => {
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ab_los4').on = false; // aislar: sin esto, su 25% se cuela igual en el punto medio (dia 31, noche 28)
  findDiscount(discounts, 'ex_mod').on = false; // aislar: sin esto, el VIP de Expedia (20%, constante) tapa el resultado con su propio numero
  findDiscount(discounts, 'ab_eb3').on = true;
  findDiscount(discounts, 'ab_eb3').pct = 50;
  const channels = freshChannels();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const s = simulateReservation(
    {channels, discounts, windows, ceilings, fixedCost: 0, varCost: 0},
    {price: 100, chId: 'airbnb', days: 100, nights: 1}
  );
  // BUG CONOCIDO (P4): `maxN` se calcula con dia=Math.min(w.lo+1,w.hi)=31 (no 100) y
  // nights=1 fijo — a dia 31 el early-bird de 90d no aplica (from:90), asi que maxN
  // da 0 hoy (con Expedia y los4 aislados) en vez de 50 (el real a dia 100). Este
  // test debe fallar en rojo hoy.
  assert.ok(s.maxN >= 50, `el LM del simulador debe considerar el 50% real disponible a 100 dias; maxN dio ${s.maxN}`);
});

/* ============================================================================
   CASO OBLIGATORIO 5 — costo por turno debe cobrarse UNA VEZ por reserva, no
   diluido por la estadia promedio para CUALQUIER reserva concreta.
   ========================================================================== */
test('P5/P13 — reservationCost: limpieza 90 con avgNights=3 debe cargar 90 TOTAL en una reserva de 1, 3 o 30 noches', () => {
  const cb = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:90, laundry:0, consumables:0, supplies:0};
  // PENDIENTE (Fase 3): reservationCost() aun no existe (lanza a proposito, ver
  // src/domain/costs.js). Este test falla HOY con ese error — es la prueba roja
  // que Fase 3 debe poner en verde implementando el costo a nivel de reserva.
  assert.equal(reservationCost(cb, {nights: 1, avgNights: 3}), 90, 'reserva de 1 noche debe cargar 90 de limpieza total, no 30 (90/avgNights)');
  assert.equal(reservationCost(cb, {nights: 3, avgNights: 3}), 90, 'reserva de 3 noches debe seguir cargando 90 total');
  assert.equal(reservationCost(cb, {nights: 30, avgNights: 3}), 90, 'reserva de 30 noches debe seguir cargando 90 total (no 900)');
});

test('P13 — costCalcTotals (legacy) documenta el bug de desincronizacion: NO es responsabilidad de esta funcion sincronizar avgNights con state.varCost', () => {
  // costCalcTotals() en si misma SI refleja avgNights correctamente en su propio
  // resultado (no tiene el bug) — el bug vive en el "pegamento" de index.html: el
  // handler de `data-cb` escribe `state.varCost` a partir de este resultado, pero
  // cambiar `avgNights` (data-k) NO vuelve a ejecutar ese calculo. Ver Fase 3.
  const cb = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:90, laundry:0, consumables:0, supplies:0};
  assert.equal(costCalcTotals(cb, 3).turnoPerNight, 30, 'con avgNights=3, costCalcTotals da 90/3=30 (el promedio, no el costo real de una reserva concreta)');
  assert.equal(costCalcTotals(cb, 2).turnoPerNight, 45, 'con avgNights=2, costCalcTotals da 90/2=45 — cambia con avgNights, pero index.html no siempre reescribe state.varCost cuando avgNights cambia (bug P13, vive fuera de esta funcion)');
});

/* ============================================================================
   PROPIEDAD — worstNative() nunca debe ser menor que cualquier escenario real
   enumerado explicitamente (dias y noches criticos).
   ========================================================================== */
test('propiedad — worstNative(chId) >= combineChannel(chId, dia, noche) para todos los dias/noches criticos', () => {
  const discounts = freshDiscounts();
  // Activar un espectro amplio de descuentos para estresar la enumeracion real. Se
  // apaga ab_los4 (on:true por defecto) a proposito: al ser prioridad 3 (duracion),
  // SIEMPRE le gana a early-bird (prioridad 4) en Airbnb sin importar el %, asi que
  // dejarlo prendido "tapa" el hueco exacto que el caso 1 encontro (early-bird de
  // 90d) y esta propiedad pasaria en falso-verde. Con los4 apagado, early-bird SI
  // queda expuesto a la enumeracion real de dias 90/91.
  findDiscount(discounts, 'ab_los4').on = false;
  findDiscount(discounts, 'ab_eb1').on = true;
  findDiscount(discounts, 'ab_eb2').on = true;
  findDiscount(discounts, 'ab_eb3').on = true;
  findDiscount(discounts, 'ab_los2').on = true;
  findDiscount(discounts, 'ab_los3').on = true;
  const windows = freshWindows();
  const days = [0,1,2,3,4,7,14,29,30,31,59,60,61,89,90,91];
  const nights = [1,2,3,6,7,13,14,27,28,29];
  const failures = [];
  for (const chId of ['airbnb','booking','expedia','direct']) {
    const worst = worstNative(discounts, chId, windows);
    for (const d of days) {
      for (const n of nights) {
        const real = combineChannel(discounts, chId, d, n).totalPct;
        if (real > worst + 1e-9) failures.push(`${chId} dia=${d} noches=${n}: real ${real}% > worstNative ${worst}%`);
      }
    }
  }
  // BUG CONOCIDO (P1): con el muestreo actual por punto medio, se esperan fallos
  // aqui — es la prueba de referencia (enumeracion exhaustiva) contra la que Fase 2
  // debe validar el reemplazo de worstNative(). Debe fallar en rojo hoy.
  assert.equal(failures.length, 0, `worstNative() no cubre estos escenarios reales:\n${failures.slice(0,10).join('\n')}${failures.length>10?`\n...y ${failures.length-10} mas`:''}`);
});
