/* BLOQUEANTE CRITICO (revision externa, jul 2026) — compute().floor y
   suggestedOffset() ignoraban Last-Minute por completo: el Piso se calculaba
   como si PriceLabs nunca aplicara LM, aunque hubiera un lmConfig VERIFICADO.
   Caso exacto reportado: canal Directo, costo 100, margen 0, sin descuentos
   OTA, LM flat 50% verificado en días 0-3 — el Piso viejo daba ≈109.89 y
   `valid:true`, pero cotizar a ese precio en día 0 (LM real aplicado) netea 50,
   no 100. Ver src/domain/worstcase.js para la corrección. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, suggestedOffset} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {criticalDays, criticalNights} from '../src/domain/thresholds.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function directoOnlyConfig(){
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false})); // sin descuentos OTA — aislar el efecto de LM
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  return {channels, discounts, windows, ceilings};
}

test('CASO OBLIGATORIO — Directo/costo 100/margen 0/LM flat 50% verificado: el Piso viejo (109.89) NO protegía; el nuevo sí', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};

  const model = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);

  // Evidencia del bug viejo, documentada explícitamente: sin lmConfig, el Piso da 109.89 (no protege LM).
  const modelSinLm = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows});
  assert.ok(Math.abs(modelSinLm.floor - 109.8901098901099) < 1e-6, 'el Piso SIN lmConfig sigue dando el numero viejo (documentado, no es lo que se usa en produccion)');
  const qConLmViejo = quoteScenario({chId:'direct', days:0, nights:1, price:modelSinLm.floor}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.ok(qConLmViejo.payout < 100, `el Piso viejo (${modelSinLm.floor.toFixed(2)}) NO protege contra un LM real de 50% en día 0 — netea ${qConLmViejo.payout.toFixed(2)} < 100, la prueba misma del bug reportado`);

  // El Piso NUEVO (con lmConfig) sí debe proteger, con LM ACTIVO (no neutralizado).
  assert.ok(model.floor > modelSinLm.floor, 'el Piso con LM debe ser mayor que sin LM (compensa el 50% que se va a descontar)');
  const q = quoteScenario({chId:'direct', days:0, nights:1, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.equal(q.lm, 50, 'el LM debe estar realmente activo en la cotizacion (no neutralizado con techo 0)');
  assert.ok(q.payout >= 100 - 1e-6, `cotizando al NUEVO Piso (${model.floor.toFixed(2)}) en día 0 con LM 50% activo, el neto (${q.payout.toFixed(2)}) debe cubrir el costo (100)`);
});

test('Piso con LM gradual: protege en el punto mas exigente de la curva (dia 0, maximo %)', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'gradual', verified:true, gradual:{maxPct:40, days:5, on:true}};
  const model = compute({fixedCost:80, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);
  const days = [...criticalDays(discounts, windows), 0,1,2,3,4,5];
  const nights = criticalNights(discounts);
  for(const d of days) for(const n of nights){
    const q = quoteScenario({chId:'direct', days:d, nights:n, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:80, varCost:0, lmConfig});
    assert.ok(q.payout >= 80 - 1e-6, `dia ${d} noche ${n}: payout ${q.payout.toFixed(2)} debe cubrir costo 80 (LM gradual activo, pct=${q.lm})`);
  }
});

test('Piso con LM de tramos (tiers): protege contra el tramo mas profundo, sin sumar tramos solapados', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'tiers', verified:true, tiers:[
    {id:'t1', label:'A', fromDay:0, toDay:5, pct:30, on:true},
    {id:'t2', label:'B', fromDay:2, toDay:8, pct:60, on:true} // gana en 2-5 (B esta despues en el arreglo pero A gana por orden en el solape 2-5... ver politica "gana el primero")
  ]};
  const model = compute({fixedCost:60, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  const days=[0,1,2,3,4,5,6,7,8,9];
  for(const d of days){
    const q = quoteScenario({chId:'direct', days:d, nights:1, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:60, varCost:0, lmConfig});
    assert.ok(q.payout >= 60 - 1e-6, `dia ${d}: payout ${q.payout.toFixed(2)} debe cubrir costo 60 (tramo activo pct=${q.lm})`);
  }
});

test('Piso con LM de precio FIJO inviable: se bloquea con error explicito, no se "arregla" subiendo el Piso al infinito', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  // Precio fijo de 10 en dias 0-3, con comisiones de Directo (3%+6%) el payout maximo posible es ~9.1 — nunca puede cubrir un costo de 100, sin importar el Piso.
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', verified:true, fixedPrice:{price:10, fromDay:0, toDay:3, on:true}};
  const model = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, false, 'un precio LM fijo que no puede cubrir el costo debe bloquear el modelo, no dar un Piso falso');
  assert.ok(model.errors.some(e=>e.level==='error' && e.field==='lmConfig.fixedPrice'), 'debe explicar que el precio fijo es la causa');
});

test('suggestedOffset incluye LM en su dia de referencia (45) cuando hay lmConfig — antes lo ignoraba', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'tiers', verified:true, tiers:[{id:'t1', label:'largo', fromDay:30, toDay:9999, pct:25, on:true}]};
  const base = {chId:'direct', channels, discounts, avgNights:3, effBase:200, netObjetivo:100};
  const offSinLm = suggestedOffset(base);
  const offConLm = suggestedOffset({...base, lmConfig, windows, ceilings});
  assert.notEqual(Math.round(offSinLm*100), Math.round(offConLm*100), 'el offset sugerido debe cambiar cuando hay un LM real activo en el dia de referencia (45 cae dentro del tramo 30-9999)');
  assert.ok(offConLm > offSinLm, 'con LM restando ingreso, el offset sugerido debe subir para compensar');
});

test('PROPIEDAD EXHAUSTIVA — Piso protege payout >= costo en TODOS los escenarios criticos (OTA x LM x noches), para cada canal', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:35, fromDay:0, toDay:7, on:true}};
  const cost = 70;
  const model = compute({fixedCost:cost, varCost:0, margin:30, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);
  const days = criticalDays(discounts, windows);
  const nights = criticalNights(discounts);
  const failures = [];
  for(const c of channels){
    for(const d of days){
      for(const n of nights){
        const q = quoteScenario({chId:c.id, days:d, nights:n, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:cost, varCost:0, lmConfig});
        if(q.payout < cost - 1e-6) failures.push(`${c.id} dia=${d} noches=${n}: payout ${q.payout.toFixed(2)} < costo ${cost} (lm=${q.lm})`);
      }
    }
  }
  assert.equal(failures.length, 0, `el Piso debe cubrir el costo en TODO el dominio critico (OTA x LM x noches):\n${failures.slice(0,10).join('\n')}`);
});
