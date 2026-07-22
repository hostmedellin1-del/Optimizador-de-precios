/* Fase 2 — evidencia de consistencia: pruebas SUPLEMENTARIAS (no forman parte de
   la matriz bug->test de regression.test.js) que demuestran que el Piso
   (compute().floor) y quoteScenario() estan alineados matematicamente, aunque el
   Piso no pueda "llamar" a quoteScenario() directamente (el Piso resuelve el
   problema inverso: que precio da exactamente el costo; quoteScenario() resuelve
   el directo: dado un precio, que neto da). La evidencia pedida es que cotizar AL
   PRECIO DEL PISO, en el escenario que efectivamente lo determina, debe netear
   >= costo para cada canal — nunca menos. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, worstNative, combineChannel} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {criticalDays, criticalNights} from '../src/domain/thresholds.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

test('evidencia — cotizar al Piso, en el peor escenario real de CADA canal, nunca neta bajo costo', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  const cost = 70;
  const model = compute({fixedCost: cost, varCost: 0, margin: 45, marketBase: 0, channels, discounts, windows});
  assert.equal(model.cost, cost);
  assert.ok(model.floor > 0);

  const days = criticalDays(discounts, windows);
  const nights = criticalNights(discounts);

  for (const c of channels) {
    // Encuentra el (dia,noche) real que produce el peor nativo de ESTE canal —
    // el mismo par que worstNative() ya usa internamente para fijar el Piso.
    let worstPct = -1, worstDay = 0, worstNight = 1;
    for (const d of days) for (const n of nights) {
      const t = combineChannel(discounts, c.id, d, n).totalPct;
      if (t > worstPct) { worstPct = t; worstDay = d; worstNight = n; }
    }
    assert.equal(worstPct, worstNative(discounts, c.id, windows), `worstNative(${c.id}) debe coincidir con el maximo encontrado por la misma enumeracion`);
    // Cotiza AL PISO, en ese escenario, con techo=0 en todas las ventanas: fuerza
    // lm=0 siempre (breach garantizado salvo que el nativo tambien sea 0, caso en
    // que la formula igual da 0) — aisla el Piso de la dinamica del LM. OJO: un
    // techo ALTO (ej. 100%) NO aisla nada, produce el efecto contrario: el LM
    // interpreta el hueco entre nativo y techo como espacio propio para descontar,
    // y puede licuar el precio (lm->100%). Techo BAJO es lo que neutraliza el LM.
    const zeroCeilings = Object.fromEntries(windows.map(w => [w.id, 0]));
    const q = quoteScenario({chId: c.id, days: worstDay, nights: worstNight, price: model.floor}, {channels, discounts, windows, ceilings: zeroCeilings, fixedCost: cost, varCost: 0});
    assert.ok(q.payout >= cost - 0.5, `cotizando ${c.id} al Piso (${model.floor.toFixed(2)}) en su peor escenario real (dia ${worstDay}, ${worstNight} noches), el neto (${q.payout.toFixed(2)}) debe cubrir el costo (${cost})`);
  }
});
