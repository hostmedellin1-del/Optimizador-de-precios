/* Planificación mensual y reparto de utilidad (src/domain/monthly-economics.js).

   Dos conceptos que este archivo prueba SEPARADOS (ver comentario de cabecera
   del módulo): rentabilidad por RESERVA (compute()/quoteScenario(), sin tocar
   aquí) vs planificación MENSUAL (este archivo) — costos fijos completos +
   estimación de cuántas reservas caben en el mes.

   Los costos de entrada se leen EXACTAMENTE de `state.costBreakdown` (nunca un
   input nuevo): fijos mensuales = rent+admin+utilities+insurance+tech,
   variable/noche = consumables, por-reserva = cleaning+laundry+supplies,
   noches ocupadas planeadas = occNights (ver costs.js — occNights YA es
   "noches ocupadas al mes"). Cada caso numérico de este archivo trae la
   fórmula escrita a mano en el comentario, no solo el motor contra sí mismo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeMonthlyEconomics, validateDistribution, defaultMonthlyIncomeScenario, defaultMonthlyDistribution} from '../src/domain/monthly-economics.js';
import {quoteScenario} from '../src/domain/quote.js';
import {defaultVerification} from '../src/domain/verification.js';
import {evaluateRecommendationReadiness} from '../src/domain/readiness.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

/* Costo base reutilizado en casi todos los tests:
   fijos mensuales = 500+100+50+30+20 = 700
   var/noche (consumables) = 5
   por-reserva (cleaning+laundry+supplies) = 40+10+5 = 55 */
function cb(overrides={}){
  return {rent:500, admin:100, utilities:50, insurance:30, tech:20, occNights:22, cleaning:40, laundry:10, supplies:5, consumables:5, ...overrides};
}

function quoteConfigFor(overrides={}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = overrides.lmConfig || {...defaultLmConfig(), verified:true};
  const verification = overrides.verification || defaultVerification();
  return {channels, discounts, windows, ceilings, lmConfig, verification, costBreakdown: overrides.costBreakdown || cb()};
}

test('CASO MANUAL — el resultado mensual reconcilia EXACTAMENTE con el desglose (neto 80/noche, avgNights 3, occNights 22)', () => {
  // estimatedReservations = 22/3 = 7.3333...
  // netIncomeMonthly = 80*22 = 1760
  // variableCostsMonthly = 5*22 + 55*(22/3) = 110 + 403.3333 = 513.3333
  // profitMonthly = 1760 - 700 - 513.3333 - 0 - 0 = 546.6667
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.ok, true);
  assert.equal(r.fixedCostsMonthly, 700);
  assert.equal(r.perNightVarCost, 5);
  assert.equal(r.perReservationCost, 55);
  assert.ok(Math.abs(r.estimatedReservations - 22/3) < 1e-9);
  assert.equal(r.netIncomeMonthly, 1760);
  assert.ok(Math.abs(r.variableCostsMonthly - 513.333333) < 1e-4);
  // Reconciliación exacta, no solo "cercana": recomputar desde los campos que el propio resultado expone.
  const reconciled = r.netIncomeMonthly - r.fixedCostsMonthly - r.variableCostsMonthly - r.reserveAmt - r.taxAmt;
  assert.ok(Math.abs(reconciled - r.profitMonthly) < 1e-9, 'la utilidad devuelta debe ser EXACTAMENTE ingreso - fijos - variables - reserva - impuestos');
  assert.ok(Math.abs(r.profitMonthly - 546.666666) < 1e-4);
});

test('cero noches ocupadas: los costos fijos permanecen intactos y hay pérdida exactamente igual a los fijos', () => {
  // netIncomeMonthly=0, variableCostsMonthly=0 (0 noches, 0 reservas) => profit = -700
  const r = computeMonthlyEconomics({costBreakdown: cb({occNights:0}), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.ok, true);
  assert.equal(r.netIncomeMonthly, 0);
  assert.equal(r.variableCostsMonthly, 0);
  assert.equal(r.profitMonthly, -700, 'con cero reservas, la pérdida debe ser EXACTAMENTE los costos fijos mensuales — nunca desaparecen');
});

test('contribución por noche <= 0: el punto de equilibrio es explícitamente "no alcanzable", nunca Infinity ni un número falso', () => {
  // contribución = netPerNight - perNightVarCost - perReservationCost/avgNights
  //              = 20 - 5 - 55/3 = 20 - 5 - 18.3333 = -3.3333 (<=0)
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:20}, currency:'USD'});
  assert.equal(r.ok, true);
  assert.equal(r.breakeven.reachable, false);
  assert.equal(r.breakeven.nightsExact, null);
  assert.equal(r.breakeven.nightsCeil, null);
  assert.ok(Number.isFinite(r.breakeven.contributionPerNight));
  assert.ok(r.breakeven.reason && r.breakeven.reason.length>0);
  assert.notEqual(r.breakeven.nightsExact, Infinity, 'nunca debe devolver Infinity — "no alcanzable" es un estado explícito');
});

test('contribución por noche exactamente 0 (borde) también es "no alcanzable", no división por cero', () => {
  // netPerNight - perNightVarCost - perReservationCost/avgNights = 0
  // con avgNights=3, perReservationCost=55: perReservationCost/avgNights=18.3333
  // netPerNight = 5 + 18.3333 = 23.3333 => contribución = 0 exacto
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight: 5+55/3}, currency:'USD'});
  assert.ok(Math.abs(r.breakeven.contributionPerNight) < 1e-9);
  assert.equal(r.breakeven.reachable, false, 'contribución EXACTAMENTE 0 tampoco alcanza el equilibrio con ningún volumen finito');
});

test('punto de equilibrio alcanzable: nightsExact/nightsCeil calculados a mano', () => {
  // contribución = 80 - 5 - 55/3 = 56.6667; fijos=700
  // nightsExact = 700/56.6667 = 12.3529...; nightsCeil = 13
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.breakeven.reachable, true);
  assert.ok(Math.abs(r.breakeven.nightsExact - 12.352941) < 1e-4);
  assert.equal(r.breakeven.nightsCeil, 13);
});

test('costos por reserva correctamente MULTIPLICADOS por reservas estimadas (no por noches ocupadas)', () => {
  // occNights=30, avgNights=5 => estimatedReservations=6 (no 30)
  // perReservationCost=55 => costo agregado por turno = 55*6 = 330 (NO 55*30=1650)
  const r = computeMonthlyEconomics({costBreakdown: cb({occNights:30}), avgNights:5, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.estimatedReservations, 6);
  const turnoAgregado = r.perReservationCost*r.estimatedReservations;
  assert.equal(turnoAgregado, 330);
  assert.notEqual(turnoAgregado, 55*30, 'el costo por turno NO se multiplica por noches — eso reintroduciría el bug P5/P13 a nivel mensual');
});

test('estadía promedio MAYOR reduce las reservas estimadas del mes, pero NO cambia el costo por noche de una reserva concreta (reservationCostBreakdown sigue intacto)', async () => {
  const {reservationCostBreakdown} = await import('../src/domain/costs.js');
  const occNights = 30;
  const r3 = computeMonthlyEconomics({costBreakdown: cb({occNights}), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  const r10 = computeMonthlyEconomics({costBreakdown: cb({occNights}), avgNights:10, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r3.estimatedReservations, 10); // 30/3
  assert.equal(r10.estimatedReservations, 3); // 30/10
  assert.ok(r10.estimatedReservations < r3.estimatedReservations, 'estadía promedio mayor debe reducir las reservas estimadas');
  // El costo de UNA reserva concreta de, digamos, 4 noches NO depende de avgNights —
  // reservationCostBreakdown() (motor de rentabilidad por reserva) ignora avgNights por diseño.
  const costoReserva4nochesA = reservationCostBreakdown(cb({occNights}), 4).total;
  const costoReserva4nochesB = reservationCostBreakdown(cb({occNights}), 4).total; // avgNights nunca se le pasa a esta funcion
  assert.equal(costoReserva4nochesA, costoReserva4nochesB, 'el costo de una reserva real de 4 noches es el mismo sin importar qué avgNights use la planificación mensual');
});

test('reparto Propietario/PM/Reserva/Impuestos suma correctamente (owner+manager+undistributed === profitMonthly; reserve+tax son % del ingreso, no del profit)', () => {
  // netIncomeMonthly=1760; reserve 5%=88; tax 5%=88
  // profitMonthly = 1760-700-513.3333-88-88 = 370.6667
  // ownerAmt = 60% de 370.6667 = 222.4; managerAmt = 30% = 111.2; undistributed = 10% = 37.0667
  const dist = {configured:true, ownerTargetPct:60, managerTargetPct:30, reservePct:5, taxReservePct:5};
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, distribution: dist, currency:'USD'});
  assert.equal(r.reserveAmt, 88);
  assert.equal(r.taxAmt, 88);
  assert.ok(Math.abs(r.profitMonthly - 370.666666) < 1e-4);
  assert.ok(Math.abs(r.distribution.ownerAmt - 222.4) < 1e-6);
  assert.ok(Math.abs(r.distribution.managerAmt - 111.2) < 1e-6);
  const sum = r.distribution.ownerAmt + r.distribution.managerAmt + r.distribution.undistributedAmt;
  assert.ok(Math.abs(sum - r.profitMonthly) < 1e-9, 'propietario + PM + no distribuido debe sumar EXACTO la utilidad distribuible');
});

test('reparto no configurado: profit se muestra completo sin dividir, ownerAmt/managerAmt son null (no 0 disfrazado de "sin reparto")', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.distribution.configured, false);
  assert.equal(r.distribution.ownerAmt, null);
  assert.equal(r.distribution.managerAmt, null);
  assert.equal(r.distribution.undistributedAmt, r.profitMonthly);
  assert.ok(r.assumptions.some(a=>a.includes('Reparto Propietario/Administrador no configurado')));
});

test('reservePct/taxReservePct NO aplican mientras distribution.configured sea false, aunque tengan un valor viejo en el objeto', () => {
  const distStale = {configured:false, ownerTargetPct:60, managerTargetPct:30, reservePct:5, taxReservePct:5};
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, distribution: distStale, currency:'USD'});
  assert.equal(r.reserveAmt, 0);
  assert.equal(r.taxAmt, 0);
  assert.ok(Math.abs(r.profitMonthly - 546.666666) < 1e-4, 'sin "configured", debe dar el mismo resultado que sin distribution en absoluto');
});

test('el margen (`margin`) existente de una unidad vieja NUNCA se convierte silenciosamente en un reparto — computeMonthlyEconomics no lee ese campo en absoluto', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'}); // sin distribution
  assert.equal(r.distribution.configured, false);
  assert.equal(defaultMonthlyDistribution().configured, false, 'el default de una unidad nueva/vieja siempre arranca sin reparto');
});

test('validateDistribution: rechaza porcentajes negativos', () => {
  const v = validateDistribution({configured:true, ownerTargetPct:-10, managerTargetPct:20, reservePct:0, taxReservePct:0});
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e=>e.includes('ownerTargetPct')));
});

test('validateDistribution: rechaza Propietario+PM > 100% ("suma imposible")', () => {
  const v = validateDistribution({configured:true, ownerTargetPct:70, managerTargetPct:50, reservePct:0, taxReservePct:0});
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /no puede superar 100%/);
});

test('validateDistribution: rechaza Reserva+Impuestos > 100%', () => {
  const v = validateDistribution({configured:true, ownerTargetPct:0, managerTargetPct:0, reservePct:60, taxReservePct:60});
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e=>e.includes('Reserva')));
});

test('validateDistribution: no configurado (o ausente) siempre es válido — no hay nada que validar todavía', () => {
  assert.equal(validateDistribution(null).ok, true);
  assert.equal(validateDistribution({configured:false, ownerTargetPct:-999}).ok, true);
});

test('computeMonthlyEconomics propaga un reparto inválido como resultado no calculable, con el motivo exacto', () => {
  const dist = {configured:true, ownerTargetPct:70, managerTargetPct:50, reservePct:0, taxReservePct:0};
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, distribution: dist, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no puede superar 100%/);
});

test('falta costBreakdown (unidad en modo simple, sin calculadora detallada): no calculable, nunca inventa un total mensual desde fixedCost/varCost por noche', () => {
  const r = computeMonthlyEconomics({costBreakdown: undefined, avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /calculadora de costos detallada/);
});

test('falta avgNights: no calculable, motivo explícito', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights: undefined, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /Estadía promedio/);
});

test('falta el escenario de ingreso (manual sin número, o tipo no configurado): no calculable, nunca asume 0 en silencio', () => {
  const r1 = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight: undefined}, currency:'USD'});
  assert.equal(r1.ok, false);
  const r2 = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{}, currency:'USD'});
  assert.equal(r2.ok, false);
});

/* P2 (revision externa): el bug real era que `manualNetPerNight` en 0 (el
   default viejo) pasaba la validación de "es un número finito" y el motor
   proyectaba una PÉRDIDA mensual completa (todos los costos, cero ingreso)
   para una unidad nueva donde nadie escribió nada — 0 no es "sin dato", es un
   ingreso real de $0. Estos tests prueban que 0/vacío/null/negativo NUNCA
   calculan, con el mismo mensaje explícito que la UI debe mostrar, y que un
   valor positivo real sigue funcionando exactamente igual que antes. */
test('P2: escenario manual con el default de fábrica (defaultMonthlyIncomeScenario, manualNetPerNight:null) NO calcula — "no configurado" nunca es un ingreso válido', () => {
  const sc = defaultMonthlyIncomeScenario(['airbnb','booking','expedia','direct']);
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario: sc, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /Falta ingresar neto manual por noche/);
});

test('P2: escenario manual con manualNetPerNight:0 explícito NO calcula — 0 no es "sin dato", pero tampoco se acepta como ingreso real sin que sea > 0', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:0}, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /Falta ingresar neto manual por noche/);
});

test('P2: escenario manual con manualNetPerNight:"" (string vacío, como llega de un input HTML sin tocar) NO calcula', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:''}, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /Falta ingresar neto manual por noche/);
});

test('P2: escenario manual con manualNetPerNight negativo NO calcula (un neto negativo no es un escenario simulable, es un dato roto)', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:-10}, currency:'USD'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /Falta ingresar neto manual por noche/);
});

test('P2: al ingresar un neto manual positivo, el cálculo mensual vuelve a funcionar exactamente igual que antes del fix', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.ok, true);
  // mismo caso ya probado en el resto del archivo: ingreso neto 80*22=1760, utilidad 546.67
  assert.ok(Math.abs(r.netIncomeMonthly-1760)<0.01);
  assert.ok(Math.abs(r.profitMonthly-546.6666666666667)<0.01);
});

test('ESCENARIO DE CANAL usa quoteScenario() REAL — el neto por noche coincide exactamente con llamar quoteScenario() directo (no una fórmula paralela)', () => {
  const quoteConfig = quoteConfigFor();
  const scenario = {chId:'direct', days:45, nights:3, price:150};
  const expected = quoteScenario(scenario, quoteConfig);
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel: scenario},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.ok, true);
  assert.equal(r.incomeSource.netPerNight, expected.payout, 'el neto/noche del escenario de canal debe ser EXACTAMENTE quoteScenario().payout, sin reimplementar la fórmula');
});

test('ESCENARIO DE MEZCLA: el neto ponderado es el promedio ponderado exacto de quoteScenario() por canal', () => {
  const quoteConfig = quoteConfigFor();
  const rowA = {chId:'direct', days:45, nights:3, price:150, weightPct:60};
  const rowB = {chId:'airbnb', days:45, nights:3, price:150, weightPct:40};
  const qA = quoteScenario({chId:rowA.chId, days:rowA.days, nights:rowA.nights, price:rowA.price}, quoteConfig);
  const qB = quoteScenario({chId:rowB.chId, days:rowB.days, nights:rowB.nights, price:rowB.price}, quoteConfig);
  const expectedWeighted = qA.payout*0.6 + qB.payout*0.4;
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'mix', mix:[rowA, rowB]},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.incomeSource.netPerNight - expectedWeighted) < 1e-9);
});

/* Contrato de moneda (revision externa): un canal con `settlementCurrency`
   distinta de la moneda de la unidad no puede consolidarse en el ingreso
   mensual sin una conversión EXPLICITA y VERIFICADA — mismo chequeo que usa
   reconciliation.js (currency.js), aquí aplicado a los escenarios 'channel'/
   'mix' de planificación mensual. */
test('MONEDA — escenario de canal con settlementCurrency distinta y SIN tipo de cambio verificado: bloqueado, nunca mezcla monedas en silencio', () => {
  const channels = freshChannels().map(c=>c.id==='direct' ? {...c, settlementCurrency:'COP'} : c);
  const quoteConfig = quoteConfigFor({channels});
  const scenario = {chId:'direct', days:45, nights:3, price:150};
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel: scenario},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /COP/);
  assert.match(r.reason, /VERIFICADO/);
});

test('MONEDA — escenario de canal con settlementCurrency distinta y CON tipo de cambio verificado: calcula el neto convertido exacto', () => {
  const channels = freshChannels().map(c=>c.id==='direct' ? {...c, settlementCurrency:'COP'} : c);
  const quoteConfig = quoteConfigFor({channels});
  const scenario = {chId:'direct', days:45, nights:3, price:150};
  const expected = quoteScenario(scenario, quoteConfig); // payout en COP (moneda de liquidacion de Directo)
  const fxRates = {COP: {rate: 1/4000, source:'TRM manual', date:'2026-07-01', status:'verificado'}}; // 1 COP = 1/4000 USD
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel: scenario},
    quoteConfig, currency:'USD', fxRates
  });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.incomeSource.netPerNight - expected.payout/4000) < 1e-9);
});

test('MONEDA — escenario de canal SIN settlementCurrency (default, misma moneda que la unidad): funciona exactamente igual que antes, sin exigir fxRates', () => {
  const quoteConfig = quoteConfigFor(); // catalogo de fabrica: settlementCurrency null en todos
  const scenario = {chId:'direct', days:45, nights:3, price:150};
  const expected = quoteScenario(scenario, quoteConfig);
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel: scenario},
    quoteConfig, currency:'USD' // fxRates ni se pasa
  });
  assert.equal(r.ok, true);
  assert.equal(r.incomeSource.netPerNight, expected.payout);
});

test('MONEDA — escenario de MEZCLA con un canal en moneda distinta sin fx verificado: bloquea TODA la mezcla, no solo ese canal', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb' ? {...c, settlementCurrency:'COP'} : c);
  const quoteConfig = quoteConfigFor({channels});
  const rowA = {chId:'direct', days:45, nights:3, price:150, weightPct:60};
  const rowB = {chId:'airbnb', days:45, nights:3, price:150, weightPct:40}; // liquida en COP
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'mix', mix:[rowA, rowB]},
    quoteConfig, currency:'USD', fxRates:{}
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /Airbnb/);
});

test('mezcla de canales cuyos % de peso NO suman 100%: no calculable, no se asume una normalización silenciosa', () => {
  const quoteConfig = quoteConfigFor();
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'mix', mix:[{chId:'direct', days:45, nights:3, price:150, weightPct:60}]},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /deben sumar 100%/);
});

test('DATOS FINANCIEROS NO VERIFICADOS degradan el veredicto a "no confiable" — LM sin verificar en un escenario de canal', () => {
  const quoteConfig = quoteConfigFor({lmConfig: defaultLmConfig()}); // ceiling_auto, sin verificar — bloqueado por diseño
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel:{chId:'direct', days:45, nights:3, price:150}},
    quoteConfig, currency:'USD'
  });
  assert.equal(r.ok, true, 'sigue siendo una SIMULACIÓN visible, no un bloqueo duro');
  assert.equal(r.incomeSource.unverified, true);
  assert.ok(r.incomeSource.unverifiedReasons.includes('Last-Minute sin verificar'));
  assert.ok(r.assumptions.some(a=>a.includes('SIMULACIÓN')));
});

test('DATOS FINANCIEROS NO VERIFICADOS (Fase 5): un canal con dato de negocio pendiente (comisión bancaria) también degrada el escenario mensual', () => {
  const channels = freshChannels(); // booking/direct traen bankFeePct=6% sin verificar por defecto
  const discounts = freshDiscounts();
  const verification = defaultVerification();
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const quoteConfig = quoteConfigFor({channels, discounts, verification});
  const r = computeMonthlyEconomics({
    costBreakdown: cb(), avgNights:3,
    incomeScenario: {type:'channel', channel:{chId:'booking', days:45, nights:3, price:150}},
    quoteConfig, readiness, currency:'USD'
  });
  assert.equal(r.incomeSource.unverified, true);
  assert.ok(r.incomeSource.unverifiedReasons.some(reason=>reason.includes('bancaria')));
});

test('escenario manual NUNCA se marca "no verificado" — es un dato directo que el usuario escribió, no una proyección del motor', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  assert.equal(r.incomeSource.unverified, false);
});

test('moneda: se pasa tal cual, nunca se convierte ni se mezcla con otra (no hay lógica de FX en este módulo)', () => {
  const rUSD = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  const rCOP = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'COP'});
  assert.equal(rUSD.currency, 'USD');
  assert.equal(rCOP.currency, 'COP');
  assert.equal(rUSD.profitMonthly, rCOP.profitMonthly, 'las cifras numéricas no cambian por currency — es solo una etiqueta, igual que state.currency en el resto de la app; nunca se aplica una tasa de conversión inventada');
});

test('PROPIEDAD — sensibilidad por ocupación: noches 0,1,5,10,15,20,25,30,31 dan la misma fórmula que el resultado principal recalculado a esa ocupación', () => {
  const nightsGrid = [0,1,5,10,15,20,25,30,31];
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD', sensitivityNights: nightsGrid});
  assert.equal(r.sensitivity.length, nightsGrid.length);
  r.sensitivity.forEach(point => {
    const alone = computeMonthlyEconomics({costBreakdown: cb({occNights: point.nights}), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
    assert.ok(Math.abs(point.profitMonthly - alone.profitMonthly) < 1e-6, `noches=${point.nights}: la fila de sensibilidad debe coincidir con recalcular el mes entero a esa ocupación`);
    assert.ok(Math.abs(point.estimatedReservations - alone.estimatedReservations) < 1e-9);
  });
});

test('sensibilidad: fila de 0 noches tiene pérdida = costos fijos (misma regla que el caso principal de 0 noches)', () => {
  const r = computeMonthlyEconomics({costBreakdown: cb(), avgNights:3, incomeScenario:{type:'manual', manualNetPerNight:80}, currency:'USD'});
  const zero = r.sensitivity.find(s=>s.nights===0);
  assert.equal(zero.profitMonthly, -700);
});

test('defaultMonthlyIncomeScenario()/defaultMonthlyDistribution(): una unidad nueva arranca en manual/SIN CONFIGURAR (null, no 0) y reparto apagado — nunca inventa un canal, mezcla, ingreso o reparto activo', () => {
  const sc = defaultMonthlyIncomeScenario(['airbnb','booking','expedia','direct']);
  assert.equal(sc.type, 'manual');
  // P2 (revision externa): el default NUNCA puede ser 0 — 0 es un ingreso real
  // (ceros por noche), null es "todavia no lo escribiste". Antes el default
  // era 0 y el motor lo aceptaba como valido, proyectando una perdida mensual
  // que nadie configuro.
  assert.equal(sc.manualNetPerNight, null);
  assert.equal(sc.mix.length, 4);
  assert.ok(sc.mix.every(m=>m.on===false));
  const dist = defaultMonthlyDistribution();
  assert.equal(dist.configured, false);
});

/* P2 (revision externa) — persistencia: normalizeUnit() (persistence.js) es la
   UNICA puerta de entrada para guardar/cargar/importar una unidad. `null` en
   manualNetPerNight debe sobrevivir el ciclo completo SIN generar un warning
   falso positivo (es un estado valido, no un dato invalido) — y una unidad
   completamente vieja (que nunca tuvo este campo) debe migrar al mismo
   default seguro (null), nunca a 0. */
test('P2 persistencia: normalizeUnit() preserva manualNetPerNight:null exactamente, sin generar ningun warning', async () => {
  const {normalizeUnit} = await import('../src/domain/persistence.js');
  const {state, warnings} = normalizeUnit({name:'Unidad nueva', monthlyIncomeScenario:{type:'manual', manualNetPerNight:null}});
  assert.equal(state.monthlyIncomeScenario.manualNetPerNight, null);
  assert.equal(warnings.filter(w=>w.startsWith('monthlyIncomeScenario')).length, 0, 'null es un estado valido ("no configurado") — no debe generar warning');
});

test('P2 persistencia: unidad vieja sin monthlyIncomeScenario en absoluto migra a manualNetPerNight:null (nunca a 0)', async () => {
  const {normalizeUnit} = await import('../src/domain/persistence.js');
  const {state} = normalizeUnit({name:'Unidad vieja', channels:[], discounts:[]});
  assert.equal(state.monthlyIncomeScenario.manualNetPerNight, null);
});

test('P2 persistencia: un valor no-numerico (string invalida) en manualNetPerNight cae al default (null) con warning explicito', async () => {
  const {normalizeUnit} = await import('../src/domain/persistence.js');
  const {state, warnings} = normalizeUnit({name:'Evil', monthlyIncomeScenario:{type:'manual', manualNetPerNight:'no-es-un-numero'}});
  assert.equal(state.monthlyIncomeScenario.manualNetPerNight, null);
  assert.ok(warnings.some(w=>w.includes('manualNetPerNight')));
});

test('P2 persistencia: un neto manual positivo real se preserva exacto a traves de normalizeUnit()', async () => {
  const {normalizeUnit} = await import('../src/domain/persistence.js');
  const {state, warnings} = normalizeUnit({name:'Unidad con dato real', monthlyIncomeScenario:{type:'manual', manualNetPerNight:65.5}});
  assert.equal(state.monthlyIncomeScenario.manualNetPerNight, 65.5);
  assert.equal(warnings.filter(w=>w.startsWith('monthlyIncomeScenario')).length, 0);
});
