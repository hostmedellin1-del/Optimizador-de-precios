/* Persistencia de los datos nuevos de la ronda "preparación para datos
   reales" (revision externa) — normalizeUnit() sigue siendo la ÚNICA puerta
   de entrada. Prueba: channels[].settlementCurrency, state.fxRates,
   state.reconciliations sobreviven el ciclo exacto con datos bien formados,
   y NUNCA rompen normalizeUnit() ni marcan nada como verificado/válido con
   un payload malformado o malicioso (XSS incluido, vía escapeHtml() en la
   capa de render — aquí se prueba que el dato crudo nunca se ejecuta como
   HTML porque nunca se le da forma de HTML, solo de texto/número). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnit} from '../src/domain/persistence.js';
import {escapeHtml} from '../src/domain/sanitize.js';

/* BLOQUEANTE 2 (auditoria externa, ronda 4) — costBreakdownConfirmed: el
   ESTADO EXPLICITO de "revisé estos costos reales, incluidos los ceros" (ver
   src/domain/cost-mode.js) debe persistir/migrar de forma SEGURA: nunca
   `true` por defecto (ni para una unidad vieja que nunca tuvo este campo, ni
   para un valor invalido) — solo se preserva si el dato guardado es
   EXPLICITAMENTE `true`. */
test('costBreakdownConfirmed: true explícito sobrevive el ciclo exacto', () => {
  const {state} = normalizeUnit({name:'X', costBreakdownConfirmed:true});
  assert.equal(state.costBreakdownConfirmed, true);
});

test('costBreakdownConfirmed: false explícito sobrevive el ciclo exacto', () => {
  const {state} = normalizeUnit({name:'X', costBreakdownConfirmed:false});
  assert.equal(state.costBreakdownConfirmed, false);
});

test('costBreakdownConfirmed: unidad vieja sin este campo en absoluto migra a false (NUNCA true por defecto)', () => {
  const {state} = normalizeUnit({name:'Unidad vieja con desglose lleno', costBreakdown:{rent:500,admin:100,utilities:50,insurance:30,tech:20,occNights:22,cleaning:40,laundry:10,consumables:5,supplies:5}});
  assert.equal(state.costBreakdownConfirmed, false, 'un desglose lleno de una unidad vieja NUNCA se marca confirmado automaticamente — debe quedar en detailed_incomplete hasta que el usuario lo confirme de nuevo');
});

test('costBreakdownConfirmed: un valor no-booleano (string, número, objeto) cae a false, nunca rompe', () => {
  for(const bad of ['si', 1, {a:1}, ['true']]){
    assert.doesNotThrow(() => normalizeUnit({name:'Evil', costBreakdownConfirmed:bad}));
    const {state} = normalizeUnit({name:'Evil', costBreakdownConfirmed:bad});
    assert.equal(state.costBreakdownConfirmed, false, `costBreakdownConfirmed=${JSON.stringify(bad)} debe caer a false`);
  }
});

test('settlementCurrency: "USD"/"COP" sobreviven el ciclo exacto; null (default) también', () => {
  const {state} = normalizeUnit({name:'X', channels:[
    {id:'airbnb', settlementCurrency:'COP'},
    {id:'booking', settlementCurrency:'USD'},
    {id:'expedia', settlementCurrency:null}
  ]});
  assert.equal(state.channels.find(c=>c.id==='airbnb').settlementCurrency, 'COP');
  assert.equal(state.channels.find(c=>c.id==='booking').settlementCurrency, 'USD');
  assert.equal(state.channels.find(c=>c.id==='expedia').settlementCurrency, null);
  assert.equal(state.channels.find(c=>c.id==='direct').settlementCurrency, null, 'canal sin dato en el import cae al default seguro (null)');
});

test('settlementCurrency: un valor no soportado (moneda inventada, número, objeto) cae a null con warning, nunca rompe', () => {
  for(const bad of ['EUR', 42, {a:1}, ['USD'], true]){
    assert.doesNotThrow(() => normalizeUnit({name:'Evil', channels:[{id:'airbnb', settlementCurrency:bad}]}));
    const {state, warnings} = normalizeUnit({name:'Evil', channels:[{id:'airbnb', settlementCurrency:bad}]});
    assert.equal(state.channels.find(c=>c.id==='airbnb').settlementCurrency, null, `settlementCurrency=${JSON.stringify(bad)} debe caer a null`);
    assert.ok(warnings.some(w=>w.includes('settlementCurrency')));
  }
});

test('fxRates: entrada bien formada (rate/source/date/status) sobrevive el ciclo exacto, sin warnings', () => {
  const fxRates = {USD: {rate:4000, source:'extracto Bancolombia', date:'2026-07-15', status:'verificado'}};
  const {state, warnings} = normalizeUnit({name:'X', fxRates});
  assert.deepEqual(state.fxRates.USD, fxRates.USD);
  assert.equal(warnings.filter(w=>w.startsWith('fxRates')).length, 0);
});

test('fxRates: una moneda desconocida (no USD/COP) se descarta con warning, nunca se inventa un tercer par', () => {
  const {state, warnings} = normalizeUnit({name:'Evil', fxRates:{EUR:{rate:1, status:'verificado', source:'', date:''}}});
  assert.equal(state.fxRates.EUR, undefined);
  assert.ok(warnings.some(w=>w.includes('fxRates')));
});

test('fxRates: rate invalido (0/negativo/NaN/texto) NUNCA sobrevive como numero — cae a null y status a no_verificado, incluso si el status crudo decia "verificado"', () => {
  for(const badRate of [0, -100, 'texto', null]){
    const {state} = normalizeUnit({name:'Evil', fxRates:{USD:{rate:badRate, status:'verificado', source:'x', date:'2026-01-01'}}});
    assert.equal(state.fxRates.USD.rate, null, `rate=${JSON.stringify(badRate)} debe caer a null`);
    assert.equal(state.fxRates.USD.status, 'no_verificado', 'sin un rate valido, el status NUNCA puede quedar en verificado');
  }
});

test('fxRates: status inventado cae a no_verificado con warning', () => {
  const {state, warnings} = normalizeUnit({name:'Evil', fxRates:{USD:{rate:4000, status:'TOTALMENTE_CONFIABLE', source:'', date:''}}});
  assert.equal(state.fxRates.USD.status, 'no_verificado');
  assert.ok(warnings.some(w=>w.includes('fxRates.USD.status')));
});

test('fxRates ausente por completo (unidad vieja): recibe {} — nunca inventa una moneda ni un tipo de cambio', () => {
  const {state} = normalizeUnit({name:'Unidad vieja', channels:[], discounts:[]});
  assert.deepEqual(state.fxRates, {});
});

test('reconciliations: entrada bien formada sobrevive el ciclo exacto (campos financieros + referencia opcional)', () => {
  const rec = {id:'rec1', savedAt:'2026-07-20T00:00:00.000Z', chId:'airbnb', price:150, nights:3, days:20, currency:'USD',
    otaCommissionPct:15.5, bankFeePct:null, cleaningFeeCharged:40, nativeDiscountPct:null, payoutReceived:126.75, reference:'HMABC123'};
  const {state, warnings} = normalizeUnit({name:'X', reconciliations:[rec]});
  assert.equal(state.reconciliations.length, 1);
  assert.deepEqual(state.reconciliations[0], rec);
  assert.equal(warnings.filter(w=>w.startsWith('reconciliations')).length, 0);
});

test('reconciliations: una entrada SIN price/nights/payoutReceived se descarta ENTERA (no se intenta reparar campo por campo, evita mostrar una reconciliación engañosa)', () => {
  const {state, warnings} = normalizeUnit({name:'Evil', reconciliations:[
    {chId:'airbnb', nights:3, days:20, payoutReceived:100}, // falta price
    {chId:'airbnb', price:150, days:20, payoutReceived:100}, // falta nights
    {chId:'airbnb', price:150, nights:3, days:20} // falta payoutReceived
  ]});
  assert.equal(state.reconciliations.length, 0);
  assert.equal(warnings.filter(w=>w.startsWith('reconciliations')).length, 3);
});

test('reconciliations: chId desconocido/inventado se descarta la entrada entera', () => {
  const {state} = normalizeUnit({name:'Evil', reconciliations:[{chId:'canal-inventado', price:150, nights:3, days:20, payoutReceived:100}]});
  assert.equal(state.reconciliations.length, 0);
});

test('reconciliations: un elemento no-objeto (string, número, null) en el arreglo no rompe normalizeUnit, se descarta', () => {
  assert.doesNotThrow(() => normalizeUnit({name:'Evil', reconciliations:['texto', 42, null, [1,2,3]]}));
  const {state} = normalizeUnit({name:'Evil', reconciliations:['texto', 42, null, [1,2,3]]});
  assert.equal(state.reconciliations.length, 0);
});

test('reconciliations: no es un arreglo (objeto, string, número) — no rompe, cae a lista vacía', () => {
  for(const bad of [{a:1}, 'texto', 42, true]){
    assert.doesNotThrow(() => normalizeUnit({name:'Evil', reconciliations:bad}));
    const {state} = normalizeUnit({name:'Evil', reconciliations:bad});
    assert.deepEqual(state.reconciliations, []);
  }
});

test('reconciliations: un payload de reserva "malformado" con intento de XSS en la referencia nunca se ejecuta como HTML — sobrevive como TEXTO plano truncado, y escapeHtml() lo neutraliza al renderizar', () => {
  const evilRef = '<img src=x onerror=alert(1)>'.repeat(5); // > 120 chars tras repetir, prueba tambien el truncado
  const {state} = normalizeUnit({name:'Evil', reconciliations:[
    {chId:'airbnb', price:150, nights:3, days:20, payoutReceived:100, reference: evilRef}
  ]});
  assert.equal(state.reconciliations.length, 1);
  assert.ok(state.reconciliations[0].reference.length <= 120, 'la referencia se trunca, nunca se guarda sin límite');
  // La cadena cruda SI puede contener "<img" (normalizeUnit no es un sanitizador de HTML,
  // solo de forma/tipo) — lo que garantiza que nunca se ejecute es escapeHtml() en la
  // capa de render (ya probado exhaustivamente en fase6-persistence-security.test.js /
  // sanitize.test.js); aquí solo se confirma que el campo llega como STRING, nunca como
  // markup ya insertado o como otro tipo de dato.
  assert.equal(typeof state.reconciliations[0].reference, 'string');
  const rendered = escapeHtml(state.reconciliations[0].reference);
  assert.ok(!rendered.includes('<img'), 'escapeHtml() neutraliza cualquier tag antes de insertarse en el DOM');
});

test('reconciliations ausente por completo (unidad vieja): recibe [] — nunca inventa una conciliación', () => {
  const {state} = normalizeUnit({name:'Unidad vieja', channels:[], discounts:[]});
  assert.deepEqual(state.reconciliations, []);
});

test('reconciliations: más de 200 entradas se recortan (limite de sanidad, no crece sin fin con un import repetido)', () => {
  const many = Array.from({length: 250}, (_,i)=>({chId:'airbnb', price:150, nights:3, days:20, payoutReceived:100+i}));
  const {state} = normalizeUnit({name:'X', reconciliations: many});
  assert.equal(state.reconciliations.length, 200);
});

/* ============================================================================
   Simplificación a USD único (revisión externa): la moneda GUARDADA de una
   unidad NUNCA se convierte ni se reinterpreta en normalizeUnit() — un
   valor distinto de 'USD' se PRESERVA tal cual (para que engine.js pueda
   marcar la unidad "requiere revisión manual" y excluirla de cálculos), con
   un warning explícito. Solo ausencia/tipo inválido cae al default seguro
   'USD' (unidad nueva, nunca tuvo un dato de moneda que preservar). ========= */
test('unidad nueva sin campo currency: recibe USD por defecto, sin warning (no es una unidad "vieja", es una nueva)', () => {
  const {state, warnings} = normalizeUnit({name:'Unidad nueva'});
  assert.equal(state.currency, 'USD');
  assert.equal(warnings.filter(w=>w.startsWith('unidad.currency')).length, 0);
});

test('unidad vieja guardada en COP: se PRESERVA "COP" exacto (nunca se convierte a USD en silencio), con warning explícito de "requiere revisión manual"', () => {
  const {state, warnings} = normalizeUnit({name:'Unidad vieja en COP', currency:'COP'});
  assert.equal(state.currency, 'COP');
  assert.ok(warnings.some(w=>w.includes('requiere revision manual') || w.includes('no es USD')));
});

test('unidad con una moneda nunca soportada por la app (EUR, o basura): también se preserva tal cual, nunca se reinterpreta como USD', () => {
  for(const raw of ['EUR', 'cop', 'usd ', 'GBP']){
    const {state} = normalizeUnit({name:'X', currency: raw});
    assert.equal(state.currency, raw.trim(), `currency="${raw}" debe preservarse tal cual (trim, sin forzar a USD)`);
  }
});

test('unidad con currency exactamente "USD": pasa sin warning, como siempre', () => {
  const {state, warnings} = normalizeUnit({name:'X', currency:'USD'});
  assert.equal(state.currency, 'USD');
  assert.equal(warnings.filter(w=>w.startsWith('unidad.currency')).length, 0);
});

test('unidad con currency de tipo inválido (número, objeto, array, boolean): cae al default seguro USD, sin intentar preservar basura estructural', () => {
  for(const bad of [42, {a:1}, ['USD'], true, null]){
    assert.doesNotThrow(() => normalizeUnit({name:'Evil', currency: bad}));
    const {state} = normalizeUnit({name:'Evil', currency: bad});
    assert.equal(state.currency, 'USD');
  }
});

test('reconciliations[].currency: un valor real distinto de USD/COP (ej. "EUR") se preserva tal cual, nunca se reinterpreta como "sin dato"', () => {
  const {state} = normalizeUnit({name:'X', reconciliations:[
    {chId:'airbnb', price:150, nights:3, days:20, payoutReceived:100, currency:'EUR'}
  ]});
  assert.equal(state.reconciliations[0].currency, 'EUR');
});
