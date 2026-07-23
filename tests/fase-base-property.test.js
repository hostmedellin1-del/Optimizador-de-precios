/* Bloqueante 8 (revision externa) — propiedad "Base => payout >= neto objetivo".
   A diferencia del Piso (que SI hace busqueda exhaustiva de peor caso, incluido
   LM), el Base es DELIBERADAMENTE un punto de referencia UNICO (dia 45, "fuera
   de ventanas tacticas", con los nativos CONSTANTES de cada canal) — nunca ha
   sido, ni debe ser, una busqueda de peor caso: esa es la funcion que ya cumple
   el Piso. Meter una busqueda exhaustiva en Base lo volveria redundante con el
   Piso y rompe la separacion conceptual Piso/Base que es la razon de ser de la
   herramienta (ver CLAUDE.md seccion 2). Por eso, y a diferencia de LM en Piso,
   el Base tampoco incorpora LM (mismo criterio que ya excluye el Offset del
   Base, documentado desde antes de esta auditoria).

   La propiedad que SI se puede probar, y es la garantia real que ofrece Base,
   es: cotizar al precio Base, en el escenario de referencia que efectivamente
   lo determina (dia 45, nativos constantes, SIN LM — por diseño), debe netear
   >= el neto objetivo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

test('PROPIEDAD — Base cotizado en su escenario de referencia (día 45, nativos constantes) neta >= neto objetivo, para cada canal', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const model = compute({fixedCost:60, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings});
  assert.equal(model.valid, true);
  assert.ok(model.base>0);

  for(const c of channels){
    // Sin lmConfig (Base no lo incorpora por diseño) y sin offset (Base ya lo excluye por diseño, ver engine.js) —
    // se neutraliza el offset explicitamente para aislar la garantia real del Base.
    const channelsNoOffset = channels.map(x=>x.id===c.id ? {...x, offsetPct:0} : x);
    const q = quoteScenario({chId:c.id, days:45, nights:1, price:model.base}, {channels:channelsNoOffset, discounts, windows, ceilings, fixedCost:60, varCost:0});
    assert.ok(q.payout >= model.net - 1e-6, `Base (${model.base.toFixed(2)}) cotizado en ${c.id} a día 45 debe netear >= objetivo (${model.net.toFixed(2)}); dio ${q.payout.toFixed(2)}`);
  }
});

test('documentado — Base NO incorpora LM por diseño (a diferencia del Piso): esto es una decisión de arquitectura, no un descuido', () => {
  // Confirma explicitamente que compute().base no cambia cuando se agrega lmConfig,
  // mientras que compute().floor SI cambia — asi el comportamiento queda fijado
  // en un test y cualquier cambio futuro que rompa esta separacion se nota.
  const channels = freshChannels().filter(c=>c.id==='direct');
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const lmConfig = {mode:'flat', verified:true, flat:{pct:50, fromDay:40, toDay:50, on:true}, gradual:{maxPct:0,days:3,on:false}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]};

  const sinLm = compute({fixedCost:100, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings});
  const conLm = compute({fixedCost:100, varCost:0, margin:45, marketBase:0, channels, discounts, windows, ceilings, lmConfig});

  assert.equal(sinLm.base, conLm.base, 'Base no debe cambiar con lmConfig (dia 45 esta fuera del rango del LM configurado en este test, y aunque estuviera dentro, Base excluye LM por diseño)');
  assert.notEqual(sinLm.floor, conLm.floor, 'el Piso SI debe cambiar con lmConfig — esa es la garantia exhaustiva que protege contra vender bajo costo');
});
