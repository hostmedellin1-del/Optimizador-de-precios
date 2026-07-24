/* Contrato de moneda (src/domain/currency.js) — preparación para datos
   reales. Regla de oro probada aquí: nunca se suma/compara/consolida un
   monto en una moneda distinta de la base sin una conversión EXPLICITA y
   VERIFICADA (rate finito > 0, status:'verificado') — nunca se asume 1:1,
   nunca se inventa un valor. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveConversion, defaultFxEntry, defaultFxRates} from '../src/domain/currency.js';

test('defaultFxEntry()/defaultFxRates(): una unidad nueva arranca sin ningún tipo de cambio confirmado', () => {
  assert.deepEqual(defaultFxEntry(), {rate: null, source: '', date: '', status: 'no_verificado'});
  assert.deepEqual(defaultFxRates(), {});
});

test('misma moneda de origen y destino: no hay nada que convertir, se devuelve el monto tal cual', () => {
  const r = resolveConversion({amount: 150, fromCurrency: 'USD', toCurrency: 'USD', fxRates: {}});
  assert.equal(r.ok, true);
  assert.equal(r.value, 150);
  assert.equal(r.rate, 1);
  assert.equal(r.requiresConversion, false);
});

test('monedas distintas SIN entrada en fxRates: bloqueado, nunca se asume 1:1', () => {
  const r = resolveConversion({amount: 150, fromCurrency: 'USD', toCurrency: 'COP', fxRates: {}});
  assert.equal(r.ok, false);
  assert.equal(r.requiresConversion, true);
  assert.match(r.reason, /USD→COP/);
  assert.match(r.reason, /VERIFICADO/);
});

test('entrada existe pero status "no_verificado": bloqueado igual, aunque el rate sea válido', () => {
  const r = resolveConversion({amount: 150, fromCurrency: 'USD', toCurrency: 'COP', fxRates: {USD: {rate: 4000, source:'banco', date:'2026-07-01', status:'no_verificado'}}});
  assert.equal(r.ok, false);
});

test('rate vacío/null/0/negativo/NaN: bloqueado con motivo explícito, aunque status sea "verificado"', () => {
  for(const badRate of [null, undefined, 0, -5, NaN, 'texto']){
    const r = resolveConversion({amount: 100, fromCurrency: 'USD', toCurrency: 'COP', fxRates: {USD: {rate: badRate, source:'x', date:'2026-01-01', status:'verificado'}}});
    assert.equal(r.ok, false, `rate=${badRate} debe bloquear`);
    assert.match(r.reason, /válido mayor que 0/);
  }
});

test('conversión verificada válida: calcula amount*rate exacto, y expone la salvedad de que es una referencia manual', () => {
  // 1 USD = 4000 COP, 150 USD reales -> 600000 COP
  const r = resolveConversion({amount: 150, fromCurrency: 'USD', toCurrency: 'COP', fxRates: {USD: {rate: 4000, source:'extracto Bancolombia', date:'2026-07-15', status:'verificado'}}});
  assert.equal(r.ok, true);
  assert.equal(r.value, 600000);
  assert.equal(r.rate, 4000);
  assert.equal(r.requiresConversion, true);
  assert.match(r.caveat, /REFERENCIA/);
  assert.match(r.caveat, /extracto Bancolombia/);
});

test('falta moneda de origen o destino: bloqueado con motivo explícito', () => {
  assert.equal(resolveConversion({amount:100, fromCurrency:null, toCurrency:'USD', fxRates:{}}).ok, false);
  assert.equal(resolveConversion({amount:100, fromCurrency:'USD', toCurrency:null, fxRates:{}}).ok, false);
});

test('fxRates undefined/null (nunca pasado): no rompe, se trata igual que "sin entrada" — bloqueado si hace falta conversión', () => {
  assert.equal(resolveConversion({amount:100, fromCurrency:'USD', toCurrency:'USD', fxRates: undefined}).ok, true);
  assert.equal(resolveConversion({amount:100, fromCurrency:'USD', toCurrency:'COP', fxRates: undefined}).ok, false);
});
