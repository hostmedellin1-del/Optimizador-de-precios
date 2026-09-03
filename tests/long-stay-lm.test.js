/* Regla de negocio de estancias largas (jul 2026).
   Last-Minute solo se excluye de las búsquedas de peor caso: el simulador y
   cualquier cotización normal siguen aplicando exactamente el LM configurado. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LONG_STAY_NIGHTS} from '../src/domain/pricelabs-lm.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenarioFactor} from '../src/domain/worstcase.js';
import {compute} from '../src/domain/engine.js';
import {CHANNELS, WINDOWS, defaultDiscounts, defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

function gradualConfig(){
  return {...defaultLmConfig(), mode:'gradual', verified:true,
    gradual:{maxPct:28, days:6, on:true}};
}

function isolatedAirbnb(){
  const channels = freshChannels().filter(c=>c.id==='airbnb');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows)};
}

test('LONG_STAY_NIGHTS es el umbral único de estancia larga y coincide con el catálogo', () => {
  assert.equal(LONG_STAY_NIGHTS, 28);
  const discounts = defaultDiscounts();
  assert.equal(findDiscount(discounts, 'ab_los4').minN, LONG_STAY_NIGHTS);
});

test('quoteScenario: el flag excluye LM a partir de 28 noches, sin importar el día', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const config = {channels, discounts, windows, ceilings, fixedCost:1, varCost:0, lmConfig:gradualConfig()};
  for(const days of [0, 3, 6, 45]){
    const q = quoteScenario({chId:'airbnb', days, nights:34, price:200}, config, {excludeLmOnLongStay:true});
    assert.equal(q.lm, 0, `día ${days}: una estancia larga no debe recibir LM en la búsqueda de peor caso`);
    assert.match(q.assumptions.join(' '), /excluido del peor caso/);
  }
});

test('quoteScenario: sin el flag, una estancia larga sigue aplicando el LM real (contrato del Simulador)', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const config = {channels, discounts, windows, ceilings, fixedCost:1, varCost:0, lmConfig:gradualConfig()};
  const q = quoteScenario({chId:'airbnb', days:0, nights:34, price:200}, config);
  assert.equal(q.lm, 28);
  assert.equal(q.priceAfterLm, 144);
});

test('worstScenarioFactor: 28+ noches excluye el LM combinado del peor factor', () => {
  const {channels, discounts, windows, ceilings} = isolatedAirbnb();
  const longStay = findDiscount(discounts, 'ab_los4');
  longStay.on = true;
  longStay.pct = 80;
  const result = worstScenarioFactor({
    chId:'airbnb', channels, discounts, windows, ceilings,
    lmConfig:gradualConfig(), cost:1
  });
  /* A 28 noches el nativo deja 20%; el factor debe quedar en 0.20.
     Desde sep 2026 esto se cumple por DOS razones acumuladas, no una: (a) la
     regla de estancia larga excluye el LM del peor caso, y (b) el LM porcentual
     ya no entra en el factor del Piso en NINGUNA duración (es el Min Price, que
     topa el precio ya descontado — ver src/domain/worstcase.js). La regla (a)
     sigue viva y con efecto propio: es la que impide que un LM de PRECIO FIJO se
     reporte como `infeasible` en una reserva de 28+ noches. */
  assert.ok(Math.abs(result.worstFactor-0.2)<1e-12,
    `factor=${result.worstFactor}, no debe combinar LM 28% con la estadía larga`);
  assert.equal(result.worstNight, LONG_STAY_NIGHTS);
});

test('caso numérico de referencia: quitar el combo LM+larga estadía reduce el Piso, no el simulador', () => {
  const windows = WINDOWS.map(w=>({...w}));
  const ceilings = Object.fromEntries(windows.map(w=>[w.id,w.ceil]));
  const channels = CHANNELS.filter(c=>c.id==='airbnb').map(c=>({...c, offsetPct:1.2}));
  const discounts = defaultDiscounts().map(d=>({...d, on:false}));
  const longStay = findDiscount(discounts, 'ab_los4');
  longStay.on = true;
  longStay.pct = 11.75;
  const lmConfig = gradualConfig();
  const base = {fixedCost:64, varCost:0, margin:0, marketBase:0, channels, discounts, windows, ceilings, lmConfig};
  const model = compute(base);
  /* Histórico de este número, en orden:
       ~117.80  — cuando el peor caso combinaba LM x larga estadía.
       ~103.94  — al excluir el LM de las estancias largas (jul 2026): el peor
                  caso pasaba a ser día 0 / 1 noche, donde el LM de 28% SÍ
                  entraba en el denominador: 64 / (0.72 x 1.012 x 0.845).
        84.81   — sep 2026, fix Piso vs Min Price: el LM porcentual sale del
                  denominador. Con día 0 / 1 noche el precio requerido baja a
                  74.83 (= 103.9305 x 0.72), así que el peor caso REAL pasa a ser
                  la estancia larga: 28 noches con el 11.75% de `ab_los4`
                  → 64 / (1.012 x 0.8825 x 0.845) = 84.8063. Recalculado a mano
                  fuera del motor, no ajustado al valor que salió. */
  assert.ok(Math.abs(model.floor-84.81)<0.01, `Piso nuevo inesperado: ${model.floor}`);
  assert.ok(model.floorCh.includes('28 noches'), `el peor caso ahora es la estancia larga — dio "${model.floorCh}"`);
  const q = quoteScenario({chId:'airbnb', days:0, nights:34, price:200}, base);
  assert.equal(q.lm, 28, 'el simulador conserva el LM aun en 34 noches');
});
