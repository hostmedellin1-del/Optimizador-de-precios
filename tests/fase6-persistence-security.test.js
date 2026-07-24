/* Fase 6 — persistencia robusta: identidad por UUID, migracion v2->v3 no
   destructiva (probada via las funciones puras — el flujo de storage completo
   vive en index.html y se verifico manualmente en navegador), validacion de
   archivos de importacion, y escape de HTML para evitar XSS via datos
   guardados/importados. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newUnitId, buildV3Record, v3Key, validateImportFile, SCHEMA_VERSION} from '../src/domain/persistence.js';
import {escapeHtml} from '../src/domain/sanitize.js';

test('newUnitId genera identificadores unicos', () => {
  const a = newUnitId(), b = newUnitId();
  assert.notEqual(a, b);
  assert.ok(a.length > 8);
});

test('buildV3Record agrega id/schemaVersion/savedAt sin tocar campos de negocio', () => {
  const state = {name:'Unidad X', fixedCost:50, varCost:20};
  const record = buildV3Record(state);
  assert.equal(record.name, 'Unidad X');
  assert.equal(record.fixedCost, 50);
  assert.equal(record.schemaVersion, SCHEMA_VERSION);
  assert.ok(record.id);
  assert.ok(record.savedAt);
  assert.equal(v3Key(record.id), 'v3:'+record.id);
});

test('buildV3Record migrando desde v2 conserva el rastro de origen (no destructivo)', () => {
  const record = buildV3Record({name:'Unidad Vieja'}, {migratedFromV2Key:'v2:unidad-vieja'});
  assert.equal(record.migratedFromV2Key, 'v2:unidad-vieja');
});

test('validateImportFile rechaza un archivo sin arreglo "units"', () => {
  const r = validateImportFile({foo:'bar'});
  assert.equal(r.valid, false);
  assert.equal(r.items.length, 0);
});

test('validateImportFile rechaza JSON invalido en "value" sin escribirlo', () => {
  const r = validateImportFile({units:[{key:'v2:x', value:'{esto no es json'}]});
  assert.equal(r.valid, false);
  assert.equal(r.items.length, 0);
  assert.ok(r.errors.length>0);
});

test('validateImportFile rechaza elementos sin "name" (no tienen forma de unidad)', () => {
  const r = validateImportFile({units:[{key:'v3:abc', value: JSON.stringify({fixedCost:1})}]});
  assert.equal(r.valid, false);
});

test('validateImportFile acepta un archivo bien formado y descarta solo los elementos invalidos', () => {
  const good = {key:'v3:abc', value: JSON.stringify({name:'Buena', id:'abc'})};
  const bad = {key:'v2:mal', value: 'no-json'};
  const r = validateImportFile({units:[good, bad]});
  assert.equal(r.valid, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].key, 'v3:abc');
  assert.equal(r.errors.length, 1);
});

test('escapeHtml neutraliza un nombre de descuento/unidad malicioso (XSS)', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const escaped = escapeHtml(malicious);
  assert.ok(!escaped.includes('<img'));
  assert.equal(escaped, '&lt;img src=x onerror=alert(1)&gt;');
});

test('escapeHtml maneja comillas (evita escapar un atributo HTML)', () => {
  const malicious = `"><script>alert(1)</script>`;
  const escaped = escapeHtml(malicious);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('"'));
});

test('escapeHtml es seguro con null/undefined/numeros', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});
