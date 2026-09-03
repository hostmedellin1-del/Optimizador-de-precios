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
   REAL de esa duración, via costForNightFn() en costs.js) — con eso, el peor
   caso pasó a ser Expedia, día 0, 1 noche. Ver worstcase.js y engine.js para
   el detalle del fix.

   SEGUNDA CORRECCIÓN (sep 2026, fix Piso vs Min Price): aquel fix dejó el Piso
   en ≈108.18, un número que seguía siendo imposible — quedaba POR ENCIMA del
   Base Price real de PriceLabs para esta unidad (92), y un Min mayor que el
   Base no existe. La causa era otra: el `floor` incluía el factor del
   Last-Minute porcentual en el denominador, o sea calculaba "el precio mínimo
   ANTES del LM". El Min Price de PriceLabs es un piso sobre el precio DESPUÉS
   del LM porcentual ("Percentage-based last-minute discounts will still respect
   the Minimum Price as a floor"). Sacando ese factor, el Piso da 77.89 —
   exactamente 108.1760 x 0.72, donde 28% es el LM gradual del día 0 — y queda
   por debajo del Base (92), como tiene que ser. Ver el docblock de
   src/domain/worstcase.js para las tres verificaciones independientes. */
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

test('CASO OBLIGATORIO 902 — Piso/Min Price corregido: 77.89 (Expedia, día 0, 1 noche); NI 138.69 (costo fijo) NI 108.18 (LM en el denominador)', () => {
  const config = unit902Config();
  const model = compute(config);

  assert.equal(model.costBlocked, false, 'los costos detallados estan confirmados, no deben bloquear');
  assert.equal(model.lmBlocked, false, 'LM gradual verificado no deben bloquear');

  // Numero VIEJO #1 (costo fijo de 1 noche aplicado a 27 noches) — no debe volver.
  assert.ok(Math.abs(model.floor - 138.68912932933407) > 1, `el Piso NO debe volver al numero de la primera version (~138.69) — dio ${model.floor}`);
  // Numero VIEJO #2 (LM porcentual dentro del denominador) — tampoco.
  assert.ok(Math.abs(model.floor - 108.1759864439603) > 1, `el Piso NO debe volver al numero con LM en el denominador (~108.18) — dio ${model.floor}`);

  // El numero CORREGIDO: Expedia, dia 0, 1 noche, 77.89.
  assert.equal(model.floorChId, 'expedia', `el canal que fija el Piso corregido debe ser Expedia, no ${model.floorChId}`);
  assert.ok(model.floorCh.includes('1 noche'), `el motivo del Piso debe citar 1 noche, no una estadia larga — dio "${model.floorCh}"`);
  assert.ok(Math.abs(model.floor - 77.8867102396514) < 0.005, `el Piso corregido debe ser 77.89 — dio ${model.floor}`);

  /* Relacion exacta con el numero viejo: el LM gradual de la 902 es 28% en el
     dia 0 (maxPct 28 sobre 6 dias), y ese era justo el factor que sobraba en el
     denominador. No es una coincidencia ni un ajuste a ojo. */
  assert.ok(Math.abs(model.floor - 108.1759864439603*(1-0.28)) < 1e-9,
    'el Piso corregido debe ser EXACTAMENTE el viejo x (1 - LM del peor dia)');

  /* SANIDAD ESTRUCTURAL — la señal que destapó el bug. El Base Price real de
     PriceLabs para esta unidad es 92; un Min Price por encima del Base es
     imposible (PriceLabs nunca publicaría un precio que su propio piso rechaza).
     108.18 rompía esto; 77.89 no. */
  const BASE_PRICELABS_REAL_902 = 92;
  assert.ok(model.floor < BASE_PRICELABS_REAL_902,
    `el Min Price (${model.floor.toFixed(2)}) debe quedar POR DEBAJO del Base de PriceLabs (${BASE_PRICELABS_REAL_902})`);
});

test('CASO OBLIGATORIO 902 — precio post-LM requerido por canal: Airbnb 77.10 (día 60) / Booking 65.46 / Expedia 77.89 / Directo 74.83', () => {
  const config = unit902Config();
  const {channels, discounts, windows, ceilings, lmConfig, costBreakdown} = config;
  const costForNight = costForNightFn(costBreakdown, true, 71.5);

  /* Todos son el numero viejo x 0.72 (el LM del dia 0). Airbnb es el unico que
     ademas CAMBIA de escenario: con el LM fuera del denominador, su peor caso
     deja de ser el dia 0 y pasa a ser el dia 60 — el early-bird de 2 meses
     (ab_eb2, 15%) es un descuento mas profundo que cualquier cosa que Airbnb
     aplique en el dia 0, y antes quedaba tapado porque el LM solo existe cerca
     del check-in. 91.0178 x 0.72 = 65.53 (dia 0) < 77.0975 (dia 60). */
  const expected = {
    airbnb: {p:77.09746404412913, day:60, night:1},
    booking:{p:65.4604547899429,  day:0,  night:1},
    expedia:{p:77.8867102396514,  day:0,  night:1},
    direct: {p:74.82993197278913, day:0,  night:1}
  };
  for(const c of channels){
    const {worstFactor, worstFeePerNight, worstDay, worstNight, pf} = worstScenarioFactor({
      chId:c.id, channels, discounts, windows, ceilings, lmConfig, cost: costForNight
    });
    // el offset del canal ya esta incluido dentro de worstFactor (worstScenarioFactor lo aplica internamente)
    const p = worstFactor>0
      ? (worstFeePerNight>0 ? Math.max(0, 71.5/pf-worstFeePerNight)/worstFactor : 71.5/(worstFactor*pf))
      : Infinity;
    assert.equal(worstDay, expected[c.id].day, `${c.id}: dia critico esperado ${expected[c.id].day}, dio ${worstDay}`);
    assert.equal(worstNight, expected[c.id].night, `${c.id}: noche critica esperada ${expected[c.id].night}, dio ${worstNight}`);
    assert.ok(Math.abs(p - expected[c.id].p) < 0.005, `${c.id}: precio requerido esperado ${expected[c.id].p}, dio ${p}`);
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

test('sin cost (undefined), el peor factor es offset x nativo OTA — el LM porcentual ya NO entra', () => {
  const channels = freshChannels();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};

  /* Directo sin ningún descuento nativo activo y sin offset: el peor factor es 1.
     Antes de sep 2026 este test fijaba 0.5 — el LM plano de 50% entraba en el
     factor. Ya no: el resultado de worstScenarioFactor() es el Min Price, y
     PriceLabs topa contra el Min el precio que ya trae el LM porcentual adentro
     (ver src/domain/worstcase.js). */
  const sinNativos = freshDiscounts().map(d=>({...d, on:false}));
  const soloLm = worstScenarioFactor({chId:'direct', channels, discounts:sinNativos, windows, ceilings, lmConfig});
  assert.equal(soloLm.worstFactor, 1, 'un LM porcentual de 50% no puede mover el factor del Min Price');

  /* Y el factor SÍ sigue reaccionando a un descuento nativo real del canal:
     Last-minute DIRECTO (di_lm, un descuento del canal, no de PriceLabs) al 40%
     en días 0-3 deja el factor en 0.6. */
  const conNativo = sinNativos.map(d=>d.id==='di_lm' ? {...d, on:true, pct:40} : d);
  const result = worstScenarioFactor({chId:'direct', channels, discounts:conNativo, windows, ceilings, lmConfig});
  assert.ok(Math.abs(result.worstFactor - 0.6) < 1e-12, `factor esperado 0.6, dio ${result.worstFactor}`);
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
