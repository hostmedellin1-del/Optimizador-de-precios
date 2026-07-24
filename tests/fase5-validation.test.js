/* Fase 5 — validacion de inputs invalidos y bloqueo de resultados financieros
   no confiables. El motor nunca lanza: sigue calculando, pero marca `valid:false`
   y explica por que en `errors` cuando el resultado no se puede confiar. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {validateCostInputs, validateChannelInputs, isBadNumber} from '../src/domain/validate.js';
import {freshChannels, freshDiscounts, freshWindows} from './helpers/state-factory.js';

test('validateCostInputs detecta margen >=100% (division por cero en el neto objetivo)', () => {
  const errs = validateCostInputs({fixedCost:50, varCost:0, margin:100});
  assert.ok(errs.some(e=>e.level==='error' && e.field==='margin'));
});

test('validateCostInputs detecta costos negativos', () => {
  const errs = validateCostInputs({fixedCost:-10, varCost:0, margin:45});
  assert.ok(errs.some(e=>e.level==='error' && e.field==='fixedCost'));
});

test('validateChannelInputs detecta comision+bancaria >=100% (payout nunca positivo)', () => {
  const channels = freshChannels();
  channels[0].comm = 95; channels[0].bankFeePct = 10;
  const errs = validateChannelInputs(channels);
  assert.ok(errs.some(e=>e.level==='error' && e.msg.includes('payout nunca puede ser positivo')));
});

test('validateChannelInputs detecta offset <= -100%', () => {
  const channels = freshChannels();
  channels[0].offsetPct = -150;
  const errs = validateChannelInputs(channels);
  assert.ok(errs.some(e=>e.level==='error' && e.field.includes('offsetPct')));
});

test('compute() con canal invalido (comision >=100%): valid=false, floor/base bloqueados con motivo, nunca NaN silencioso', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  channels.forEach(c=>{ c.comm = 150; }); // invalido en TODOS los canales
  const model = compute({fixedCost:50, varCost:0, margin:45, marketBase:0, channels, discounts, windows});
  assert.equal(model.valid, false, 'el modelo debe marcarse invalido');
  assert.ok(model.errors.length>0, 'debe explicar el motivo, no solo fallar en silencio');
  assert.ok(isBadNumber(model.floor) || model.floor===Infinity, 'con comision >100%, el piso no puede ser un numero finito confiable');
});

test('compute() con inputs validos: valid=true, sin errores de nivel error', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const model = compute({fixedCost:54, varCost:0, margin:45, marketBase:0, channels, discounts, windows});
  assert.equal(model.valid, true);
  assert.equal(model.errors.filter(e=>e.level==='error').length, 0);
});

test('compute() con margen extremo (>90%) da warning pero NO bloquea (se recorta a 90 para el calculo)', () => {
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const model = compute({fixedCost:50, varCost:0, margin:95, marketBase:0, channels, discounts, windows});
  assert.equal(model.valid, true, 'un margen alto no es un error bloqueante, solo un aviso');
  assert.ok(model.errors.some(e=>e.level==='warning' && e.field==='margin'));
});
