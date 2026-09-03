/* Aseo del canal DIRECTO (sep 2026) — pedido textual del dueño: "dame un
   espacio para poder subir esos items de aseo para cada OTA".

   Hasta ahora Directo era el único de los cuatro canales sin tarifa de aseo:
   `cleanFeePerNight()` devolvía 0 siempre, el catálogo no tenía el campo y la
   pestaña del canal no tenía input. Eso NO era una regla de negocio — era un
   hueco: el dueño sí le cobra (o puede cobrarle) aseo al huésped que reserva
   directo, y ese 0 es la razón real de que Directo suela ser el canal que MANDA
   el Piso (los otros tres cobran aseo y él no).

   Contrato: mismo campo plano `cleanFee` que Booking/Expedia — una vez por
   reserva, diluido por noche. Directo no paga comisión de OTA, pero sí
   `bankFeePct`, y el aseo pasa por `payoutFactor()` exactamente igual que en los
   demás canales. Ninguna regla propia. Arranca en 0. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, cleanFeePerNight, payoutFactor} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {CHANNELS} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, unit902Config} from './helpers/state-factory.js';

test('catálogo — Directo trae cleanFee y arranca en 0 (nadie inventa un monto)', () => {
  const direct = CHANNELS.find(c=>c.id==='direct');
  assert.equal(direct.cleanFee, 0);
  // y sigue SIN los campos de Airbnb (su aseo no tiene tramos corto/largo)
  assert.equal('cleanFeeShort' in direct, false);
  assert.equal('cleanFeeLong' in direct, false);
});

test('dilución por noche — el mismo monto rinde menos por noche cuanto más larga la estadía', () => {
  const direct = {id:'direct', cleanFee:70};
  assert.equal(cleanFeePerNight(direct, 1), 70);
  assert.equal(cleanFeePerNight(direct, 2), 35);
  assert.equal(cleanFeePerNight(direct, 7), 10);
  assert.equal(cleanFeePerNight(direct, 14), 5);
  // el TOTAL por reserva es siempre el mismo: se cobra una sola vez
  for(const n of [1,2,7,14,30]) assert.equal(cleanFeePerNight(direct, n)*n, 70);
});

test('un Directo sin cleanFee configurado sigue aportando 0 — cero regresión para unidades viejas', () => {
  assert.equal(cleanFeePerNight({id:'direct'}, 1), 0);
  assert.equal(cleanFeePerNight({id:'direct', cleanFee:0}, 5), 0);
  assert.equal(cleanFeePerNight({id:'direct', cleanFee:''}, 5), 0);
});

test('quoteScenario — el aseo de Directo NO se descuenta con las promos, pero SÍ paga la comisión bancaria', () => {
  const channels = freshChannels().map(c=>({...c, offsetPct:0}));
  const direct = channels.find(c=>c.id==='direct');
  Object.assign(direct, {comm:3, bankFeePct:6, cleanFee:40});
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  // Last-minute directo 20% activo en días 0-3, para probar que el aseo queda fuera del descuento.
  const lm = discounts.find(d=>d.id==='di_lm');
  Object.assign(lm, {on:true, pct:20});
  const windows = freshWindows();
  const config = {channels, discounts, windows, ceilings: defaultCeilings(windows), fixedCost:0, varCost:0,
    lmConfig:{mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:0, on:false}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]}};

  const q = quoteScenario({chId:'direct', days:0, nights:1, price:100}, config);
  assert.equal(q.guest, 80, 'el 20% nativo aplica solo sobre el precio de la noche');
  assert.equal(q.feePerNight, 40, 'el aseo NO se descuenta con la promo');
  assert.equal(q.guestWithFees, 120);
  // payoutFactor = 1 - 3% - 6% = 0.91 sobre el TOTAL incluido el aseo
  assert.ok(Math.abs(q.payout - 120*payoutFactor(direct)) < 1e-12);
  assert.ok(Math.abs(q.payout - 109.2) < 1e-9, `payout esperado 109.20 — dio ${q.payout}`);
});

test('compute().floor — cobrar aseo en Directo BAJA el Piso de la 902 (deja de ser el canal sin aseo)', () => {
  const setFees = (config, directFee) => {
    Object.assign(config.channels.find(c=>c.id==='expedia'), {cleanFee:35});
    Object.assign(config.channels.find(c=>c.id==='booking'), {cleanFee:37.5});
    Object.assign(config.channels.find(c=>c.id==='airbnb'),  {cleanFeeShort:30, cleanFeeLong:25});
    Object.assign(config.channels.find(c=>c.id==='direct'),  {cleanFee:directFee});
    return config;
  };
  const sinAseoDirecto = compute(setFees(unit902Config(), 0));
  assert.equal(sinAseoDirecto.floorChId, 'direct', 'con el aseo de Airbnb alto, Directo manda el Piso justamente porque no cobra aseo');
  assert.ok(Math.abs(sinAseoDirecto.floor - 74.82993197278913) < 0.005);

  const conAseoDirecto = compute(setFees(unit902Config(), 25));
  assert.ok(conAseoDirecto.floor < sinAseoDirecto.floor, `cobrar aseo en Directo debe BAJAR el Piso (${sinAseoDirecto.floor} → ${conAseoDirecto.floor})`);
  assert.notEqual(conAseoDirecto.floorChId, 'direct', 'con aseo propio, Directo deja de ser el canal más ajustado');
});

test('el aseo de Directo pasa por payoutFactor igual que en los demás canales — no tiene regla propia', () => {
  /* Dos canales con la MISMA comisión total y el MISMO aseo deben exigir
     exactamente el mismo precio: si Directo tuviera una regla aparte (ej. no
     cobrarle comisión al aseo), este test fallaría. */
  const mk = (id) => ({id, name:id, comm:10, bankFeePct:5, offsetPct:0, cleanFee:30});
  assert.equal(cleanFeePerNight(mk('direct'), 3), cleanFeePerNight(mk('booking'), 3));
  assert.equal(payoutFactor(mk('direct')), payoutFactor(mk('booking')));
});
