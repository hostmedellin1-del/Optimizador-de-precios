/* BUG REAL (sep 2026, "objetivo por duración") — misma familia que el fix del
   VALOR del Piso y de "bajo costo" contra q.cost, pero del lado del OBJETIVO
   (costo + margen), no del costo puro.

   `compute()` calculaba UN SOLO `net` (engine.js: `net = cost/(1-m/100)`)
   evaluado SIEMPRE contra el costo de 1 noche, y `alerts.js`/`matrix.js`
   usaban ese mismo número fijo como vara para juzgar reservas de CUALQUIER
   duración (ramas "warn"/"cubre costo pero bajo objetivo" de DURACIÓN,
   ESTADÍA CORTA y el veredicto de Matriz). El dueño confirmó que el margen es
   un PORCENTAJE que se aplica sobre el costo REAL de esa duración — no que el
   25% deba cambiar según las noches, sino que ese 25% se aplica sobre el
   costo real de esa duración, nunca sobre el costo de 1 noche.

   `netForNightFn(margin)` (src/domain/costs.js) es la fuente única del
   objetivo por duración: dado el costo YA calculado de un escenario concreto
   (`q.cost`), devuelve `costo/(1-margen/100)` — misma fórmula que `net` en
   engine.js, parametrizada por costo en vez de fijada a 1 noche.

   `model.net` (KPI global de Resumen) NO cambia de semántica — sigue siendo
   el objetivo de 1 noche. Lo que cambia es contra qué se compara una reserva
   de OTRA duración en alerts.js/matrix.js. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {netForNightFn, reservationCostBreakdown} from '../src/domain/costs.js';
import {compute} from '../src/domain/engine.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {worstScenariosInWindow, buildMatrixVerdict} from '../src/domain/matrix.js';
import {WINDOWS} from '../src/catalog/discounts.js';
import {unit902Config} from './helpers/state-factory.js';

/* Tabla exacta reproducida contra el respaldo real
   (revenue-ops-backup-2026-08-14.json, unidad 902), verificada de forma
   independiente con reservationCostBreakdown() antes de escribir este test:
   costBreakdown = {rent:700, admin:140, utilities:108, insurance:5, tech:22,
   occNights:26, cleaning:20, laundry:5, consumables:4, supplies:5} — fijos
   975/26=37.5/noche + consumo 4/noche = 41.5/noche, más 30 de turno
   (cleaning+laundry+supplies) UNA VEZ por reserva. costo(n) = 41.5 + 30/n.
   margen 25% ⇒ objetivo(n) = costo(n)/0.75. */
test('netForNightFn(25) reproduce exacto la tabla del respaldo real de la 902 (2/7/14/21/28/35 noches)', () => {
  const costBreakdown = {rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26, cleaning:20, laundry:5, consumables:4, supplies:5};
  const netForNight = netForNightFn(25);
  const casos = [
    {n:2,  costoEsperado:56.50, objetivoEsperado:75.33},
    {n:7,  costoEsperado:45.79, objetivoEsperado:61.05},
    {n:14, costoEsperado:43.64, objetivoEsperado:58.19},
    {n:21, costoEsperado:42.93, objetivoEsperado:57.24},
    {n:28, costoEsperado:42.57, objetivoEsperado:56.76},
    {n:35, costoEsperado:42.36, objetivoEsperado:56.48}
  ];
  casos.forEach(({n, costoEsperado, objetivoEsperado})=>{
    const costo = reservationCostBreakdown(costBreakdown, n).perNight;
    const objetivo = netForNight(costo);
    assert.ok(Math.abs(costo-costoEsperado)<0.01, `costo a ${n} noches: esperado ~${costoEsperado}, dio ${costo.toFixed(4)}`);
    assert.ok(Math.abs(objetivo-objetivoEsperado)<0.01, `objetivo a ${n} noches: esperado ~${objetivoEsperado}, dio ${objetivo.toFixed(4)}`);
  });
});

test('netForNightFn: el objetivo de 1 noche coincide EXACTO con model.net (mismo costo, mismo margen — cero regresión del KPI global)', () => {
  const costBreakdown = {rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26, cleaning:20, laundry:5, consumables:4, supplies:5};
  const netForNight = netForNightFn(25);
  const costo1 = reservationCostBreakdown(costBreakdown, 1).perNight;
  assert.equal(costo1, 71.5);
  assert.ok(Math.abs(netForNight(costo1)-95.3333)<0.001, `netForNight(costo de 1 noche) debe ser el objetivo fijo de siempre (95.33): dio ${netForNight(costo1)}`);
});

test('netForNightFn: margen se clampea a 90 (misma regla que engine.js `net = cost/(1-m/100)`)', () => {
  const netForNight = netForNightFn(500); // margen absurdo, debe clampear a 90
  assert.ok(Math.abs(netForNight(10) - 100) < 1e-9, `con margen clampeado a 90, objetivo(10) debe ser 100 (10/0.10): dio ${netForNight(10)}`);
});

/* Reproducción completa contra la config REAL de producción de la 902
   (unit902Config(), extraída del respaldo real por tests/helpers/state-factory.js,
   con las tarifas de aseo confirmadas por el dueño: Expedia 35, Booking 37.50
   — Airbnb ya trae 20/25 del fixture). Antes del fix, esto generaba 8 alertas
   falsas ("cubre costo pero bajo objetivo") en reservas que en realidad SÍ
   superan su objetivo real: Airbnb 4/7/14/21/28/35 noches, Expedia 7 noches
   (DURACIÓN) y Airbnb 2 noches (ESTADÍA CORTA). Verificado de forma
   independiente antes de este test corriendo buildAlerts() contra este mismo
   fixture: las 8 desaparecen y NINGUNA otra alerta DURACIÓN/ESTADÍA CORTA
   aparece en su lugar. */
function config902(){
  const config = unit902Config();
  Object.assign(config.channels.find(c=>c.id==='expedia'), {cleanFee:35});
  Object.assign(config.channels.find(c=>c.id==='booking'), {cleanFee:37.5});
  return config;
}
const CH_TAB = {airbnb:'ch-airbnb', booking:'ch-booking', expedia:'ch-expedia', direct:'ch-direct'};
function alertsFor(config, model, extra={}){
  return buildAlerts({
    discounts: config.discounts, channels: config.channels, ceilings: config.ceilings,
    windows: config.windows, marketWindow: 9, marketBase: config.marketBase||0,
    chTab: CH_TAB, currency: 'USD', margin: config.margin,
    lmConfig: config.lmConfig, floor: model.floor, minPrice: model.floor,
    fixedCost: config.fixedCost, varCost: config.varCost,
    costBreakdown: config.costBreakdown, costBreakdownConfirmed: config.costBreakdownConfirmed,
    ...extra
  }, model);
}

test('CASO REAL 902 — las 8 alertas DURACIÓN/ESTADÍA CORTA falsas desaparecen; ninguna otra aparece en su lugar', () => {
  const config = config902();
  const model = compute(config);
  const modelConBase = {...model, effBase: 103}; // el Base real que el dueño tiene puesto
  const alerts = alertsFor(config, modelConBase);
  const duracionYEstadiaCorta = alerts.filter(a=>a.tag==='DURACIÓN' || a.tag==='ESTADÍA CORTA');
  assert.equal(duracionYEstadiaCorta.length, 0,
    `no debe quedar ninguna alerta DURACIÓN/ESTADÍA CORTA con el respaldo real de la 902 (todas las duraciones netean sobre su objetivo real):\n${duracionYEstadiaCorta.map(a=>a.lvl+' '+a.tag+' | '+a.msg).join('\n')}`);
});

test('CASO REAL 902 — model.net (KPI global de Resumen) NO se movió: sigue siendo el objetivo de 1 noche', () => {
  const config = config902();
  const model = compute(config);
  assert.ok(Math.abs(model.net-95.3333)<0.001, `model.net debe seguir siendo 95.33 (71.50/0.75) — dio ${model.net}`);
  assert.equal(model.cost, 71.5, 'model.cost sigue siendo el costo de 1 noche, sin cambios');
});

test('CASO REAL 902 — el Piso (compute().floor) no se movió con este fix: sigue en ~77.10 (fix del VALOR del Piso, rama base, sin tocar)', () => {
  const config = config902();
  const model = compute(config);
  assert.ok(Math.abs(model.floor-77.10)<0.01, `este fix es SOLO del objetivo/margen, nunca del Piso ni del costo — floor debe seguir en 77.10, dio ${model.floor.toFixed(2)}`);
});

/* Alerta DURACIÓN — genuina cuando la reserva SÍ queda bajo su objetivo real
   (no solo bajo el fijo de 1 noche). Guarda contra el falso NEGATIVO: el fix
   no puede haber apagado la alerta por completo, solo corregido la vara. */
test('DURACIÓN sigue disparándose cuando la reserva realmente queda bajo SU objetivo real (no el de 1 noche)', () => {
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:5, minN:10, on:true}]; // descuento chico a propósito
  const windows = [{id:'w0', label:'todo', lo:0, hi:9999, ceil:100}];
  const ceilings = {w0:100};
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  // turno 20 (se diluye) + 40/noche fijo: costo(1)=60, costo(10)=42.
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:1, cleaning:20, laundry:0, supplies:0, consumables:40};
  const config = {channels, discounts, windows, ceilings, lmConfig, costBreakdown, costBreakdownConfirmed:true, fixedCost:0, varCost:0, margin:25, marketBase:0};
  const model = compute(config);
  assert.equal(model.cost, 60);
  // Precio 55: 10 noches con 5% off netea 52.25; costo real a 10 noches es 42,
  // objetivo real = 42/0.75 = 56. 52.25 < 56 (bajo objetivo real) Y 52.25 > 42 (cubre costo).
  const alerts = alertsFor(config, {...model, effBase: 55}, {marketWindow: 16, minPrice: 0});
  const duracion = alerts.find(a=>a.tag==='DURACIÓN');
  assert.ok(duracion, `debe seguir existiendo una alerta DURACIÓN genuina (netea bajo su objetivo real de 56): ${JSON.stringify(alerts.map(a=>a.tag))}`);
  assert.equal(duracion.lvl, 'warn', `cubre costo (42) pero queda bajo el objetivo real (56) — debe ser warn, dio ${duracion.lvl}`);
  assert.match(duracion.msg, /objetivo para esa duración/, 'el mensaje debe hablar del objetivo de ESA duración, no de un número fijo');
});

/* matrix.js — buildMatrixVerdict() debe usar el mismo objetivo por duración
   que alerts.js, no `model.net` a secas. Escenario sintético (mismo patrón
   que tests/matrix-costo-por-duracion.test.js): un solo canal, turno grande
   que se diluye con las noches, margen 50%.
     1 noche  → costo 100, precio 250, sin descuento → payout 250, margen 150
     20 noches → costo 5 (100/20), descuento 80% → payout 50, margen 45 (PEOR)
   model.net (objetivo de 1 noche) = 100/0.5 = 200. El objetivo REAL de 20
   noches = 5/0.5 = 10. payout(20n)=50 está POR DEBAJO de 200 pero POR ENCIMA
   de 10 — antes esto se marcaba "CUBRE COSTO, BAJO OBJETIVO" (falso positivo,
   comparado contra 200); con el fix, netea sobre su objetivo real y no debe
   quedar marcado así. */
test('buildMatrixVerdict — "CUBRE COSTO, BAJO OBJETIVO" se decide contra el objetivo de ESA duración, no contra model.net (1 noche)', () => {
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:80, minN:20, on:true}];
  const windows = [{id:'w0', label:'todo', lo:0, hi:9999, ceil:100}];
  const ceilings = {w0:100};
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:1, cleaning:100, laundry:0, supplies:0, consumables:0};
  const config = {channels, discounts, windows, ceilings, lmConfig, costBreakdown, costBreakdownConfirmed:true, fixedCost:0, varCost:0, margin:50, marketBase:0};
  const model = compute(config);
  assert.equal(model.cost, 100);
  assert.ok(Math.abs(model.net-200)<1e-9, `objetivo de 1 noche = 100/0.5 = 200, dio ${model.net}`);

  const {worstTecho, perChannel} = worstScenariosInWindow(config, windows[0], 250);
  const direct = perChannel.find(p=>p.chId==='direct');
  assert.equal(direct.night, 20, `el peor MARGEN debe caer en la reserva de 20 noches — dio ${direct.night}`);
  assert.ok(Math.abs(direct.q.payout-50)<1e-9, `payout a 20 noches debe ser 50 (250*0.2), dio ${direct.q.payout}`);
  assert.ok(Math.abs(direct.q.cost-5)<1e-9, `costo a 20 noches debe ser 5 (100/20), dio ${direct.q.cost}`);

  const v = buildMatrixVerdict({model, ceil:100, worstTecho, perChannel, currency:'USD'});
  assert.notEqual(v.vTag, 'CUBRE COSTO, BAJO OBJETIVO',
    `payout (50) supera el objetivo REAL de 20 noches (5/0.5=10) — no debe marcarse bajo objetivo solo por quedar bajo el objetivo de 1 noche (200). Dio "${v.vTag}": ${v.vMsg}`);
});

test('buildMatrixVerdict — sigue marcando "CUBRE COSTO, BAJO OBJETIVO" cuando el escenario SÍ queda bajo su propio objetivo real', () => {
  /* Mismo escenario pero con un precio más bajo: 20 noches con 80% off sobre
     100 → payout 20, costo 5, objetivo real 10. 20 >= 10 → todavía rentable.
     Se baja el descuento a 60% para que el objetivo real (10) SÍ supere el
     payout: precio 100, 20 noches con 60% off → payout 40 > costo 5 (cubre
     costo) pero... hace falta un caso donde falle el objetivo real, no solo
     el fijo. Se usa un margen más alto (80%) para que el objetivo real suba:
     objetivo real(20n) = 5/(1-0.8) = 25. payout 20n = 250*0.2 = 50 > 25 aún
     rentable — se baja el precio a 120: payout 20n = 120*0.2 = 24 < 25. */
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:80, minN:20, on:true}];
  const windows = [{id:'w0', label:'todo', lo:0, hi:9999, ceil:100}];
  const ceilings = {w0:100};
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:1, cleaning:100, laundry:0, supplies:0, consumables:0};
  const config = {channels, discounts, windows, ceilings, lmConfig, costBreakdown, costBreakdownConfirmed:true, fixedCost:0, varCost:0, margin:80, marketBase:0};
  const model = compute(config);

  const {worstTecho, perChannel} = worstScenariosInWindow(config, windows[0], 120);
  const direct = perChannel.find(p=>p.chId==='direct');
  assert.equal(direct.night, 20);
  assert.ok(Math.abs(direct.q.payout-24)<1e-9, `payout a 20 noches debe ser 24 (120*0.2), dio ${direct.q.payout}`);
  assert.ok(Math.abs(direct.q.cost-5)<1e-9);
  // objetivo real a 20 noches = 5/(1-0.8) = 25 > payout 24 => genuinamente bajo objetivo.
  const v = buildMatrixVerdict({model, ceil:100, worstTecho, perChannel, currency:'USD'});
  assert.equal(v.vTag, 'CUBRE COSTO, BAJO OBJETIVO',
    `payout (24) queda bajo el objetivo REAL de esa duración (25) — debe seguir marcándose. Dio "${v.vTag}": ${v.vMsg}`);
  assert.match(v.vMsg, /objetivo.*duración|duración.*objetivo/i, `el mensaje debe hablar del objetivo de esa duración: ${v.vMsg}`);
});
