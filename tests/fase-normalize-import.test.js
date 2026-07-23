/* BLOQUEANTE ALTO (revision externa) — normalizeUnit() es la funcion UNICA que
   convierte cualquier registro v2/v3 (guardado, cargado o importado) en un
   estado completo y seguro. Cubre: XSS via campos "numericos", datos
   importados malformados que rompian map/find/render, y coercion silenciosa
   ||0 reemplazada por validacion explicita + warnings. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnit, validateImportFile} from '../src/domain/persistence.js';
import {escapeHtml} from '../src/domain/sanitize.js';

test('normalizeUnit neutraliza un payload XSS en un campo "numerico" (pct) — nunca queda como string', () => {
  const {state, warnings} = normalizeUnit({name:'X', discounts:[{id:'ab_los4', on:true, pct:'1" onmouseover="alert(1)'}]});
  const d = state.discounts.find(x=>x.id==='ab_los4');
  assert.equal(typeof d.pct, 'number', 'pct debe ser un numero JS real, nunca un string (un numero no puede romper un atributo HTML)');
  assert.ok(warnings.some(w=>w.includes('pct')));
});

test('normalizeUnit rechaza discounts con id desconocido (no inventa descuentos nuevos desde un import)', () => {
  const {state} = normalizeUnit({name:'X', discounts:[{id:'evil_injected_discount', pct:50, on:true}]});
  assert.equal(state.discounts.some(d=>d.id==='evil_injected_discount'), false);
  assert.equal(state.discounts.length, 36, 'debe quedar exactamente el catalogo conocido, ni mas ni menos');
});

test('normalizeUnit sobrevive a discounts ausente, no-array, channels no-array, sin romper', () => {
  assert.doesNotThrow(() => normalizeUnit({name:'X'}));
  assert.doesNotThrow(() => normalizeUnit({name:'X', discounts:'no soy un arreglo'}));
  assert.doesNotThrow(() => normalizeUnit({name:'X', channels:{no:'soy un arreglo'}}));
  assert.doesNotThrow(() => normalizeUnit({name:'X', discounts:null, channels:null, lmConfig:null, verification:null, costBreakdown:null}));
  const {state} = normalizeUnit({name:'X', discounts:'no soy un arreglo'});
  assert.equal(state.discounts.length, 36);
});

test('normalizeUnit sobrevive a tramos LM malformados (fromDay no numerico, pct fuera de rango, entradas null)', () => {
  const {state, warnings} = normalizeUnit({name:'X', lmConfig:{mode:'tiers', tiers:[
    {fromDay:'abc', toDay:5, pct:500, label:'ok'},
    null,
    'garbage-string',
    {fromDay:2, toDay:1, pct:30, on:true} // rango invertido
  ]}});
  assert.equal(state.lmConfig.tiers.length, 2, 'null y string sueltos se descartan; los 2 objetos validos (aunque con campos corregidos) se conservan');
  assert.equal(typeof state.lmConfig.tiers[0].fromDay, 'number');
  assert.ok(state.lmConfig.tiers[1].toDay >= state.lmConfig.tiers[1].fromDay, 'rango invertido debe corregirse, no romper la UI con toDay<fromDay');
  assert.ok(warnings.length > 0);
});

test('normalizeUnit rechaza lmConfig.mode desconocido — cae a ceiling_auto, no ejecuta ni preserva el valor crudo', () => {
  const {state} = normalizeUnit({name:'X', lmConfig:{mode:'<script>alert(1)</script>'}});
  assert.equal(state.lmConfig.mode, 'ceiling_auto');
});

test('normalizeUnit valida rangos de comision/offset — no permite payoutFactor negativo ni offset <=-100%', () => {
  const {state} = normalizeUnit({name:'X', channels:[{id:'direct', comm:150, bankFeePct:-10, offsetPct:-100}]});
  const direct = state.channels.find(c=>c.id==='direct');
  assert.ok(direct.comm>=0 && direct.comm<=100);
  assert.ok(direct.bankFeePct>=0 && direct.bankFeePct<=100);
  assert.notEqual(direct.offsetPct, -100, 'offset <=-100% debe corregirse, no propagarse (haria el precio publicado <=0)');
});

test('normalizeUnit: margen fuera de [0,95] se descarta a favor del default, con warning — nunca 0 silencioso sin explicar', () => {
  const {state: s1, warnings: w1} = normalizeUnit({name:'X', margin:150});
  assert.equal(s1.margin, 45);
  assert.ok(w1.some(w=>w.includes('margin')));
  const {state: s2} = normalizeUnit({name:'X', margin:-5});
  assert.equal(s2.margin, 45);
});

test('normalizeUnit: costos negativos se descartan a favor del default, con warning', () => {
  const {state, warnings} = normalizeUnit({name:'X', fixedCost:-100, varCost:-50});
  assert.equal(state.fixedCost, 32);
  assert.equal(state.varCost, 22);
  assert.ok(warnings.length>0);
});

test('normalizeUnit: window de descuento con to<from se trata como rango abierto, no rompe la UI', () => {
  const {state, warnings} = normalizeUnit({name:'X', discounts:[{id:'ab_cus', on:true, pct:10, from:50, to:10}]});
  const d = state.discounts.find(x=>x.id==='ab_cus');
  assert.equal(d.to, 9999);
  assert.ok(warnings.some(w=>w.includes('ab_cus')));
});

test('normalizeUnit: unidad no-objeto no rompe, devuelve state:null con warning', () => {
  const {state, warnings} = normalizeUnit('no soy un objeto');
  assert.equal(state, null);
  assert.ok(warnings.length>0);
});

test('normalizeUnit + escapeHtml juntos: el nombre malicioso sobrevive como STRING (no se ejecuta), y se neutraliza al renderizar', () => {
  const {state} = normalizeUnit({name:'<img src=x onerror=alert(1)>'});
  assert.equal(typeof state.name, 'string'); // el texto SI se preserva (es un nombre legitimo de unidad, solo texto)
  const rendered = escapeHtml(state.name);
  assert.ok(!rendered.includes('<img'), 'al renderizar, escapeHtml debe neutralizar cualquier HTML embebido en el nombre');
});

test('validateImportFile + normalizeUnit en cadena: un archivo con una unidad valida y una invalida importa solo la valida, sin romper', () => {
  const file = {units:[
    {key:'v3:a', value: JSON.stringify({name:'Buena', fixedCost:50})},
    {key:'v2:b', value: 'esto no es json'},
    {key:'v3:c', value: JSON.stringify({fixedCost:50})} // sin name
  ]};
  const {valid, items} = validateImportFile(file);
  assert.equal(valid, true);
  assert.equal(items.length, 1);
  const {state} = normalizeUnit(JSON.parse(items[0].value));
  assert.equal(state.name, 'Buena');
});
