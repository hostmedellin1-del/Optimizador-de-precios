/* Bloqueante CRITICO (revision externa, RONDA 2) — quoteScenario() ya exponia
   lmBlocked por escenario, pero compute() seguia devolviendo valid:true y la UI
   mostraba Min Price/Base Price como si fueran recomendaciones confiables,
   incluso con la CONFIGURACION POR DEFECTO (modo automatico, sin verificar).
   Caso reportado: lmMode ceiling_auto, lmVerified:false, lmBlocked:true (ya
   dentro de quoteScenario), pero model.valid seguia true y la UI no bloqueaba
   nada. Este archivo prueba que:
   1. compute() propaga lmBlocked/lmBlockedReason — la configuracion POR
      DEFECTO (nadie tocó nada) queda bloqueada, no "usable".
   2. ceiling_auto SIEMPRE bloquea, incluso si alguien lo marca "verificado" —
      es matematicamente una proyeccion, no algo que se pueda confirmar.
   3. Un modo configurable (flat/gradual/fijo/tramos) SI se puede desbloquear
      marcandolo verificado — y sigue bloqueado si no se marca.
   4. buildMatrixVerdict() (matrix.js) nunca deja un veredicto "RENTABLE EN
      TODOS" (nivel 'ok') sostenido solo por un LM no verificable — cambia de
      nivel y de tag, no le agrega solo una advertencia de mas. Los veredictos
      negativos (BAJO COSTO/TECHO EXCEDIDO) NO se bloquean — son advertencias,
      no una afirmacion de que todo esta bien. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {isLmBlocked} from '../src/domain/pricelabs-lm.js';
import {quoteScenario} from '../src/domain/quote.js';
import {worstScenariosInWindow, buildMatrixVerdict} from '../src/domain/matrix.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function config(overrides={}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = overrides.windows || freshWindows();
  const ceilings = overrides.ceilings || defaultCeilings(windows);
  return {fixedCost:60, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings, ...overrides};
}

test('compute() con la config por defecto (ceiling_auto, sin verificar) queda BLOQUEADO — no "usable" con valid:true', () => {
  const model = compute(config({lmConfig: defaultLmConfig()}));
  assert.equal(model.valid, true, 'los inputs en si son validos (no hay NaN/negativos)');
  assert.equal(model.lmBlocked, true, 'la config por defecto (automatico, sin verificar) debe bloquear las recomendaciones');
  assert.ok(model.lmBlockedReason && model.lmBlockedReason.length>0);
  assert.match(model.lmBlockedReason, /Last-Minute de PriceLabs/, 'debe decir exactamente en que pantalla confirmar el LM');
});

test('ceiling_auto SIEMPRE bloquea, incluso marcado "verificado" — es una proyeccion, no un hecho confirmable', () => {
  const model = compute(config({lmConfig: {...defaultLmConfig(), mode:'ceiling_auto', verified:true}}));
  assert.equal(model.lmBlocked, true, 'ceiling_auto no se puede "verificar" — PriceLabs decide la curva real dia a dia, sin importar el checkbox');
});

test('un modo configurable (flat) SI se desbloquea al marcarlo verificado, y sigue bloqueado si no', () => {
  const flatCfg = {...defaultLmConfig(), mode:'flat', flat:{pct:20, fromDay:0, toDay:3, on:true}};
  const sinVerificar = compute(config({lmConfig: {...flatCfg, verified:false}}));
  const verificado = compute(config({lmConfig: {...flatCfg, verified:true}}));
  assert.equal(sinVerificar.lmBlocked, true);
  assert.equal(verificado.lmBlocked, false);
});

test('sin lmConfig en absoluto (callers viejos): Base internamente sigue asumiendo ceiling_auto (igual que quoteScenario), así que TAMBIÉN queda bloqueado — nunca se presenta como confirmado solo por omitir el campo', () => {
  const model = compute(config());
  assert.equal(model.lmBlocked, true);
  assert.ok(model.lmBlockedReason);
});

test('isLmBlocked() es la misma fuente que usan compute()/quoteScenario() — no puede desalinearse', () => {
  const lmConfig = {...defaultLmConfig(), mode:'gradual', verified:false, gradual:{maxPct:30, days:3, on:true}};
  const model = compute(config({lmConfig}));
  const q = quoteScenario({chId:'direct', days:1, nights:1, price:100}, config({lmConfig}));
  assert.equal(model.lmBlocked, isLmBlocked(lmConfig));
  assert.equal(q.lmBlocked, isLmBlocked(lmConfig));
});

test('buildMatrixVerdict: un veredicto que SERIA "RENTABLE EN TODOS" pero depende de LM no verificado NO se queda en nivel ok con una advertencia de mas', () => {
  // Config generosa: sin descuentos OTA, comisiones bajas — a nativos puros esto
  // saldria "RENTABLE EN TODOS" en cualquier ventana. El unico motivo por el que
  // el numero final depende de algo no verificado es el LM por defecto (ceiling_auto).
  const channels = freshChannels().map(c=>({...c, comm:5, bankFeePct:0}));
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = defaultLmConfig(); // ceiling_auto, sin verificar — el default real de la app
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:20, varCost:0, lmConfig};
  const model = compute({...qConfig, margin:10, marketBase:0});
  const w5 = windows.find(w=>w.id==='w5'); // "30+ dias", el mismo tipo de ventana que referencia el Base (dia 45)
  const ceil = ceilings[w5.id];
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w5, model.effBase || 150);

  const {vLvl, vTag} = buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.notEqual(vLvl, 'ok', 'no puede quedar en nivel "ok" sostenido por un LM automatico sin verificar');
  assert.ok(!vTag.startsWith('RENTABLE'), `el tag no puede seguir diciendo "RENTABLE..." sin mas: "${vTag}"`);
  assert.match(vTag, /SIN VERIFICAR/);
});

test('buildMatrixVerdict: con LM verificado en un modo configurable, el mismo escenario generoso SI puede quedar "RENTABLE EN TODOS"', () => {
  const channels = freshChannels().map(c=>({...c, comm:5, bankFeePct:0}));
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  // Verificado, y fuera del rango de esta ventana (0-3 dias vs. ventana 30+) — cero
  // ambiguedad de si el LM "no importó" o si de verdad está confirmado.
  const lmConfig = {mode:'flat', verified:true, flat:{pct:20, fromDay:0, toDay:3, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:20, varCost:0, lmConfig};
  const model = compute({...qConfig, margin:10, marketBase:0});
  assert.equal(model.lmBlocked, false);
  const w5 = windows.find(w=>w.id==='w5');
  const ceil = ceilings[w5.id];
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w5, model.effBase || 150);

  const {vLvl, vTag} = buildMatrixVerdict({model, ceil, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.equal(vLvl, 'ok');
  assert.equal(vTag, 'RENTABLE EN TODOS');
});

test('buildMatrixVerdict: TECHO EXCEDIDO y BAJO COSTO NO se bloquean por LM sin verificar — siguen mostrando el numero real', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = Object.fromEntries(windows.map(w=>[w.id, 0])); // techo 0% — cualquier nativo lo excede
  const lmConfig = defaultLmConfig();
  const qConfig = {channels, discounts, windows, ceilings, fixedCost:60, varCost:0, lmConfig};
  const model = compute({...qConfig, margin:45, marketBase:0});
  const w0 = windows.find(w=>w.id==='w0');
  const {worstTecho, worstPayoutRow, perChannel} = worstScenariosInWindow(qConfig, w0, model.effBase || 150);
  const {vLvl, vTag} = buildMatrixVerdict({model, ceil:0, worstTecho, worstPayoutRow, perChannel, currency:'USD'});
  assert.equal(vLvl, 'bad');
  assert.equal(vTag, 'TECHO EXCEDIDO', 'un techo realmente excedido (nativo puro, no depende de LM) debe seguir mostrandose tal cual, sin bloquearse');
});
