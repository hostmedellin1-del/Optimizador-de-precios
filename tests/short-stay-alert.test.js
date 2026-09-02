/* Fase 3 de usabilidad (ago 2026) — alerta ESTADIA CORTA (src/domain/alerts.js).

   Motivo real: Dani perdio plata con una reserva de 1 noche que le dejo un
   neto de USD 67 contra un costo real de USD 71.50 PARA ESA NOCHE (el aseo,
   la lavanderia y los insumos se pagan enteros aunque sea una sola noche) —
   ese dato nunca estuvo en pantalla. El bloque DURACION existente solo
   evalua el caso opuesto (estadias LARGAS); este es el caso donde de verdad
   se perdio plata. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {reservationCostBreakdown} from '../src/domain/costs.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

const CH_TAB = {airbnb:'ch-airbnb', booking:'ch-booking', expedia:'ch-expedia', direct:'ch-direct'};

function verifiedFlatLm(){
  return {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
}

function baseAlertsConfig(extra={}){
  const channels = extra.channels || freshChannels();
  const discounts = extra.discounts || freshDiscounts().map(d=>({...d, on:false}));
  const windows = extra.windows || freshWindows();
  const ceilings = extra.ceilings || defaultCeilings(windows);
  return {
    discounts, channels, windows, ceilings, marketWindow:16, marketBase:0,
    chTab:CH_TAB, currency:'USD', margin:45, lmConfig: verifiedFlatLm(),
    ...extra, discounts, channels, windows, ceilings
  };
}

const CB_902 = {rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26, cleaning:20, laundry:5, consumables:4, supplies:5};

test('reproduce la perdida real de la 902: el costo de 1 noche es exactamente 71.50', () => {
  const breakdown = reservationCostBreakdown(CB_902, 1);
  assert.equal(breakdown.perNight, 71.5);
  assert.equal(breakdown.total, 71.5);
});

test('con el desglose de la 902 confirmado y un precio que netea ~67, aparece una alerta bad ESTADIA CORTA', () => {
  const config = baseAlertsConfig({costBreakdown: CB_902, costBreakdownConfirmed: true, fixedCost:0, varCost:0});
  const model = compute({fixedCost:0, varCost:0, margin:45, marketBase:0, channels:config.channels, discounts:config.discounts, windows:config.windows, ceilings:config.ceilings, lmConfig:config.lmConfig, costBreakdown:CB_902, costBreakdownConfirmed:true});
  // Precio 74 en Directo (comisión 3% + banco 6%) da un neto de ~67.34 a 1 noche
  // (verificado con Node antes de este test) — reproduce el caso real.
  const modelWithEffBase = {...model, effBase: 74};
  const alerts = buildAlerts(config, modelWithEffBase);
  const bad = alerts.find(a => a.tag === 'ESTADÍA CORTA' && a.lvl === 'bad' && /Directo/.test(a.msg));
  assert.ok(bad, `debe existir una alerta bad ESTADÍA CORTA para Directo: ${JSON.stringify(alerts.map(a=>a.tag+':'+a.lvl))}`);
  assert.match(bad.msg, /1 noche/);
  // f$c formatea con centavos en es-CO ("71,50", coma como separador decimal) —
  // sin esto, el mensaje diría "USD 72" (redondeado) en vez del costo real 71.50.
  assert.match(bad.msg, /71,50/, 'el mensaje debe nombrar el costo real de esa noche con centavos (71,50), no redondeado a 72');
  assert.equal(bad.tab, 'ch-direct');
});

test('caso que motivó f$c: neto y costo que redondean al mismo entero deben verse como importes distintos', () => {
  // Con supplies:5.51 (en vez de 5), el costo real de 1 noche sube de 71.50 a
  // 72.01 — y con un precio de 78.57142857142858 en Directo, el neto de esa
  // misma noche da exactamente 71.50. f$ redondearía AMBOS a "USD 72" (el
  // mismo número para neto y costo), lo que haría parecer que la app tiene un
  // error ("netea 72 pero cuesta 72"). f$c debe mostrar 71,50 y 72,01: dos
  // importes distintos, con un hueco real de 0.51.
  const CB_close = {...CB_902, supplies: 5.51};
  const config = baseAlertsConfig({costBreakdown: CB_close, costBreakdownConfirmed: true, fixedCost:0, varCost:0});
  const model = compute({fixedCost:0, varCost:0, margin:45, marketBase:0, channels:config.channels, discounts:config.discounts, windows:config.windows, ceilings:config.ceilings, lmConfig:config.lmConfig, costBreakdown:CB_close, costBreakdownConfirmed:true});
  const modelWithEffBase = {...model, effBase: 78.57142857142858};
  const alerts = buildAlerts(config, modelWithEffBase);
  const bad = alerts.find(a => a.tag === 'ESTADÍA CORTA' && a.lvl === 'bad' && /Directo/.test(a.msg));
  assert.ok(bad, `debe existir una alerta bad ESTADÍA CORTA para Directo: ${JSON.stringify(alerts.map(a=>a.tag+':'+a.lvl))}`);
  assert.match(bad.msg, /USD 71,50/, 'el neto debe verse como 71,50');
  assert.match(bad.msg, /USD 72,01/, 'el costo debe verse como 72,01, distinto del neto');
  // Con f$ (sin centavos) ambos habrían dado "USD 72" — verificamos que el
  // mensaje NO contiene ese número redondeado ambiguo en ninguna de las dos
  // posiciones (ni como "netea USD 72" ni como "es USD 72").
  assert.doesNotMatch(bad.msg, /netea USD 72[^,0-9]/, 'el neto no debe mostrarse redondeado a USD 72 (perdería el centavo que distingue el caso)');
});

test('un canal cuyo neto a 1 noche SÍ cubre el costo (y el objetivo) no genera alerta ESTADÍA CORTA', () => {
  const config = baseAlertsConfig({costBreakdown: CB_902, costBreakdownConfirmed: true, fixedCost:0, varCost:0});
  const model = compute({fixedCost:0, varCost:0, margin:45, marketBase:0, channels:config.channels, discounts:config.discounts, windows:config.windows, ceilings:config.ceilings, lmConfig:config.lmConfig, costBreakdown:CB_902, costBreakdownConfirmed:true});
  // Precio alto (300): incluso con comisiones, el neto de 1/2 noches queda muy
  // por encima del costo real (71.50/49) y del objetivo.
  const modelWithEffBase = {...model, effBase: 300};
  const alerts = buildAlerts(config, modelWithEffBase);
  const direct = alerts.filter(a => a.tag === 'ESTADÍA CORTA' && /Directo/.test(a.msg));
  assert.equal(direct.length, 0, `no debe haber alerta ESTADÍA CORTA para Directo a precio alto: ${JSON.stringify(direct)}`);
});

test('no se duplican avisos de 1n y 2n del mismo canal — sólo se reporta el peor caso', () => {
  const config = baseAlertsConfig({costBreakdown: CB_902, costBreakdownConfirmed: true, fixedCost:0, varCost:0});
  const model = compute({fixedCost:0, varCost:0, margin:45, marketBase:0, channels:config.channels, discounts:config.discounts, windows:config.windows, ceilings:config.ceilings, lmConfig:config.lmConfig, costBreakdown:CB_902, costBreakdownConfirmed:true});
  const modelWithEffBase = {...model, effBase: 74}; // mismo precio del caso "bad" de arriba
  const alerts = buildAlerts(config, modelWithEffBase);
  const direct = alerts.filter(a => a.tag === 'ESTADÍA CORTA' && /Directo/.test(a.msg));
  assert.equal(direct.length, 1, `debe reportarse solo UNA alerta ESTADÍA CORTA para Directo (la peor, 1 noche), no una por cada duración: ${JSON.stringify(direct.map(a=>a.msg))}`);
  assert.match(direct[0].msg, /1 noche/, 'debe ser la de 1 noche (el peor caso), no la de 2');
});

test('no-regresión: TECHO y PISO siguen apareciendo igual en un caso que ya las disparaba (caso P3 del motor)', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  findDiscount(discounts, 'ex_mod').on = false; // aisla, igual que el test original de PISO
  const windows = freshWindows();
  const ceilings = Object.fromEntries(windows.map(w => [w.id, 5]));
  const model = compute({fixedCost: 64, varCost: 0, margin: 45, marketBase: 100, channels, discounts, windows});
  const alerts = buildAlerts({discounts, channels, ceilings, marketWindow: 16, marketBase: 100, windows, chTab: CH_TAB, currency: 'USD', margin: 45, fixedCost: 64, varCost: 0}, model);

  const pisoBooking = alerts.filter(a => a.tag === 'PISO' && /Booking/.test(a.msg));
  assert.ok(pisoBooking.length > 0, 'PISO para Booking debe seguir apareciendo igual que antes de agregar ESTADÍA CORTA');
  const techo = alerts.filter(a => a.tag === 'TECHO');
  assert.ok(techo.length > 0, 'TECHO debe seguir apareciendo igual');
  // La alerta nueva coexiste, no reemplaza a las anteriores.
  const estadiaCorta = alerts.filter(a => a.tag === 'ESTADÍA CORTA');
  assert.ok(estadiaCorta.length > 0, 'ESTADÍA CORTA también debe aparecer en este escenario (costo alto, precio de referencia bajo)');
});

test('no-regresión: DURACIÓN (estadía larga) y REALIDAD siguen apareciendo igual en un caso que ya las disparaba', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts(); // incluye ab_los4 (Larga estadía, on:true por defecto)
  const windows = freshWindows();
  const ceilings = Object.fromEntries(windows.map(w => [w.id, 5]));
  const marketBase = 150;
  const model = compute({fixedCost: 64, varCost: 0, margin: 45, marketBase, channels, discounts, windows, ceilings});
  const alerts = buildAlerts({discounts, channels, ceilings, marketWindow: 16, marketBase, windows, chTab: CH_TAB, currency: 'USD', margin: 45, fixedCost: 64, varCost: 0}, model);

  const duracion = alerts.filter(a => a.tag === 'DURACIÓN');
  assert.ok(duracion.length > 0, 'DURACIÓN (estadía larga) debe seguir apareciendo igual');
  const realidad = alerts.filter(a => a.tag === 'REALIDAD');
  assert.ok(realidad.length > 0, 'REALIDAD debe seguir apareciendo igual');
  const estadiaCorta = alerts.filter(a => a.tag === 'ESTADÍA CORTA');
  assert.ok(estadiaCorta.length > 0, 'ESTADÍA CORTA también debe aparecer en este escenario, sin desplazar a las anteriores');
});
