/* Fase 3 — evidencia explícita contra el modelo LEGADO, pedida por Dani en la
   aprobación de Fase 2 (regla 3): no basta con que reservationCost() tenga su
   propio contrato en verde (regression.test.js P5/P13) — hay que demostrar,
   lado a lado, que el modelo legado (costCalcTotals) SÍ divide la limpieza
   entre avgNights y que ESO es incorrecto para una reserva concreta. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {costCalcTotals} from '../src/domain/costs-legacy.js';
import {reservationCost, reservationCostBreakdown} from '../src/domain/costs.js';

test('legado vs correcto — costCalcTotals divide limpieza 90 entre avgNights=3 y da 30; eso es incorrecto para una reserva concreta de 1 noche', () => {
  const cb = {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:90, laundry:0, consumables:0, supplies:0};

  // 1. El modelo LEGADO (costCalcTotals) divide limpieza/avgNights y usa ESE
  //    PROMEDIO como si fuera el costo por noche de cualquier reserva.
  const legacy = costCalcTotals(cb, 3);
  assert.equal(legacy.turnoPerNight, 30, 'el legado da 90/3=30 — el promedio, no el costo real de una reserva concreta');

  // 2. Si ese promedio (30/noche) se usara para evaluar una reserva REAL de 1
  //    noche, el modelo legado subestima el costo de esa reserva por 60 (30
  //    facturados vs. 90 reales de limpieza) — la unidad se vendería creyendo
  //    que cubre costo cuando en realidad pierde plata en cada reserva de 1 noche.
  const legacyChargeFor1Night = legacy.turnoPerNight * 1;
  assert.equal(legacyChargeFor1Night, 30, 'el legado, aplicado a una reserva de 1 noche, solo carga 30 de limpieza');
  assert.notEqual(legacyChargeFor1Night, 90, 'y eso es incorrecto: la limpieza real de ESA reserva cuesta 90 completos, no 30');

  // 3. El modelo CORRECTO (reservationCost) carga la limpieza COMPLETA en la
  //    reserva de 1 noche que efectivamente la generó — sin importar avgNights.
  const correct1n = reservationCostBreakdown(cb, 1);
  assert.equal(correct1n.turnoTotal, 90, 'reservationCost debe cargar la limpieza completa (90) en la reserva de 1 noche que la generó');
  assert.equal(reservationCost(cb, {nights: 1}), 90, 'el costo total de la reserva de 1 noche (sin otros costos) debe ser 90, no 30');

  // 4. La brecha real entre "lo que el legado cree que cuesta" y "lo que cuesta
  //    de verdad" para esta reserva de 1 noche:
  const brechaLegadoVsReal = reservationCost(cb, {nights: 1}) - legacyChargeFor1Night;
  assert.equal(brechaLegadoVsReal, 60, 'el legado subestima el costo de una reserva de 1 noche en 60 (90 real - 30 que el legado creía) — esta es la plata que se pierde por reserva corta si el motor sigue usando el promedio diluido');

  // 5. Para una reserva larga (30 noches), el legado SOBRE-estima el costo de
  //    limpieza por noche (30/noche × 30 noches = 900), cuando en realidad la
  //    limpieza sigue siendo 90 total — el mismo bug, en la dirección opuesta.
  const legacyChargeFor30Nights = legacy.turnoPerNight * 30;
  assert.equal(legacyChargeFor30Nights, 900, 'el legado, extrapolado a 30 noches, "cobraría" 900 de limpieza');
  assert.equal(reservationCost(cb, {nights: 30}), 90, 'el costo real de limpieza de esa misma reserva de 30 noches sigue siendo 90 (una sola vez), no 900');
});
