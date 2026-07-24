/* evaluateUsdManualReviewState() (src/domain/usd-only.js) — auditoria
   externa, ronda 6: "bypass de copia COP→USD por importación". Hallazgo
   confirmado: antes de esta función, `evaluateUsdOnlyReadiness()` confiaba
   ciegamente en el booleano `usdManualReviewPending` — un JSON exportado y
   editado a mano para poner `usdManualReviewPending:false`, pero dejando en
   `usdManualReviewLog` un `copy_created` SIN un `review_confirmed` real
   después, desbloqueaba la unidad igual (mostraba Piso/Base con valores que
   originalmente eran COP). Esta función es la fuente ÚNICA y pura que cruza
   el booleano contra la bitácora, en orden temporal, para decidir el estado
   EFECTIVO — nunca el booleano crudo por sí solo. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateUsdManualReviewState} from '../src/domain/usd-only.js';

test('sin log y sin usdManualReviewPending: no pendiente (unidad USD normal preexistente) — cero regresión', () => {
  const r = evaluateUsdManualReviewState({});
  assert.equal(r.pending, false);
  assert.equal(r.reason, null);
});

test('sin log y usdManualReviewPending:false explícito: no pendiente', () => {
  const r = evaluateUsdManualReviewState({usdManualReviewPending:false, usdManualReviewLog:[]});
  assert.equal(r.pending, false);
});

test('usdManualReviewPending:true sin log en absoluto (copia recién creada, aún no hay entradas): pendiente', () => {
  const r = evaluateUsdManualReviewState({usdManualReviewPending:true, usdManualReviewLog:[]});
  assert.equal(r.pending, true);
  assert.equal(r.inconsistentRaw, false);
});

/* ===== EL BYPASS EXACTO reportado ===== */
test('BYPASS: usdManualReviewPending:false pero log con copy_created SIN review_confirmed posterior — sigue pendiente (bloqueado), marcado como contradicción', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [{at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'}]
  });
  assert.equal(r.pending, true, 'ANTES del fix esto daba false — el booleano crudo se aceptaba sin cruzar la bitácora');
  assert.equal(r.inconsistentRaw, true);
  assert.match(r.reason, /revisión ya se había completado/);
});

test('copy_created seguido de review_confirmed VÁLIDO y posterior: no pendiente (revisión real completada)', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'},
      {at:'2026-07-24T11:00:00.000Z', event:'review_confirmed', text:'Revisé manualmente...'}
    ]
  });
  assert.equal(r.pending, false);
  assert.equal(r.inconsistentRaw, false);
});

test('review_confirmed ANTES del copy_created (orden imposible/manipulado) — sigue pendiente: la confirmación no es posterior a la copia que dice confirmar', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T09:00:00.000Z', event:'review_confirmed', text:'confirmación fechada ANTES de la copia'},
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'}
    ]
  });
  assert.equal(r.pending, true, 'una confirmación fechada antes de la copia no puede contar como revisión de ESA copia');
});

test('dos copias sucesivas: copy_created → review_confirmed → copy_created (re-copiada) sin confirmar de nuevo — vuelve a quedar pendiente', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'primera copia'},
      {at:'2026-07-24T11:00:00.000Z', event:'review_confirmed', text:'primera revisión'},
      {at:'2026-07-24T12:00:00.000Z', event:'copy_created', text:'segunda copia (re-derivada)'}
    ]
  });
  assert.equal(r.pending, true, 'la confirmación vieja no cubre la copia NUEVA — solo cuenta lo que pasa después del último copy_created');
});

test('evento desconocido en el log (ej. "hackeado_confirmado") nunca cuenta como confirmación — sigue pendiente', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'copia'},
      {at:'2026-07-24T11:00:00.000Z', event:'hackeado_confirmado', text:'intento de evento inventado'}
    ]
  });
  assert.equal(r.pending, true);
});

test('review_confirmed con fecha inválida/ausente nunca cuenta como confirmación válida — sigue pendiente', () => {
  const r1 = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'copia'},
      {at:'fecha-invalida-no-parseable', event:'review_confirmed', text:'confirmación con fecha basura'}
    ]
  });
  assert.equal(r1.pending, true);
  const r2 = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'copia'},
      {event:'review_confirmed', text:'confirmación sin fecha en absoluto'}
    ]
  });
  assert.equal(r2.pending, true);
});

test('log no es un arreglo (objeto suelto, string, null) — se trata como vacío, nunca rompe', () => {
  for(const bad of [{not:'array'}, 'texto', null, 42]){
    assert.doesNotThrow(() => evaluateUsdManualReviewState({usdManualReviewPending:false, usdManualReviewLog: bad}));
    const r = evaluateUsdManualReviewState({usdManualReviewPending:false, usdManualReviewLog: bad});
    assert.equal(r.pending, false);
  }
});

test('entradas con empate exacto de fecha: el orden del arreglo (append-only) desempata', () => {
  const sameTime = '2026-07-24T10:00:00.000Z';
  const rBlocked = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at: sameTime, event:'review_confirmed', text:'confirmación primero en el arreglo'},
      {at: sameTime, event:'copy_created', text:'copia despues en el arreglo, mismo instante'}
    ]
  });
  assert.equal(rBlocked.pending, true, 'la confirmación quedó ANTES en el arreglo que la copia (mismo timestamp) — no cubre la copia');

  const rOk = evaluateUsdManualReviewState({
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at: sameTime, event:'copy_created', text:'copia primero en el arreglo'},
      {at: sameTime, event:'review_confirmed', text:'confirmación despues en el arreglo, mismo instante'}
    ]
  });
  assert.equal(rOk.pending, false);
});

test('config vacío/ausente: no revienta, no pendiente', () => {
  const r = evaluateUsdManualReviewState();
  assert.equal(r.pending, false);
  assert.equal(r.reason, null);
});

test('usdManualReviewPending:true GANA sobre un log que, por sí solo, ya luciría confirmado (nunca desbloquea antes de que la UI lo apague explícitamente)', () => {
  const r = evaluateUsdManualReviewState({
    usdManualReviewPending: true,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'copia'},
      {at:'2026-07-24T11:00:00.000Z', event:'review_confirmed', text:'confirmación'}
    ]
  });
  assert.equal(r.pending, true);
});
