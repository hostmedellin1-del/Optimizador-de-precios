/* Auditoría de datos reales (src/domain/audit.js) — rollup de señales que ya
   calculan otros módulos, nunca reimplementa la regla de qué está pendiente.
   El estado final SOLO puede ser 'simulacion'/'datos_parciales'/
   'listo_supervisado' — nunca "produccion" (esa palabra no existe en este
   módulo, es una decisión que toma Dani). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAuditChecklist} from '../src/domain/audit.js';
import {evaluateRecommendationReadiness} from '../src/domain/readiness.js';
import {defaultVerification} from '../src/domain/verification.js';
import {freshChannels, freshDiscounts} from './helpers/state-factory.js';

function resolveAll(verification){
  verification.hospyOffsetIsolated.status = 'no_aplica';
  verification.bookingGeniusMobileBoth.status = 'no_aplica';
  verification.expediaVipTierMix.status = 'no_aplica';
  verification.airbnbNonRefundable.status = 'no_aplica';
  Object.keys(verification.bankFeePctByChannel).forEach(id=>{ verification.bankFeePctByChannel[id].status = 'verificado'; });
  return verification;
}

test('unidad nueva (costos de ejemplo, nada verificado): estado "simulacion", sin importar el resto', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = defaultVerification();
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:true, readiness, lmBlocked:true, channels, currency:'USD', fxRates:{}, lastReconciliation:null});
  assert.equal(audit.status, 'simulacion');
  assert.ok(!audit.items.find(i=>i.key==='costs').ok);
});

test('costos reales cargados pero nada más confirmado: estado "datos_parciales"', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = defaultVerification();
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:true, channels, currency:'USD', fxRates:{}, lastReconciliation:null});
  assert.equal(audit.status, 'datos_parciales');
  assert.ok(audit.items.find(i=>i.key==='costs').ok);
  assert.ok(!audit.items.find(i=>i.key==='lastMinute').ok);
  assert.ok(!audit.items.find(i=>i.key==='commissions').ok);
});

test('TODO confirmado (costos reales, readiness completo, LM verificado, sin moneda pendiente, reconciliación confiable): estado "listo_supervisado" — nunca "produccion"', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const lastReconciliation = {ok:true, currencyBlocked:false, reliable:true, diff:{percent:1.2}, severity:'ok'};
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', fxRates:{}, lastReconciliation});
  assert.equal(audit.status, 'listo_supervisado');
  assert.ok(audit.items.every(i=>i.ok));
  // El status en sí NUNCA es "produccion" — solo 3 valores posibles, y el
  // texto explicativo aclara "sigue sin ser producción" en vez de afirmarlo.
  assert.ok(['simulacion','datos_parciales','listo_supervisado'].includes(audit.status));
  assert.notEqual(audit.status, 'produccion');
});

test('falta confirmar la comisión bancaria de UN canal: item "commissions" en false, con ese canal nombrado', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts().map(d=>['bk_gen','bk_mob','ex_mod'].includes(d.id) ? {...d, on:false} : d);
  const verification = resolveAll(defaultVerification());
  verification.bankFeePctByChannel.direct.status = 'no_verificado'; // el unico pendiente
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', fxRates:{}, lastReconciliation:{ok:true,currencyBlocked:false,reliable:true,diff:{percent:0},severity:'ok'}});
  const item = audit.items.find(i=>i.key==='commissions');
  assert.equal(item.ok, false);
  assert.match(item.detail, /Directo/);
  assert.equal(audit.status, 'datos_parciales');
});

/* Simplificacion a USD unico (revision externa): el item "currency" del
   checklist ya no acepta ninguna forma de conversion — un canal marcado en
   otra moneda (dato viejo) SIEMPRE bloquea el item, sin excepcion posible. */
test('moneda: un canal con settlementCurrency distinta de USD (dato viejo) bloquea el item "currency", sin ningún camino para resolverlo salvo corregir el dato', () => {
  const channels = freshChannels().map(c=>c.id==='airbnb' ? {...c, settlementCurrency:'COP'} : c);
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', lastReconciliation:null});
  const item = audit.items.find(i=>i.key==='currency');
  assert.equal(item.ok, false);
  assert.match(item.detail, /COP/);
});

test('moneda: la UNIDAD misma marcada en una moneda distinta de USD bloquea el item "currency" con mensaje de "requiere revisión manual"', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'COP', lastReconciliation:null});
  const item = audit.items.find(i=>i.key==='currency');
  assert.equal(item.ok, false);
  assert.match(item.detail, /requiere revisión manual/);
  assert.equal(audit.status, 'datos_parciales', 'una unidad no-USD nunca puede llegar a listo_supervisado');
});

test('moneda: unidad en USD sin ningún canal marcado en otra moneda — item "currency" pasa', () => {
  const channels = freshChannels(); // settlementCurrency null en todos, catalogo de fabrica
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', lastReconciliation:null});
  assert.equal(audit.items.find(i=>i.key==='currency').ok, true);
});

test('sin ninguna reconciliación guardada: item "reconciliation" en false, con mensaje explícito', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', fxRates:{}, lastReconciliation:null});
  const item = audit.items.find(i=>i.key==='reconciliation');
  assert.equal(item.ok, false);
  assert.match(item.detail, /Todavía no has conciliado/);
});

test('última reconciliación con diferencia alta (no confiable): item "reconciliation" en false aunque exista', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const verification = resolveAll(defaultVerification());
  const readiness = evaluateRecommendationReadiness({channels, discounts, verification});
  const lastReconciliation = {ok:true, currencyBlocked:false, reliable:false, diff:{percent:-25}, severity:'bad'};
  const audit = buildAuditChecklist({usingExampleCosts:false, readiness, lmBlocked:false, channels, currency:'USD', fxRates:{}, lastReconciliation});
  assert.equal(audit.items.find(i=>i.key==='reconciliation').ok, false);
  assert.equal(audit.status, 'datos_parciales');
});
