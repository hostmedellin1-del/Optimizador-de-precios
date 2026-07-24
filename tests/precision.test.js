/* Fase 2.1 — evidencia de precisión financiera. Dos regresiones puntuales pedidas
   por Dani en la revisión de Fase 2:

   1. `totalPct` (redondeado a 1 decimal, ver combineChannel() en engine.js) NUNCA
      debe alimentar un cálculo de dinero — solo `factor` (exacto). Caso real que
      lo demuestra: Booking Genius 0.1% + Mobile 50% da un descuento EXACTO de
      50.05% (factor=0.4995), pero Math.round((1-0.4995)*1000)/10 da 50.0 por
      ruido de punto flotante (500.499999999... redondea hacia abajo). Un Piso
      dimensionado con ese 50.0% netea por debajo del costo real.

   2. Las alertas por ventana ya NO muestrean un punto medio (`Math.min(w.lo+1,
      w.hi)`) — enumeran todos los días críticos DENTRO de la ventana. Caso real:
      un early-bird de Airbnb activo desde el día 90 debe detectarse dentro de la
      ventana "30+ días", no solo en el día 31 (el punto medio viejo). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {combineChannel, compute} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

const CH_TAB = {airbnb:'ch-airbnb', booking:'ch-booking', expedia:'ch-expedia', direct:'ch-direct'};

test('precisión — Booking Genius 0.1% + Mobile 50%: el descuento exacto es 50.05%, el Piso debe protegerse con eso, no con 50.0% redondeado', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  // Aislar: Booking debe ser inequívocamente el canal que fija el piso en este caso.
  findDiscount(discounts, 'ab_los4').on = false;
  findDiscount(discounts, 'ex_mod').on = false;
  findDiscount(discounts, 'bk_gen').pct = 0.1;
  findDiscount(discounts, 'bk_mob').pct = 50;

  const r = combineChannel(discounts, 'booking', 1, 1);
  assert.equal(r.factor, 0.4995, 'factor exacto de Genius(0.1%) x Mobile(50%) debe ser 0.4995');
  // Este assert documenta el bug de redondeo en sí (no es lo que debe usarse para dinero):
  // confirma que Math.round((1-factor)*1000)/10 da 50, no 50.05 — la prueba de abajo
  // falla si el motor usara este valor redondeado en vez de `factor`.
  assert.equal(Math.round((1-r.factor)*1000)/10, 50, 'documentando el bug: totalPct redondeado da 50.0, no 50.05 (ruido de punto flotante)');

  const cost = 100;
  const model = compute({fixedCost: cost, varCost: 0, margin: 0, marketBase: 0, channels, discounts, windows});
  assert.equal(model.floorCh.slice(0, 8), 'Booking.', 'Booking debe ser el canal que fija el Piso en este escenario aislado');

  // Cotizar AL PISO exactamente en el escenario que lo determina (constant kind:
  // Genius/Mobile aplican a cualquier día/noche), con techo=0 para neutralizar el LM
  // (ver quote-consistency.test.js para por qué techo bajo, no alto, aísla el Piso).
  const zeroCeilings = Object.fromEntries(windows.map(w => [w.id, 0]));
  const q = quoteScenario({chId: 'booking', days: 1, nights: 1, price: model.floor}, {channels, discounts, windows, ceilings: zeroCeilings, fixedCost: cost, varCost: 0});
  assert.ok(q.payout >= cost - 1e-6, `el Piso (${model.floor.toFixed(4)}) debe netear >= costo exacto (${cost}) en Booking; dio ${q.payout.toFixed(4)} — si el motor usara 50.0% redondeado en vez de 50.05% exacto, esto falla por ~$0.37`);
});

test('alertas — ventana "30+ días" debe detectar el escenario real de día 90 (early-bird 50%), no solo el punto medio (día 31)', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  discounts.forEach(d => { if (d.ch === 'airbnb') d.on = false; }); // aislar: apagar todo lo demás de Airbnb
  const eb3 = findDiscount(discounts, 'ab_eb3');
  eb3.on = true;
  eb3.pct = 50; // catálogo ya trae from:90, to:9999

  const ceilings = defaultCeilings(windows); // w5 ("30+ días") ceil=15 por defecto
  const model = compute({fixedCost: 70, varCost: 0, margin: 45, marketBase: 0, channels, discounts, windows});
  const alerts = buildAlerts({discounts, channels, ceilings, marketWindow: 16, marketBase: 0, windows, chTab: CH_TAB, currency: 'USD', margin: 45}, model);

  const w5Alerts = alerts.filter(a => a.msg && a.msg.includes('30+ días'));
  assert.ok(w5Alerts.length > 0, 'debe haber al menos una alerta para la ventana "30+ días"');
  assert.ok(w5Alerts.some(a => a.msg.includes('día 90')),
    `la alerta de "30+ días" debe mencionar explícitamente el día 90 (el peor caso real, donde arranca el early-bird de 50%) — no puede quedarse en el día 31 (punto medio viejo). Alertas encontradas: ${JSON.stringify(w5Alerts.map(a => a.msg))}`);
});
