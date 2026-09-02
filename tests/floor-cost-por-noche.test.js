/* BUG REAL confirmado por Dani con costos reales de la unidad 902 (Alcázar de
   Oviedo): reservationCostBreakdown() ya calcula bien que 1 noche cuesta
   USD 71.50/noche (aseo+lavandería+insumos, fijos por reserva) mientras que
   27 noches cuesta solo USD 42.61/noche (esos mismos fijos se diluyen entre
   más noches) — pero worstScenarioFactor() (src/domain/worstcase.js) recibía
   `cost` como un NUMERO FIJO único (el costo de 1 noche) y lo aplicaba a
   TODAS las duraciones que prueba en su búsqueda, incluida una de 27 noches.
   Eso infla artificialmente el Piso: con el catálogo real de la 902, el Piso
   daba ≈138.69 (Airbnb, día 0, 27 noches) — muy por encima del mercado real
   (~USD 92 en PriceLabs), la señal de que algo estaba mal.

   Fix: `cost` ahora acepta también una FUNCION `(nights)=>number` (el costo
   REAL de esa duración, via costForNightFn() en costs.js) — con eso, el Piso
   corregido da ≈108.18 (Expedia, día 0, 1 noche). Ver worstcase.js y
   engine.js para el detalle del fix. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {reservationCostBreakdown, costForNightFn} from '../src/domain/costs.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

/* ---------- Caso real, unidad 902 ---------- */

function unit902Config(){
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const setCh = (id, patch) => Object.assign(channels.find(c=>c.id===id), patch);
  const setD = (id, patch) => {
    const d = discounts.find(x=>x.id===id);
    if(!d) throw new Error('discount id no encontrado en el catalogo: '+id);
    Object.assign(d, patch);
  };

  setCh('airbnb',  {comm:15.5, offsetPct:16, bankFeePct:0, cleanFeeShort:20, cleanFeeLong:25});
  setCh('booking', {comm:21,   offsetPct:75, bankFeePct:6});
  setCh('expedia', {comm:25,   offsetPct:70, bankFeePct:0});
  setCh('direct',  {comm:3,    offsetPct:5,  bankFeePct:6});

  setD('ab_los2', {pct:14, on:true});             // ≥7 noches
  setD('ab_los3', {pct:14, on:true});              // ≥14 noches
  setD('ab_los4', {pct:25, on:true});              // ≥28 noches (ya es el default del catálogo)
  setD('ab_los5', {pct:10, on:true, minN:4});       // ≥4 noches
  setD('ab_los6', {pct:15, on:true, minN:21});      // ≥21 noches
  setD('ab_los7', {pct:21, on:true, minN:35});      // ≥35 noches
  setD('ab_eb2',  {pct:15, on:true});               // ≥60 días
  setD('ab_topguest', {pct:15, on:true});

  setD('bk_gen', {pct:10, on:true});                // Genius
  setD('bk_mob', {pct:10, on:true});                // Mobile
  setD('bk_cty', {pct:5,  on:true});                // Country

  setD('ex_mod',  {pct:20, on:true});               // VIP (siempre activa)
  setD('ex_mob',  {pct:10, on:true});                // Mobile-only
  setD('ex_los1', {pct:15, on:true});               // ≥7 noches

  const costBreakdown = {
    rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26,
    cleaning:20, laundry:5, consumables:4, supplies:5
  };

  const lmConfig = {
    ...defaultLmConfig(),
    mode:'gradual', verified:true,
    gradual:{maxPct:28, days:6, on:true}
  };

  const ceilings = {w0:40, w1:30, w2:15, w3:0, w4:0, w5:15};

  return {
    channels, discounts, windows,
    costBreakdown, costBreakdownConfirmed:true,
    lmConfig, ceilings, margin:25,
    fixedCost:0, varCost:0
  };
}

test('costos reales de la 902: reservationCostBreakdown confirma 71.50/noche a 1 noche y ≈42.61/noche a 27', () => {
  const cb = unit902Config().costBreakdown;
  assert.ok(Math.abs(reservationCostBreakdown(cb, 1).perNight - 71.5) < 1e-9);
  assert.ok(Math.abs(reservationCostBreakdown(cb, 27).perNight - 42.61111111111111) < 1e-9);
});

test('CASO OBLIGATORIO 902 — Piso corregido: ≈108.18 (Expedia, 1 noche), YA NO ≈138.69 (Airbnb, 27 noches)', () => {
  const config = unit902Config();
  const model = compute(config);

  assert.equal(model.costBlocked, false, 'los costos detallados estan confirmados, no deben bloquear');
  assert.equal(model.lmBlocked, false, 'LM gradual verificado no deben bloquear');

  // El numero VIEJO (bug, costo fijo de 1 noche aplicado a 27 noches) ya NO debe salir.
  assert.ok(Math.abs(model.floor - 138.68912932933407) > 1, `el Piso NO debe seguir dando el numero viejo inflado (~138.69) — dio ${model.floor}`);

  // El numero CORREGIDO: Expedia, 1 noche, ~108.18.
  assert.equal(model.floorChId, 'expedia', `el canal que fija el Piso corregido debe ser Expedia, no ${model.floorChId}`);
  assert.ok(model.floorCh.includes('1 noche'), `el motivo del Piso debe citar 1 noche, no una estadia larga — dio "${model.floorCh}"`);
  assert.ok(Math.abs(model.floor - 108.1759864439603) < 0.05, `el Piso corregido debe ser ~108.18 — dio ${model.floor}`);
});

test('CASO OBLIGATORIO 902 — por canal: Airbnb 91.02 / Booking 90.92 / Expedia 108.18 / Directo 103.93 (el maximo, Expedia, protege)', () => {
  const config = unit902Config();
  const {channels, discounts, windows, ceilings, lmConfig, costBreakdown} = config;
  const costForNight = costForNightFn(costBreakdown, true, 71.5);

  const expected = {airbnb:91.01783949654133, booking:90.91729831936514, expedia:108.1759864439603, direct:103.93046107331823};
  for(const c of channels){
    const {worstFactor, worstFeePerNight, worstDay, worstNight, pf} = worstScenarioFactor({
      chId:c.id, channels, discounts, windows, ceilings, lmConfig, cost: costForNight
    });
    // el offset del canal ya esta incluido dentro de worstFactor (worstScenarioFactor lo aplica internamente)
    const p = worstFactor>0
      ? (worstFeePerNight>0 ? Math.max(0, 71.5/pf-worstFeePerNight)/worstFactor : 71.5/(worstFactor*pf))
      : Infinity;
    assert.equal(worstDay, 0, `${c.id}: dia critico esperado 0, dio ${worstDay}`);
    assert.equal(worstNight, 1, `${c.id}: noche critica esperada 1, dio ${worstNight}`);
    assert.ok(Math.abs(p - expected[c.id]) < 0.05, `${c.id}: precio requerido esperado ~${expected[c.id]}, dio ${p}`);
  }
});

/* ---------- Guarda de no-regresion: cost como NUMERO da EXACTAMENTE lo mismo
   que antes (mismo resultado que si `cost` fuera constante) ---------- */

test('no-regresion — worstScenarioFactor(cost:numero) es identico a worstScenarioFactor(cost: ()=>ese numero)', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};

  for(const chId of ['airbnb','booking','expedia','direct']){
    const asNumber = worstScenarioFactor({chId, channels, discounts, windows, ceilings, lmConfig, cost: 71.5});
    const asConstFn = worstScenarioFactor({chId, channels, discounts, windows, ceilings, lmConfig, cost: () => 71.5});
    assert.deepEqual(asConstFn, asNumber, `${chId}: pasar cost como funcion constante debe dar EXACTAMENTE lo mismo que pasarlo como numero`);
  }
});

test('no-regresion — sin cost (undefined), el comportamiento de siempre (busqueda solo por factor) no cambia', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};
  const result = worstScenarioFactor({chId:'direct', channels, discounts, windows, ceilings, lmConfig});
  assert.equal(result.worstFactor, 0.5);
  assert.equal(result.worstDay, 0);
  assert.equal(result.worstNight, 1);
});

/* ---------- Test sintetico aislado: solo el mecanismo, sin el catalogo real ----------
   Un canal con un costo por turno grande (100) concentrado en pocas noches
   (se diluye entre las noches de la reserva) + un descuento por duracion que
   SI es mas profundo en la estadia larga (60% desde 20 noches) — a proposito,
   para reproducir el mismo patron que el bug real: con el costo VIEJO (numero
   fijo, el mismo de 1 noche aplicado a cualquier duracion), el descuento mas
   profundo de la estadia larga hace que el precio requerido ahi parezca mayor
   — el peor caso "gana" por error, no porque de verdad cueste mas. Con el
   costo REAL por noche (funcion), la estadia corta (donde el costo real por
   noche es mucho mas alto: 110 vs 15 a 20 noches) vuelve a ser el peor caso
   real, tal como debe ser. */
test('sintetico — worstNight con costo real (funcion) elige la estadia CORTA (costo real/noche mas alto), no la larga por un descuento mas profundo bajo un costo asumido constante', () => {
  const channels = [{id:'direct', name:'Directo', comm:0, offsetPct:0, bankFeePct:0}];
  const discounts = [{id:'d1', ch:'direct', kind:'los', group:'any', pct:60, minN:20, on:true}];
  const windows = [{id:'w0', label:'x', lo:0, hi:9999, ceil:0}];
  const ceilings = {};
  const lmConfig = {mode:'flat', verified:true, flat:{pct:0, fromDay:0, toDay:3, on:false}}; // LM constante (0) en todas las duraciones

  const FIXED_TURNO = 100, VAR_PER_NIGHT = 10;
  const costFn = (n) => FIXED_TURNO/n + VAR_PER_NIGHT; // costo real por noche: 110 a 1 noche, 15 a 20 noches, 10.25 a 400 noches

  // Con el costo VIEJO (numero fijo = el de 1 noche aplicado a TODAS las duraciones):
  // el descuento de 60% en >=20 noches hace que el precio requerido ahi (110/0.4=275)
  // supere al de la estadia corta (110/1=110) — el peor caso "elegido" es la larga,
  // exactamente el patron del bug real (Airbnb, 27 noches, en la 902).
  const withFlatCost = worstScenarioFactor({chId:'direct', channels, discounts, windows, ceilings, lmConfig, cost: costFn(1)});
  assert.equal(withFlatCost.worstNight, 20, 'con costo fijo (viejo comportamiento), el descuento mas profundo de la estadia larga infla el precio requerido ahi y "gana" el peor caso');

  // Con el costo REAL por noche (funcion): la estadia corta cuesta 110/noche real,
  // muchisimo mas que los ~15-25/noche de la larga (incluso con su descuento) —
  // el peor caso real vuelve a ser la estadia corta.
  const withRealCost = worstScenarioFactor({chId:'direct', channels, discounts, windows, ceilings, lmConfig, cost: costFn});
  assert.equal(withRealCost.worstNight, 1, 'con el costo real por noche, la estadia corta (costo real mas alto) es el peor caso, no la larga');
  assert.equal(withRealCost.worstFactor, 1, 'a 1 noche no aplica el descuento de duracion (minN:20), el factor nativo es 1 (sin descuento)');
});
