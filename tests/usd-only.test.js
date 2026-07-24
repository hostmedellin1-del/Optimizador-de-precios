/* evaluateUsdOnlyReadiness() (src/domain/usd-only.js) — auditoria externa,
   ronda 4, BLOQUEANTE 1: fuente unica de verdad para "¿esta unidad tiene
   ALGUN dato monetario activo que no sea USD?". Reproduce explicitamente el
   hallazgo confirmado: una unidad con unitCurrency==='USD' pero con un canal
   historico marcado settlementCurrency:'COP' DEBE bloquear igual que si la
   unidad misma estuviera en otra moneda. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateUsdOnlyReadiness} from '../src/domain/usd-only.js';
import {freshChannels} from './helpers/state-factory.js';

test('unidad en USD, todos los canales sin settlementCurrency: no bloquea', () => {
  const r = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels: freshChannels()});
  assert.equal(r.blocked, false);
  assert.equal(r.reason, null);
  assert.deepEqual(r.nonUsdChannels, []);
});

test('unidad misma en COP (sin importar los canales): bloquea, con motivo explícito', () => {
  const r = evaluateUsdOnlyReadiness({unitCurrency:'COP', channels: freshChannels()});
  assert.equal(r.blocked, true);
  assert.match(r.reason, /COP/);
});

/* BLOQUEANTE 1 — el hallazgo exacto de la auditoria externa: unidad en USD
   pero UN canal historico marcado en otra moneda. */
test('BLOQUEANTE 1: unidad en USD + Airbnb con settlementCurrency:"COP" (dato histórico) — bloquea igual que si la unidad misma estuviera en COP', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb' ? {...c, settlementCurrency:'COP'} : c);
  const r = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels});
  assert.equal(r.blocked, true, 'un canal en otra moneda debe bloquear TODA la unidad, no solo ese canal');
  assert.match(r.reason, /Airbnb/);
  assert.match(r.reason, /COP/);
  assert.equal(r.nonUsdChannels.length, 1);
  assert.equal(r.nonUsdChannels[0].id, 'airbnb');
});

test('varios canales en distinta moneda: se listan todos en nonUsdChannels y en el motivo', () => {
  const channels = freshChannels().map(c=>{
    if(c.id==='airbnb') return {...c, settlementCurrency:'COP'};
    if(c.id==='booking') return {...c, settlementCurrency:'EUR'};
    return c;
  });
  const r = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels});
  assert.equal(r.blocked, true);
  assert.equal(r.nonUsdChannels.length, 2);
  assert.match(r.reason, /Airbnb/);
  assert.match(r.reason, /Booking/);
});

test('unidad en COP Y un canal en COP: sigue bloqueado (union, no exclusivo), motivo menciona ambos', () => {
  const channels = freshChannels().map(c=>c.id==='direct' ? {...c, settlementCurrency:'COP'} : c);
  const r = evaluateUsdOnlyReadiness({unitCurrency:'COP', channels});
  assert.equal(r.blocked, true);
  assert.equal(r.reasons.length, 2);
});

test('sin channels (undefined) y unitCurrency USD: no bloquea, no rompe', () => {
  const r = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels: undefined});
  assert.equal(r.blocked, false);
});

test('legacyData con una moneda distinta de USD: bloquea y nombra el dato', () => {
  const r = evaluateUsdOnlyReadiness({unitCurrency:'USD', channels: freshChannels(), legacyData:[{label:'Un tipo de cambio guardado', currency:'COP'}]});
  assert.equal(r.blocked, true);
  assert.match(r.reason, /tipo de cambio/);
});

test('config vacio/ausente: no bloquea, no rompe', () => {
  const r = evaluateUsdOnlyReadiness();
  assert.equal(r.blocked, false);
  assert.equal(r.reason, null);
});
