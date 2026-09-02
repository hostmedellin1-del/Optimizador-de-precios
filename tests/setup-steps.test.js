/* Fase 1 de usabilidad (ago 2026) — pendingSetupSteps() (src/domain/readiness.js).

   Por que existe: una unidad nueva quedaba bloqueada por dos gates a la vez
   (Last-Minute sin verificar + costos de ejemplo 32/22) y la unica
   explicacion visible era un parrafo de 695 caracteres lleno de jerga, que
   nunca decia "hace estas dos cosas". Esta funcion pura traduce los mismos
   tres booleanos que ya expone compute() a una lista concreta y accionable. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pendingSetupSteps} from '../src/domain/readiness.js';

test('ambos gates activos -> 2 pasos, ambos done:false', () => {
  const steps = pendingSetupSteps({lmBlocked:true, costBlocked:true, currencyBlocked:false});
  assert.equal(steps.length, 2);
  assert.ok(steps.every(s => s.done === false));
  assert.deepEqual(steps.map(s=>s.id).sort(), ['costos','lm']);
});

test('costBlocked:false -> el paso de costos queda done:true, el de LM sigue en false', () => {
  const steps = pendingSetupSteps({lmBlocked:true, costBlocked:false, currencyBlocked:false});
  const costos = steps.find(s=>s.id==='costos');
  const lm = steps.find(s=>s.id==='lm');
  assert.equal(costos.done, true);
  assert.equal(lm.done, false);
});

test('todo resuelto -> todos done:true (la lista nunca queda vacia)', () => {
  const steps = pendingSetupSteps({lmBlocked:false, costBlocked:false, currencyBlocked:false});
  assert.equal(steps.length, 2);
  assert.ok(steps.every(s => s.done === true));
});

test('currencyBlocked:true agrega el paso de moneda; false no lo incluye', () => {
  const withCurrency = pendingSetupSteps({lmBlocked:false, costBlocked:false, currencyBlocked:true});
  assert.equal(withCurrency.length, 3);
  const moneda = withCurrency.find(s=>s.id==='moneda');
  assert.ok(moneda);
  assert.equal(moneda.anchor, null);
  assert.equal(moneda.done, false);

  const withoutCurrency = pendingSetupSteps({lmBlocked:false, costBlocked:false, currencyBlocked:false});
  assert.equal(withoutCurrency.find(s=>s.id==='moneda'), undefined);
});

test('cada paso completo devuelve la lista SIEMPRE (nunca []), incluso sin argumentos', () => {
  const steps = pendingSetupSteps();
  assert.equal(steps.length, 2);
});

test('guarda de lenguaje: ningun label/why usa jerga tecnica prohibida', () => {
  const forbidden = ['GLOBAL', 'proyección', 'matemáticamente', 'readiness', 'gate'];
  const allSteps = [
    ...pendingSetupSteps({lmBlocked:true, costBlocked:true, currencyBlocked:true}),
  ];
  allSteps.forEach(step => {
    forbidden.forEach(word => {
      assert.ok(!step.label.toLowerCase().includes(word.toLowerCase()), `label de "${step.id}" no debe contener "${word}"`);
      assert.ok(!step.why.toLowerCase().includes(word.toLowerCase()), `why de "${step.id}" no debe contener "${word}"`);
    });
  });
});

test('cada paso trae la forma completa esperada por index.html', () => {
  const steps = pendingSetupSteps({lmBlocked:true, costBlocked:true, currencyBlocked:true});
  steps.forEach(step => {
    assert.equal(typeof step.id, 'string');
    assert.equal(typeof step.done, 'boolean');
    assert.equal(step.tab, 'resumen');
    assert.equal(typeof step.label, 'string');
    assert.equal(typeof step.why, 'string');
    assert.ok(step.label.length > 0);
    assert.ok(step.why.length > 0);
  });
});
