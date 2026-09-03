/* BUG REAL (sep 2026) — las alertas PISO y DURACIÓN comparaban contra el costo
   de UNA noche escenarios de 27, 28 o 34 noches.

   Misma raíz que el fix del VALOR del Piso en compute() (ver
   tests/floor-aseo-monotonia.test.js): `model.cost` es el costo de 1 noche.
   `alerts.js` lo usaba como umbral de "vendes bajo costo" incluso cuando el
   escenario evaluado era una estadía larga, donde el costo real por noche de la
   902 es ~42,6 y no 71,50 (el aseo, la lavandería y los insumos se pagan una
   sola vez por reserva y se diluyen entre todas las noches).

   Con el respaldo real del dueño eso disparaba 7 alertas PISO falsas (una por
   ventana, más una segunda en la ventana 0–1) y marcaba en rojo dos descuentos
   por duración que en realidad cubren su costo.

   La alerta ESTADÍA CORTA (ago 2026) ya lo hacía bien con `q.cost` — el costo
   de ESE escenario, que quoteScenario() devuelve. Los otros dos bloques ahora
   hacen lo mismo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {unit902Config} from './helpers/state-factory.js';

const CH_TAB = {airbnb:'ch-airbnb', booking:'ch-booking', expedia:'ch-expedia', direct:'ch-direct'};

/* La 902 de producción, con las tarifas de aseo confirmadas por el dueño. */
function config902(){
  const config = unit902Config();
  Object.assign(config.channels.find(c=>c.id==='expedia'), {cleanFee:35});
  Object.assign(config.channels.find(c=>c.id==='booking'), {cleanFee:37.5});
  return config;
}

/* Mismo config que arma index.html en buildAlerts(): el de compute() + el tope
   de Min Price + los campos de costo. */
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

test('CASO REAL 902 — ninguna alerta PISO se dispara: en ninguna ventana hay un escenario que netee bajo SU propio costo', () => {
  const config = config902();
  const model = compute(config);
  const modelConBase = {...model, effBase: 103}; // el Base real que el dueño tiene puesto
  const alerts = alertsFor(config, modelConBase);
  const piso = alerts.filter(a=>a.tag==='PISO');
  assert.equal(piso.length, 0, `no debe quedar ninguna alerta PISO falsa; quedaron:\n${piso.map(a=>a.msg).join('\n')}`);
});

test('CASO REAL 902 — las alertas PISO falsas eran de estadías largas (27/34 noches) medidas contra el costo de 1 noche', () => {
  /* Se reproduce la comparación EQUIVOCADA a mano: si se usara `model.cost`
     (71,50) en vez del costo real del escenario, esas mismas ventanas volverían
     a dispararse. El test fija el diagnóstico, no solo el síntoma. */
  const config = config902();
  const model = compute(config);
  const modelConBase = {...model, effBase: 103};
  assert.equal(model.cost, 71.5, 'el costo de 1 noche de la 902 es 71.50');
  assert.ok(model.costForNight(27) < 43, 'el costo real de 27 noches ronda 42.6, no 71.50');

  /* Un modelo con `cost` inflado (el costo de 1 noche aplicado a todo) SIGUE
     sin disparar PISO, porque la comparación ya no lee `model.cost`. Esa es
     exactamente la garantía: el umbral es del escenario, no del modelo. */
  const modelConCostoInflado = {...modelConBase, cost: 71.5};
  const alerts = alertsFor(config, modelConCostoInflado);
  assert.equal(alerts.filter(a=>a.tag==='PISO').length, 0);
});

test('CASO REAL 902 — DURACIÓN: "Larga estadía (≥28 noches)" deja de marcarse en rojo (cubre su costo real de ~42,6)', () => {
  const config = config902();
  const model = compute(config);
  const alerts = alertsFor(config, {...model, effBase: 103});
  const largaEstadia = alerts.find(a=>a.tag==='DURACIÓN' && /Larga estadía/.test(a.msg));
  assert.ok(largaEstadia, 'la alerta de Larga estadía debe seguir existiendo (netea bajo el OBJETIVO)');
  assert.equal(largaEstadia.lvl, 'warn', `debe ser warn ("cubre costo, bajo objetivo"), no bad — dio ${largaEstadia.lvl}: ${largaEstadia.msg}`);
  const durBad = alerts.filter(a=>a.tag==='DURACIÓN' && a.lvl==='bad');
  assert.equal(durBad.length, 0, `ninguna alerta DURACIÓN debe quedar en rojo:\n${durBad.map(a=>a.msg).join('\n')}`);
});

test('la alerta PISO SÍ se dispara cuando un escenario netea bajo SU propio costo (no se volvió ciega)', () => {
  /* Guarda contra el falso negativo: se hunde el precio de referencia hasta que
     el peor escenario de verdad queda bajo costo. Si la alerta dejara de
     dispararse acá, el fix habría apagado la alerta en vez de corregirla.
     `minPrice:0` a propósito: con el tope del Min Price puesto en el propio Piso
     (lo que hace la app), el precio se sube hasta el Piso y por construcción
     ningún escenario queda bajo costo — esa es justamente la garantía del Piso.
     Acá se simula el caso en que ese tope no protege (un Last-Minute de PRECIO
     FIJO es el único que se salta el Min) para poder probar la comparación. */
  const config = config902();
  const model = compute(config);
  const alerts = alertsFor(config, {...model, effBase: 20}, {minPrice: 0});
  const piso = alerts.filter(a=>a.tag==='PISO');
  assert.ok(piso.length > 0, 'con un precio de referencia absurdamente bajo, PISO debe dispararse');
  /* Y el mensaje debe nombrar el costo del escenario, no el genérico. */
  assert.match(piso[0].msg, /el costo real de esa reserva de \d+ noches?/);
});

test('la alerta PISO elige el peor MARGEN, no el menor payout — una estadía larga con payout bajo pero rentable no puede tapar una corta que sí pierde', () => {
  /* Escenario sintético mínimo: un solo canal, sin descuentos, con un costo por
     turno grande (se diluye con las noches) y un descuento por duración que
     hunde el payout de la estadía larga. Con el criterio viejo (menor payout)
     el peor caso elegido era la larga, que cubre su costo — y la corta, que NO
     lo cubre, quedaba invisible. */
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:60, minN:20, on:true}];
  const windows = [{id:'w0', label:'todo', lo:0, hi:9999, ceil:100}];
  const ceilings = {w0:100};
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  // turno 100 + 10/noche: 110/noche a 1 noche, 15/noche a 20 noches.
  const costBreakdown = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:1, cleaning:100, laundry:0, supplies:0, consumables:10};
  const config = {channels, discounts, windows, ceilings, lmConfig, costBreakdown, costBreakdownConfirmed:true, fixedCost:0, varCost:0, margin:0, marketBase:0};
  const model = compute(config);
  assert.equal(model.cost, 110, 'costo de 1 noche = turno 100 + 10 de consumo');

  // Precio 100: 1 noche netea 100 < 110 (PIERDE). 20 noches netea 40 > 15 (gana).
  const alerts = alertsFor(config, {...model, effBase: 100}, {marketWindow: 16, minPrice: 0});
  const piso = alerts.filter(a=>a.tag==='PISO');
  assert.equal(piso.length, 1, `debe detectar la estadía corta que pierde plata: ${JSON.stringify(alerts.map(a=>a.tag))}`);
  assert.match(piso[0].msg, /1 noche\)/, `el escenario reportado debe ser el de 1 noche (el de peor margen), no el de 20 — dio: ${piso[0].msg}`);
});

test('salvaguarda — un caller que no pasa campos de costo NO apaga las alertas de "bajo costo" en silencio', () => {
  /* quoteScenario() deriva `q.cost` de fixedCost/varCost/costBreakdown. Un
     config sin esos campos daría `q.cost === 0` y TODA alerta de venta bajo
     costo desaparecería sin aviso — la peor falla posible acá. buildAlerts()
     rellena con `model.cost`, que en el modelo simple (este caso: sin desglose
     detallado) es exactamente el costo constante para cualquier duración, así
     que el relleno no es una aproximación.
     Este es también el caso que cubre tests/regression.test.js (P3), escrito en
     jul 2026 con un config parcial. */
  const config = {...config902(), costBreakdown: undefined, costBreakdownConfirmed: false, fixedCost: 64, varCost: 0};
  const model = compute(config);
  assert.equal(model.cost, 64, 'sin desglose, el costo es el flat fixedCost+varCost');

  const configCompleto = {
    discounts: config.discounts, channels: config.channels, ceilings: config.ceilings,
    windows: config.windows, marketWindow: 9, marketBase: 0, chTab: CH_TAB,
    currency: 'USD', margin: config.margin, lmConfig: config.lmConfig,
    floor: model.floor, minPrice: 0, fixedCost: 64, varCost: 0
  };
  const {fixedCost, varCost, ...configSinCostos} = configCompleto;

  const conCostos = buildAlerts(configCompleto, {...model, effBase: 20});
  const sinCostos = buildAlerts(configSinCostos, {...model, effBase: 20});
  assert.ok(conCostos.some(a=>a.tag==='PISO'), 'el caso de control debe disparar PISO');
  assert.deepEqual(sinCostos.map(a=>a.tag+'|'+a.lvl), conCostos.map(a=>a.tag+'|'+a.lvl),
    'omitir los campos de costo no puede cambiar ninguna alerta en el modelo simple');
});
