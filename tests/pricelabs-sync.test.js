import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePricelabsSync, comparePricelabsSync, validatePricelabsSyncFile} from '../src/domain/pricelabs-sync.js';

const valid={kind:'pricelabs-sync',version:1,listingId:'15195',pmsName:'otasync',fetchedAt:'2026-08-14T02:54:14Z',min:60,base:103,max:null,currency:'USD',recommendedBasePrice:103,prices:[{date:'2026-08-14',price:88,minStay:1},{date:'2026-08-15',price:96,minStay:1}]};

test('normaliza un snapshot válido y conserva precios diarios',()=>{
  const warnings=[]; const out=normalizePricelabsSync(valid,warnings);
  assert.equal(warnings.length,0); assert.equal(out.listingId,'15195'); assert.equal(out.min,60); assert.equal(out.prices.length,2); assert.equal(out.max,null);
});

test('rechaza registros estructuralmente inválidos y fetchedAt inválido',()=>{
  for(const raw of [null,'x',[],{...valid,fetchedAt:'no'}]) assert.equal(normalizePricelabsSync(raw,[]),null);
});

test('filtra precios individuales inválidos y limita el arreglo',()=>{
  const warnings=[]; const out=normalizePricelabsSync({...valid,prices:[{date:'2026-01-01',price:10,minStay:1},{date:'bad',price:20,minStay:1},{date:'2026-01-02',price:-1,minStay:1},{date:'2026-01-03',price:20,minStay:0}]},warnings);
  assert.equal(out.prices.length,1); assert.ok(warnings.length>=3);
});

test('trunca textos y nunca conserva HTML ejecutable como estructura',()=>{
  const out=normalizePricelabsSync({...valid,listingId:'<img src=x onerror=alert(1)>',pmsName:'<script>alert(1)</script>'},[]);
  assert.equal(out.listingId,'<img src=x onerror=alert(1)>');
  assert.match(out.pmsName,/^<script>/);
});

test('compara snapshot real contra piso 138.69: Min Price 60 queda 78.69 abajo',()=>{
  const out=comparePricelabsSync({floor:138.69,base:170,floorReadinessBlocked:false,baseReadinessBlocked:false},valid);
  assert.equal(Math.round(out.minGapVsFloor*100)/100,-78.69); assert.equal(out.minBelowFloor,true); assert.equal(out.baseGapVsOurs,-67); assert.equal(out.recommendedGapVsOurs,-67);
});

test('no fabrica gaps cuando el modelo está bloqueado',()=>{
  const out=comparePricelabsSync({floor:138.69,base:170,floorReadinessBlocked:true,baseReadinessBlocked:true},valid);
  assert.equal(out.minGapVsFloor,null); assert.equal(out.minBelowFloor,null); assert.equal(out.baseGapVsOurs,null); assert.equal(out.recommendedGapVsOurs,null);
});

test('snapshot nulo produce comparación nula y validador exige kind/listingId',()=>{
  assert.equal(comparePricelabsSync({},null),null);
  assert.equal(validatePricelabsSyncFile(valid).valid,true);
  assert.equal(validatePricelabsSyncFile({...valid,kind:'backup'}).valid,false);
  assert.equal(validatePricelabsSyncFile({...valid,listingId:''}).valid,false);
});
