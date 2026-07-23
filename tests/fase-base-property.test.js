/* Bloqueante 8 (revision externa, ronda 1) — propiedad "Base => payout >= neto objetivo".

   Bloqueante ALTO (revision externa, RONDA 2) — este archivo ANTES neutralizaba
   el offset a 0 ("channelsNoOffset") para poder pasar, y afirmaba explicitamente
   que Base NO debia cambiar con lmConfig. El revisor senalo, con razon, que eso
   no prueba el comportamiento con la configuracion REAL: en cuanto Dani pone un
   offset real (ej. Booking -15% para competir) o un LM verificado, el texto
   "netea tu objetivo" dejaba de ser matematicamente cierto para Base, aunque
   siguiera siendo cierto para la config hipotetica de offset=0/sin LM.

   Se resolvio con la OPCION RECOMENDADA por el revisor: Base ahora incorpora el
   Offset y el LM REALMENTE configurados de cada canal en su escenario de
   referencia (dia 45, nativos constantes) — ver engine.js, lmPctAtDay45(). Base
   sigue siendo un PUNTO DE REFERENCIA UNICO, nunca una busqueda exhaustiva de
   peor caso (esa sigue siendo tarea exclusiva del Piso) — la diferencia es que
   ahora usa los valores reales en vez de asumir cero. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

test('PROPIEDAD — Base cotizado en su escenario de referencia, CON offset y LM reales (sin neutralizar nada), neta >= neto objetivo', () => {
  const channels = freshChannels().map(c=>{
    if(c.id==='booking') return {...c, offsetPct:-12}; // offset NEGATIVO real, no neutralizado
    if(c.id==='direct') return {...c, offsetPct:8};      // offset POSITIVO real, no neutralizado
    return c;
  });
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {mode:'flat', verified:true, flat:{pct:20, fromDay:0, toDay:365, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};
  const model = compute({fixedCost:60, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings, lmConfig});
  assert.equal(model.valid, true);
  assert.equal(model.lmBlocked, false, 'LM plano y verificado no debe bloquear el resultado');
  assert.ok(model.base>0);

  for(const c of channels){
    const q = quoteScenario({chId:c.id, days:45, nights:1, price:model.base}, {channels, discounts, windows, ceilings, fixedCost:60, varCost:0, lmConfig});
    assert.ok(q.payout >= model.net - 1e-6, `Base (${model.base.toFixed(2)}) cotizado en ${c.id} con su offset real (${c.offsetPct}%) y LM 20% activo debe netear >= objetivo (${model.net.toFixed(2)}); dio ${q.payout.toFixed(2)}`);
  }
});

test('Base sube con offset negativo y baja con offset positivo, para el mismo canal aislado', () => {
  const channels0 = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const cfg = off => ({fixedCost:60, varCost:0, margin:45, marketBase:0, channels: channels0.map(c=>({...c, offsetPct:off})), discounts, windows, ceilings});

  const m0 = compute(cfg(0));
  const mNeg = compute(cfg(-20));
  const mPos = compute(cfg(20));

  assert.ok(mNeg.base > m0.base, 'offset negativo (bajar precio para competir) debe EXIGIR un Base mas alto para seguir neteando el mismo objetivo — igual que ya pasa con el Piso');
  assert.ok(mPos.base < m0.base, 'offset positivo (ya compensa la comision) debe permitir un Base mas bajo');

  // Y el Base resultante SI netea el objetivo cotizado con ESE offset real, sin neutralizarlo:
  const q = quoteScenario({chId:'direct', days:45, nights:1, price:mNeg.base}, {channels: channels0.map(c=>({...c, offsetPct:-20})), discounts, windows, ceilings, fixedCost:60, varCost:0});
  assert.ok(q.payout >= mNeg.net - 1e-6, 'Base con offset -20% real debe netear >= objetivo cuando se cotiza CON ese mismo offset');
});

test('Base SI cambia con lmConfig activo a día 45 (antes lo excluía por completo — ya no)', () => {
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {mode:'flat', verified:true, flat:{pct:50, fromDay:40, toDay:50, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};

  const sinLm = compute({fixedCost:100, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings});
  const conLm = compute({fixedCost:100, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings, lmConfig});

  assert.notEqual(sinLm.base, conLm.base, 'Base debe reaccionar al LM real configurado a día 45 (antes lo ignoraba por completo, sin importar el modo)');
  assert.ok(conLm.base > sinLm.base, 'un LM que resta 50% en día 45 obliga a un Base más alto para seguir neteando el mismo objetivo');
  assert.notEqual(sinLm.floor, conLm.floor, 'el Piso también sigue cambiando con lmConfig (búsqueda exhaustiva, sin cambios en este bloqueante)');

  // Y ese Base más alto SI netea el objetivo cotizado con el LM real activo a día 45:
  const q = quoteScenario({chId:'direct', days:45, nights:1, price:conLm.base}, {channels, discounts, windows, ceilings, fixedCost:100, varCost:0, lmConfig});
  assert.ok(q.payout >= conLm.net - 1e-6, 'Base con LM 50% activo a día 45 debe netear >= objetivo cuando se cotiza CON ese mismo LM');
});

test('Base con offset <= -100% en el único canal da Infinity y se refleja como error de resultado no válido, no como número roto', () => {
  const channels = freshChannels().filter(c=>c.id==='direct').map(c=>({...c, offsetPct:-100}));
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const model = compute({fixedCost:60, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings});
  assert.equal(model.base, Infinity);
  assert.equal(model.valid, false, 'un Base infinito debe bloquear el resultado, no mostrarse como recomendación');
});
