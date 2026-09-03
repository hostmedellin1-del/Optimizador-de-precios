/* FIX sep 2026 — "el Piso es el Min Price de PriceLabs, y el Min topa el precio
   DESPUÉS del Last-Minute porcentual".

   Qué estaba mal: `worstScenarioFactor()` metía (1 - lmPct/100) en el denominador
   del Piso, así que `compute().floor` era "el precio mínimo ANTES del LM". El Min
   Price que PriceLabs pide configurar no es eso: es un piso sobre el precio que
   PriceLabs publica, y ese precio ya trae el descuento de última hora aplicado.

   Verificado de tres formas independientes (ver src/domain/worstcase.js para el
   detalle y las citas):
   1. Base de conocimiento de PriceLabs, textual: "only a Fixed Last-Minute Price
      can override the Minimum Price and push the final price below it.
      Percentage-based last-minute discounts will still respect the Minimum Price
      as a floor."
   2. Precios diarios reales del listing 15195 (Base 92): días 7+ publican 86-90,
      días 0-6 publican 65-83 — el precio publicado ya trae el LM adentro.
   3. Arquitectura confirmada por el dueño: PriceLabs → Kunas con el precio ya
      topado contra el Min; Kunas suma el % por OTA; la OTA aplica sus nativos y
      su comisión.

   Este archivo fija las tres consecuencias:
   A. Los 4 modos PORCENTUALES (ceiling_auto/flat/gradual/tiers) no mueven el Piso.
   B. El modo `fixed_price` NO cambia: sigue saliendo por `infeasible`, porque un
      Fixed Last-Minute Price sí puede publicar por debajo del Min.
   C. `quoteScenario()` modela el tope explícitamente (`config.minPrice`), para que
      Piso, Simulador y alertas digan lo mismo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

/* Canal Directo aislado, sin descuentos OTA: deja el efecto del LM como la única
   variable en juego. Directo = comisión 3% + bancaria 6% => payoutFactor 0.91. */
function directoOnly(extra = {}){
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows),
    fixedCost:100, varCost:0, margin:0, marketBase:0, ...extra};
}

/* Los 4 modos porcentuales, cada uno ACTIVO y verificado en el día 0. */
const MODOS_PORCENTUALES = {
  ceiling_auto: {...defaultLmConfig(), mode:'ceiling_auto', verified:true},
  flat:    {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:50, fromDay:0, toDay:5, on:true}},
  gradual: {...defaultLmConfig(), mode:'gradual', verified:true, gradual:{maxPct:40, days:6, on:true}},
  tiers:   {...defaultLmConfig(), mode:'tiers', verified:true, tiers:[{id:'t1', label:'A', fromDay:0, toDay:4, pct:35, on:true}]}
};

/* ================= A. modos porcentuales: el LM sale del denominador ============ */

test('A — ningún modo PORCENTUAL de LM mueve el Piso: los 4 dan el mismo Min que sin LM', () => {
  const cfg = directoOnly();
  const sinLm = compute(cfg);
  assert.ok(Math.abs(sinLm.floor - 100/0.91) < 1e-9, `referencia: 100/0.91 = 109.89 — dio ${sinLm.floor}`);

  for(const [modo, lmConfig] of Object.entries(MODOS_PORCENTUALES)){
    const conLm = compute({...cfg, lmConfig});
    assert.equal(conLm.floor, sinLm.floor,
      `modo "${modo}": un descuento de última hora PORCENTUAL no puede bajar el precio por debajo del Min, así que no debe elevar el Min (dio ${conLm.floor} vs ${sinLm.floor})`);
  }
});

test('A — el peor factor del Piso es (1+offset) x nativoOTA, sin ningún término de LM', () => {
  const channels = freshChannels().filter(c=>c.id==='direct').map(c=>({...c, offsetPct:20}));
  const discounts = freshDiscounts().map(d=>d.id==='di_lm' ? {...d, on:true, pct:25} : {...d, on:false});
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);

  for(const [modo, lmConfig] of Object.entries(MODOS_PORCENTUALES)){
    const {worstFactor} = worstScenarioFactor({chId:'direct', channels, discounts, windows, ceilings, lmConfig, cost:100});
    assert.ok(Math.abs(worstFactor - 1.2*0.75) < 1e-12,
      `modo "${modo}": factor esperado 1.20 x 0.75 = 0.90 — dio ${worstFactor}`);
  }
});

test('A — el Min resultante queda POR DEBAJO del Base Price (sanidad estructural que destapó el bug)', () => {
  /* Un Min por encima del Base es imposible: PriceLabs nunca publicaría un precio
     que su propio piso rechaza. Con el LM dentro del denominador del Piso esto se
     rompía en cuanto el LM era profundo (unidad 902: Min 108.18 vs Base real 92). */
  const cfg = directoOnly({margin:35});
  for(const [modo, lmConfig] of Object.entries(MODOS_PORCENTUALES)){
    const model = compute({...cfg, lmConfig});
    assert.ok(model.floor < model.base,
      `modo "${modo}": el Min (${model.floor.toFixed(2)}) debe quedar por debajo del Base (${model.base.toFixed(2)})`);
  }
});

/* ================= B. fixed_price: sin cambios ================================= */

test('B — fixed_price SIGUE saliendo por `infeasible` (es el único LM que se salta el Min)', () => {
  const cfg = directoOnly();
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', verified:true,
    fixedPrice:{price:10, fromDay:0, toDay:3, on:true}};

  const {infeasible, worstFactor} = worstScenarioFactor({
    chId:'direct', channels:cfg.channels, discounts:cfg.discounts, windows:cfg.windows,
    ceilings:cfg.ceilings, lmConfig, cost:100
  });
  assert.ok(infeasible.length > 0, 'un precio LM fijo de 10 no puede cubrir un costo de 100 con ningún Min');
  infeasible.forEach(x=>{
    assert.equal(x.overridePrice, 10);
    assert.ok(x.day>=0 && x.day<=3, `el día reportado (${x.day}) debe caer dentro del rango del precio fijo`);
    assert.ok(x.payoutAtOverride < 100);
  });
  assert.ok(Number.isFinite(worstFactor), 'los días con precio fijo no participan del worstFactor, pero el resto del dominio sí');

  const model = compute({...cfg, lmConfig});
  assert.equal(model.valid, false, 'el modelo debe bloquearse con un error explícito, no dar un Piso falso');
  assert.ok(model.errors.some(e=>e.level==='error' && e.field==='lmConfig.fixedPrice'));
});

test('B — un fixed_price que SÍ cubre el costo no genera `infeasible` y tampoco altera el Piso', () => {
  const cfg = directoOnly();
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', verified:true,
    fixedPrice:{price:200, fromDay:0, toDay:3, on:true}};
  const {infeasible} = worstScenarioFactor({
    chId:'direct', channels:cfg.channels, discounts:cfg.discounts, windows:cfg.windows,
    ceilings:cfg.ceilings, lmConfig, cost:100
  });
  assert.equal(infeasible.length, 0);
  assert.equal(compute({...cfg, lmConfig}).floor, compute(cfg).floor,
    'el Piso de los demás días no cambia por existir un precio fijo viable en el rango 0-3');
});

/* ================= C. el tope del Min dentro de quoteScenario() ================ */

function quoteCfg(extra = {}){
  const {channels, discounts, windows, ceilings} = directoOnly();
  return {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, ...extra};
}

test('C — con `minPrice`, el precio post-LM porcentual se topa: priceAfterLm = max(min, price x (1-lm/100))', () => {
  const lmConfig = MODOS_PORCENTUALES.flat; // 50% en días 0-5
  const config = quoteCfg({lmConfig, minPrice:90});

  const topado = quoteScenario({chId:'direct', days:0, nights:1, price:100}, config);
  assert.equal(topado.lm, 50, 'el LM sigue existiendo y se sigue reportando tal cual');
  assert.equal(topado.priceBeforeMin, 50, 'el precio que el LM habría producido');
  assert.equal(topado.priceAfterLm, 90, 'PriceLabs no publica por debajo del Min con un LM porcentual');
  assert.equal(topado.minPriceApplied, true);
  assert.match(topado.assumptions.join(' '), /Min Price de PriceLabs \(90\.00\) topa/);

  /* El Offset y los nativos se aplican DESPUÉS del tope, en ese orden. */
  assert.equal(topado.priceAfterOffset, 90, 'offset 0% en este canal: el precio topado pasa tal cual');
});

test('C — el tope NO se activa cuando el precio con LM ya está por encima del Min', () => {
  const config = quoteCfg({lmConfig:MODOS_PORCENTUALES.flat, minPrice:40});
  const q = quoteScenario({chId:'direct', days:0, nights:1, price:100}, config);
  assert.equal(q.priceAfterLm, 50);
  assert.equal(q.minPriceApplied, false);
  assert.ok(!q.assumptions.join(' ').includes('Min Price de PriceLabs'));
});

test('C — sin `minPrice` no hay tope (cero regresión para todo caller que no lo pase)', () => {
  const config = quoteCfg({lmConfig:MODOS_PORCENTUALES.flat});
  const q = quoteScenario({chId:'direct', days:0, nights:1, price:100}, config);
  assert.equal(q.priceAfterLm, 50);
  assert.equal(q.minPriceApplied, false);
  assert.equal(q.minPrice, 0);
  for(const invalido of [null, undefined, 0, -50, 'abc', NaN]){
    const qi = quoteScenario({chId:'direct', days:0, nights:1, price:100}, quoteCfg({lmConfig:MODOS_PORCENTUALES.flat, minPrice:invalido}));
    assert.equal(qi.priceAfterLm, 50, `minPrice=${String(invalido)} no debe topar nada`);
  }
});

test('C — `fixed_price` NO se topa contra el Min: es el único LM que puede publicar por debajo', () => {
  const lmConfig = {...defaultLmConfig(), mode:'fixed_price', verified:true,
    fixedPrice:{price:40, fromDay:0, toDay:3, on:true}};
  const config = quoteCfg({lmConfig, minPrice:90});
  const q = quoteScenario({chId:'direct', days:0, nights:1, price:100}, config);
  assert.equal(q.priceAfterLm, 40, 'un Fixed Last-Minute Price se salta el Min Price (contrato de PriceLabs)');
  assert.equal(q.minPriceApplied, false);
  assert.equal(q.lmPriceOverrideActive, true);

  /* Y fuera del rango del precio fijo, el mismo escenario SÍ se topa
     (ahí no hay override y el LM porcentual del modo es 0). */
  const fuera = quoteScenario({chId:'direct', days:9, nights:1, price:60}, config);
  assert.equal(fuera.priceAfterLm, 90);
  assert.equal(fuera.minPriceApplied, true);
});

test('C — COHERENCIA: cotizar exactamente al Piso, con ese Piso como Min, netea el costo en TODO el dominio', () => {
  /* Esta es la propiedad que la app tiene que cumplir para no contradecirse:
     el número que el KPI llama "Min Price a poner en PriceLabs" tiene que ser un
     precio al que el Simulador y las alertas NO muestren pérdida. */
  const cfg = directoOnly({fixedCost:70, margin:20});
  for(const [modo, lmConfig] of Object.entries(MODOS_PORCENTUALES)){
    const model = compute({...cfg, lmConfig});
    const config = {...cfg, lmConfig, minPrice:model.floor};
    for(const days of [0,1,2,3,4,5,6,10,45,90]){
      const q = quoteScenario({chId:'direct', days, nights:1, price:model.floor}, config);
      assert.ok(q.payout >= model.cost - 1e-9,
        `modo "${modo}", día ${days}: cotizar al Piso (${model.floor.toFixed(2)}) netea ${q.payout.toFixed(2)} < costo ${model.cost}`);
    }
  }
});
