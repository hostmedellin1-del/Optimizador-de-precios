/* Bloqueante MEDIO (revision externa, ronda 2) — normalizeUnit() protege la
   importacion, pero la edicion MANUAL en index.html seguia usando
   `parseFloat(t.value)||0`: un valor invalido se volvia 0 en silencio, sin
   distinguirse de que Dani escribio 0 a proposito. parseValue()/parsePct()/
   validateRange() (src/domain/input-parse.js) son la fuente unica que ahora
   usan TODOS los handlers de edicion manual — este archivo prueba esa fuente
   directamente (la parte pura, testeable sin DOM); el E2E
   (e2e/manual-input-validation.spec.js) prueba la integracion real con el
   input del navegador (revertir el valor, mostrar el aviso). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseValue, parsePct, validateRange} from '../src/domain/input-parse.js';
import {validateLmTiersOverlap} from '../src/domain/validate.js';

test('parseValue: rechaza texto no numerico, NUNCA lo convierte a 0', () => {
  const r = parseValue('abc', {min:0, max:100, label:'Comisión'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no es un número válido/);
});

test('parseValue: rechaza vacio por defecto (a menos que allowEmpty)', () => {
  const r = parseValue('', {min:0, max:100, label:'Comisión'});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no puede quedar vacío/);
});

test('parseValue: allowEmpty devuelve emptyValue en vez de rechazar', () => {
  const r = parseValue('', {allowEmpty:true, emptyValue:9999});
  assert.equal(r.ok, true);
  assert.equal(r.value, 9999);
});

test('parseValue: rechaza NaN/Infinity explicitos', () => {
  assert.equal(parseValue('NaN', {}).ok, false);
  assert.equal(parseValue('Infinity', {}).ok, false);
  assert.equal(parseValue('-Infinity', {}).ok, false);
});

test('parseValue: rechaza fuera de rango (min/max), acepta dentro del rango', () => {
  assert.equal(parseValue('150', {min:0, max:100}).ok, false);
  assert.equal(parseValue('-5', {min:0, max:100}).ok, false);
  const ok = parseValue('50', {min:0, max:100});
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 50);
});

test('parseValue: integer:true rechaza decimales', () => {
  const r = parseValue('3.5', {integer:true, min:0, max:100});
  assert.equal(r.ok, false);
  assert.match(r.reason, /entero/);
  assert.equal(parseValue('3', {integer:true, min:0, max:100}).ok, true);
});

test('parsePct: rechaza negativos por defecto, acepta con allowNegative (Offset)', () => {
  assert.equal(parsePct('-10').ok, false);
  assert.equal(parsePct('-10', {allowNegative:true}).ok, true);
});

test('parsePct: rechaza >=100 (100% o mas no tiene sentido de negocio)', () => {
  assert.equal(parsePct('100').ok, false);
  assert.equal(parsePct('99.9').ok, true);
});

test('validateRange: detecta desde > hasta invertido', () => {
  const bad = validateRange(30, 10, 'Early-bird');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /invertido|no puede ser mayor/);
  const good = validateRange(10, 30, 'Early-bird');
  assert.equal(good.ok, true);
});

test('validateLmTiersOverlap: detecta tramos activos que se solapan y explica cual gana (politica "primero del arreglo")', () => {
  const tiers = [
    {id:'a', label:'A', fromDay:0, toDay:5, pct:20, on:true},
    {id:'b', label:'B', fromDay:3, toDay:10, pct:30, on:true}
  ];
  const errs = validateLmTiersOverlap(tiers);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].level, 'warning');
  assert.match(errs[0].msg, /"A"/, 'debe nombrar cual tramo gana (el primero del arreglo)');
});

test('validateLmTiersOverlap: tramos apagados no cuentan como solape', () => {
  const tiers = [
    {id:'a', label:'A', fromDay:0, toDay:5, pct:20, on:false},
    {id:'b', label:'B', fromDay:3, toDay:10, pct:30, on:true}
  ];
  assert.equal(validateLmTiersOverlap(tiers).length, 0);
});

test('validateLmTiersOverlap: tramos consecutivos sin solape real no generan aviso', () => {
  const tiers = [
    {id:'a', label:'A', fromDay:0, toDay:5, pct:20, on:true},
    {id:'b', label:'B', fromDay:6, toDay:10, pct:30, on:true}
  ];
  assert.equal(validateLmTiersOverlap(tiers).length, 0);
});
