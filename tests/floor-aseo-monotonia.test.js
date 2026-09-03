/* BUG REAL (sep 2026) — el VALOR del Piso usaba el costo de 1 noche aunque el
   peor escenario fuera de más noches.

   Es la segunda mitad del fix "el Piso usaba el costo de 1 noche para CUALQUIER
   duración" (ver tests/floor-cost-por-noche.test.js, la primera mitad). Aquella
   ronda arregló la SELECCIÓN: `worstScenarioFactor()` recibe `costForNight` y
   elige el peor escenario con el costo real de cada duración. Pero el paso
   siguiente, en `compute()` (src/domain/engine.js), volvía a dividir `cost` —
   el costo de UNA noche — aunque el escenario elegido fuera de 28.

   Reproducción exacta, con la config REAL de la 902 (tests/helpers/
   state-factory.js, reconstruida del respaldo del dueño) y las tarifas de aseo
   confirmadas por él (Expedia 35, Booking 37,50), variando el aseo corto de
   Airbnb:

     cleanFeeShort | app con el bug | correcto | peor caso correcto
     --------------|----------------|----------|-------------------------------
     20            | 77.10          | 77.10    | Airbnb, día 60, 1 noche
     25            | 74.83          | 74.83    | Directo, día 0, 1 noche
     30            | 113.22 ✗       | 74.83    | Directo, día 0, 1 noche

   El 113.22 salía de evaluar Airbnb día 0 / 28 noches con el costo de 1 noche
   (71.50) en vez del real de 28 noches (42.57).

   LA SEÑAL DE QUE ESTÁ MAL, y la propiedad que este archivo fija para siempre:
   la tarifa de aseo es INGRESO. Subirla NUNCA puede subir el Piso. Un Piso que
   sube cuando entra más plata es, por construcción, un número equivocado. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {unit902Config} from './helpers/state-factory.js';

/* La 902 con el aseo real de Booking/Expedia (confirmado por el dueño en sus
   Extranets: Expedia USD 35 "Per stay", Booking 120.000 COP ≈ USD 37,50) y el
   aseo de Airbnb que se quiera probar. */
function config902ConAseo({airbnbShort = 20, airbnbLong = 25, expedia = 35, booking = 37.5, direct = 0} = {}){
  const config = unit902Config();
  const setCh = (id, patch) => Object.assign(config.channels.find(c=>c.id===id), patch);
  setCh('airbnb',  {cleanFeeShort:airbnbShort, cleanFeeLong:airbnbLong});
  setCh('expedia', {cleanFee:expedia});
  setCh('booking', {cleanFee:booking});
  setCh('direct',  {cleanFee:direct});
  return config;
}

test('CASO REAL 902 — producción de hoy (Airbnb 20/25, Expedia 35, Booking 37,50, Directo 0): el Piso sigue dando 77.10, sin moverse un centavo', () => {
  const model = compute(config902ConAseo({airbnbShort:20}));
  assert.equal(model.costBlocked, false);
  assert.equal(model.lmBlocked, false);
  assert.ok(Math.abs(model.floor - 77.09746404412913) < 0.005, `el Piso de producción debe seguir siendo 77.10 — dio ${model.floor}`);
  assert.equal(model.floorChId, 'airbnb');
  /* El peor caso de hoy es de 1 NOCHE, por eso el bug no afectaba este número:
     costForNight(1) es idénticamente el `cost` que se usaba antes. */
  assert.ok(model.floorCh.includes('día 60'), `peor escenario esperado día 60 — dio "${model.floorCh}"`);
  assert.ok(model.floorCh.includes('1 noche'), `peor escenario esperado de 1 noche — dio "${model.floorCh}"`);
});

test('CASO REAL 902 — con el aseo corto de Airbnb en 25 el Piso pasa a Directo, día 0, 1 noche: 74.83', () => {
  const model = compute(config902ConAseo({airbnbShort:25}));
  assert.ok(Math.abs(model.floor - 74.82993197278913) < 0.005, `el Piso debe ser 74.83 — dio ${model.floor}`);
  assert.equal(model.floorChId, 'direct');
  assert.ok(model.floorCh.includes('día 0') && model.floorCh.includes('1 noche'), `peor escenario esperado día 0 / 1 noche — dio "${model.floorCh}"`);
});

test('CASO REAL 902 — con el aseo corto de Airbnb en 30 el Piso debe dar 74.83, NO 113.22 (el número del bug)', () => {
  const model = compute(config902ConAseo({airbnbShort:30}));
  assert.ok(Math.abs(model.floor - 113.22) > 1, `el Piso NO debe volver al número del bug (~113.22) — dio ${model.floor}`);
  assert.ok(Math.abs(model.floor - 74.82993197278913) < 0.005, `el Piso corregido debe ser 74.83 — dio ${model.floor}`);
  assert.equal(model.floorChId, 'direct', 'con el aseo alto de Airbnb, quien fija el Piso es Directo (el único canal sin aseo), no Airbnb');
});

test('CASO REAL 902 — el escenario donde vivía el bug (Airbnb día 0, 28 noches) exige mucho menos que 113.22 con su costo real', () => {
  const config = config902ConAseo({airbnbShort:30});
  const model = compute(config);
  /* Con el costo real de 28 noches (42.57/noche, no 71.50) ese escenario pide
     66.92 — por debajo del 74.83 de Directo, así que ni siquiera es el peor.
     El 113.22 del bug es exactamente ese mismo escenario evaluado con el costo
     equivocado. */
  assert.ok(model.costForNight(28) < 43, `el costo real de 28 noches debe rondar 42.6 — dio ${model.costForNight(28)}`);
  assert.equal(model.costForNight(1), 71.5);
  assert.ok(model.floor < 75, `el Piso no puede quedar cerca de 113 — dio ${model.floor}`);
});

/* ---------- LA PROPIEDAD: monotonía del aseo ---------- */

test('PROPIEDAD — subir CUALQUIER tarifa de aseo nunca sube el Piso (es monótona no creciente)', () => {
  const FEE_STEPS = [0, 5, 10, 20, 25, 30, 45, 60, 90];
  const FIELDS = [
    {ch:'airbnb',  key:'cleanFeeShort'},
    {ch:'airbnb',  key:'cleanFeeLong'},
    {ch:'booking', key:'cleanFee'},
    {ch:'expedia', key:'cleanFee'},
    {ch:'direct',  key:'cleanFee'}
  ];
  for(const {ch, key} of FIELDS){
    let prevFloor = Infinity, prevFee = null;
    for(const fee of FEE_STEPS){
      const config = config902ConAseo();
      Object.assign(config.channels.find(c=>c.id===ch), {[key]: fee});
      const floor = compute(config).floor;
      assert.ok(floor <= prevFloor + 1e-9,
        `${ch}.${key}: subir el aseo de ${prevFee} a ${fee} SUBIÓ el Piso (${prevFloor} → ${floor}). El aseo es ingreso: nunca puede subir el Piso.`);
      prevFloor = floor; prevFee = fee;
    }
  }
});

test('PROPIEDAD — la monotonía también vale con el modelo simple de costos (sin desglose detallado)', () => {
  /* Sin `costBreakdown` el costo es constante para toda duración, así que el
     bug original ni siquiera podía manifestarse acá — pero la propiedad debe
     valer igual, y este caso es la guarda de no-regresión del modelo simple. */
  let prev = Infinity;
  for(const fee of [0, 10, 25, 50, 100]){
    const config = config902ConAseo();
    delete config.costBreakdown;
    config.costBreakdownConfirmed = false;
    config.fixedCost = 40; config.varCost = 20;
    Object.assign(config.channels.find(c=>c.id==='airbnb'), {cleanFeeShort:fee, cleanFeeLong:fee});
    const model = compute(config);
    assert.equal(model.cost, 60, 'el modelo simple debe seguir usando fixedCost+varCost');
    assert.ok(model.floor <= prev + 1e-9, `modelo simple: subir el aseo a ${fee} subió el Piso (${prev} → ${model.floor})`);
    prev = model.floor;
  }
});

test('el aseo de un canal solo puede BAJAR el Piso hasta donde lo permite el siguiente canal más ajustado', () => {
  /* El Piso es un MAXIMO entre canales: subir el aseo del canal que hoy manda
     lo baja, pero solo hasta que otro canal pasa a ser el más ajustado — ahí se
     estanca. Es lo que hace que "arreglar" un solo canal no arregle el Piso.
     Se parte de la config de producción y se sube el aseo del canal que
     realmente esté mandando, sin asumir cuál es. */
  const produccion = compute(config902ConAseo());
  const bindingCh = produccion.floorChId;
  const feeField = bindingCh==='airbnb' ? 'cleanFeeShort' : 'cleanFee';

  const config = config902ConAseo();
  Object.assign(config.channels.find(c=>c.id===bindingCh), {[feeField]: 300});
  const conAseoEnorme = compute(config);

  assert.ok(conAseoEnorme.floor < produccion.floor, `subir el aseo de ${bindingCh} debe BAJAR el Piso (${produccion.floor} → ${conAseoEnorme.floor})`);
  assert.notEqual(conAseoEnorme.floorChId, bindingCh, `con un aseo enorme, ${bindingCh} deja de ser el canal más ajustado`);

  /* Y una vez que manda otro canal, seguir subiendo el aseo del primero ya no
     mueve el Piso: el máximo lo fija el otro. */
  const config2 = config902ConAseo();
  Object.assign(config2.channels.find(c=>c.id===bindingCh), {[feeField]: 3000});
  const conAseoAbsurdo = compute(config2);
  assert.ok(Math.abs(conAseoAbsurdo.floor - conAseoEnorme.floor) < 1e-9, 'con otro canal mandando, seguir subiendo el aseo del primero ya no mueve el Piso');
});
