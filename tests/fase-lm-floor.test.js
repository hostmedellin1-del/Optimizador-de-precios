/* HISTORIA DE ESTE ARCHIVO — no borrar, se corrigió, no se reemplazó.

   jul 2026 (premisa original, EQUIVOCADA): "compute().floor ignoraba Last-Minute
   por completo; cotizar al Piso en día 0 con LM 50% netea 50, no 100". El fix de
   entonces metió (1 - lmPct/100) en el denominador del Piso.

   sep 2026 (premisa corregida): el Piso ES el Min Price de PriceLabs, y PriceLabs
   aplica su descuento porcentual de última hora ANTES de topar contra el Min —
   textual de su base de conocimiento: "Percentage-based last-minute discounts
   will still respect the Minimum Price as a floor". Es decir: el LM porcentual
   NO puede empujar el precio publicado por debajo del Min.

   Lo que el caso de jul 2026 demostraba de verdad NO era que el Piso tuviera que
   subir, sino que el pipeline de cotización no modelaba el tope del Min: bajaba
   el precio un 50% sin topar nada. Con `config.minPrice` (ver src/domain/quote.js)
   el mismo escenario neteá exactamente el costo con el Piso ORIGINAL de 109.89 —
   sin inflarlo a 219.78 (109.89/0.5), que es a lo que llevaba la premisa vieja y
   que además producía un Min mayor que el Base, algo estructuralmente imposible.

   Los tests de este archivo conservan el mismo espíritu (el Piso protege el costo
   en todo el dominio crítico) con el modelo corregido: se cotiza pasando el Min
   real, igual que hace la app (index.html → quoteConfig()). Ver los docblocks de
   src/domain/worstcase.js y src/domain/quote.js. */
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

test('CASO CORREGIDO — Directo/costo 100/margen 0/LM flat 50% verificado: el Min lo fija el precio POST-LM (109.89), y el tope del Min es lo que protege', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:3, on:true}};

  const model = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);

  /* Directo: comisión 3% + bancaria 6% => payoutFactor 0.91; sin descuentos OTA
     ni offset, el precio que netea exactamente 100 es 100/0.91 = 109.8901…
     Ese número NO depende del LM porcentual: es el precio publicado mínimo, y
     el LM porcentual ya no puede bajar de ahí (lo topa el propio Min). */
  const modelSinLm = compute({fixedCost:100, varCost:0, margin:0, marketBase:0, channels, discounts, windows});
  assert.ok(Math.abs(model.floor - 109.8901098901099) < 1e-6, `el Min debe ser 100/0.91 = 109.89, sin dividir por el LM — dio ${model.floor}`);
  assert.equal(model.floor, modelSinLm.floor, 'un LM PORCENTUAL no mueve el Min Price: es un piso sobre el precio que ya trae ese descuento adentro');

  /* Con el Min configurado en PriceLabs (config.minPrice), cotizar al Piso en el
     día 0 con el LM de 50% activo NO baja el precio: PriceLabs publica el Min. */
  const quoteCfg = {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig, minPrice:model.floor};
  const q = quoteScenario({chId:'direct', days:0, nights:1, price:model.floor}, quoteCfg);
  assert.equal(q.lm, 50, 'el LM sigue estando activo en la cotizacion (no se neutraliza)');
  assert.equal(q.minPriceApplied, true, 'el tope del Min debe activarse: 109.89 x 0.5 = 54.95 esta por debajo del Min');
  assert.equal(q.priceAfterLm, model.floor, 'PriceLabs no publica por debajo del Min con un LM porcentual');
  assert.ok(q.payout >= 100 - 1e-6, `cotizando al Piso (${model.floor.toFixed(2)}) en día 0 con LM 50% y el Min puesto, el neto (${q.payout.toFixed(2)}) debe cubrir el costo (100)`);

  /* Y el caso de jul 2026, ahora con su lectura correcta: SIN Min configurado
     (minPrice ausente) el LM sí baja el precio y se netea por debajo del costo.
     Eso no pedía un Piso más alto — pedía que Dani ponga ese Min en PriceLabs. */
  const qSinMin = quoteScenario({chId:'direct', days:0, nights:1, price:model.floor}, {...quoteCfg, minPrice:undefined});
  assert.ok(Math.abs(qSinMin.priceAfterLm - model.floor*0.5) < 1e-9, 'sin Min, el LM baja el precio a la mitad');
  assert.ok(qSinMin.payout < 100, 'ese es el riesgo real que documentaba el caso de jul 2026: no configurar el Min Price en PriceLabs');
});

test('Piso con LM gradual: con el Min puesto, protege en todo el dominio (incluido el día 0, el punto más profundo de la curva)', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'gradual', verified:true, gradual:{maxPct:40, days:5, on:true}};
  const model = compute({fixedCost:80, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);
  const days = [...criticalDays(discounts, windows), 0,1,2,3,4,5];
  const nights = criticalNights(discounts);
  for(const d of days) for(const n of nights){
    const q = quoteScenario({chId:'direct', days:d, nights:n, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:80, varCost:0, lmConfig, minPrice:model.floor});
    assert.ok(q.payout >= 80 - 1e-6, `dia ${d} noche ${n}: payout ${q.payout.toFixed(2)} debe cubrir costo 80 (LM gradual activo, pct=${q.lm})`);
  }
});

test('Piso con LM de tramos (tiers): con el Min puesto, ningún tramo puede publicar por debajo del Piso', () => {
  const {channels, discounts, windows, ceilings} = directoOnlyConfig();
  const lmConfig = {...defaultLmConfig(), mode:'tiers', verified:true, tiers:[
    {id:'t1', label:'A', fromDay:0, toDay:5, pct:30, on:true},
    {id:'t2', label:'B', fromDay:2, toDay:8, pct:60, on:true} // gana en 2-5 (B esta despues en el arreglo pero A gana por orden en el solape 2-5... ver politica "gana el primero")
  ]};
  const model = compute({fixedCost:60, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  const days=[0,1,2,3,4,5,6,7,8,9];
  for(const d of days){
    const q = quoteScenario({chId:'direct', days:d, nights:1, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:60, varCost:0, lmConfig, minPrice:model.floor});
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
        const q = quoteScenario({chId:c.id, days:d, nights:n, price:model.floor}, {channels, discounts, windows, ceilings, fixedCost:cost, varCost:0, lmConfig, minPrice:model.floor});
        if(q.payout < cost - 1e-6) failures.push(`${c.id} dia=${d} noches=${n}: payout ${q.payout.toFixed(2)} < costo ${cost} (lm=${q.lm})`);
      }
    }
  }
  assert.equal(failures.length, 0, `el Piso debe cubrir el costo en TODO el dominio critico (OTA x LM x noches):\n${failures.slice(0,10).join('\n')}`);
});
