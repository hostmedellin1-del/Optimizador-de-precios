/* Tarifa de aseo fija por reserva en Booking y Expedia (ago 2026).
   Dani confirmó revisando sus propias Extranets que, igual que Airbnb, Booking.com y
   Expedia soportan un cargo de aseo fijo "por estancia"/"per stay" — una sola vez por
   reserva, no por noche. A diferencia de Airbnb, NO tienen el split corto (1-2 noches)
   / largo (3+ noches): es un monto único sin importar la duración. Caso real: Expedia
   (Partner Central → Facility and service fees → Cleaning fee, "Per stay") USD 35;
   Booking (Extranet → Additional fees & charges → suplemento de limpieza "por
   estancia") 120.000 COP ≈ USD 37,50 a 3.200 COP/USD. Ninguno de los dos lo descuenta
   con sus promociones nativas, pero sí paga comisión sobre él — mismo comportamiento
   que ya modela Airbnb con `cleanFeeShort`/`cleanFeeLong`. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute, cleanFeePerNight, payoutFactor} from '../src/domain/engine.js';
import {quoteScenario} from '../src/domain/quote.js';
import {normalizeUnit} from '../src/domain/persistence.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings, findDiscount} from './helpers/state-factory.js';

function isolatedConfig(channels, overrides={}){
  const discounts=freshDiscounts().map(d=>({...d,on:false}));
  const windows=freshWindows();
  return {channels, discounts, windows, ceilings:defaultCeilings(windows),
    fixedCost:100, varCost:0, margin:0, marketBase:0, avgNights:3,
    lmConfig:{mode:'flat', verified:true,
      flat:{pct:0, fromDay:0, toDay:9999, on:false},
      gradual:{maxPct:0, days:3, on:false},
      fixedPrice:{price:0, fromDay:0, toDay:3, on:false}, tiers:[]},
    currency:'USD', usingExampleCosts:false,
    ...overrides};
}

// 1. cleanFeePerNight() para Booking y Expedia: monto fijo dividido por noches reales.
test('cleanFeePerNight Booking/Expedia: monto fijo unico, sin split corto/largo', () => {
  const booking={id:'booking', cleanFee:30};
  const expedia={id:'expedia', cleanFee:40};
  assert.equal(cleanFeePerNight(booking, 1), 30);
  assert.equal(cleanFeePerNight(booking, 3), 10);
  assert.equal(cleanFeePerNight(expedia, 1), 40);
  assert.equal(cleanFeePerNight(expedia, 3), 40/3);
  // a diferencia de Airbnb: el TOTAL (feePerNight*nights) es siempre el mismo cleanFee,
  // sea 1 noche o 5 — no cambia de "corto" a "largo" como cleanFeeShort/cleanFeeLong.
  assert.equal(cleanFeePerNight(booking, 1)*1, 30);
  assert.equal(cleanFeePerNight(booking, 5)*5, 30);
  assert.equal(cleanFeePerNight(expedia, 1)*1, 40);
  assert.equal(cleanFeePerNight(expedia, 5)*5, 40);
});

// 2. cleanFeePerNight() para Airbnb sigue exactamente igual que antes (regresion).
test('cleanFeePerNight Airbnb: regresion exacta, mismos valores que floor-cleanfee.test.js', () => {
  const airbnb={id:'airbnb', cleanFeeShort:20, cleanFeeLong:25};
  assert.equal(cleanFeePerNight(airbnb, 1), 20);
  assert.equal(cleanFeePerNight(airbnb, 2), 10);
  assert.equal(cleanFeePerNight(airbnb, 3), 25/3);
  assert.equal(cleanFeePerNight(airbnb, 4), 25/4);
  // caso real 902 (floor-cleanfee.test.js): feeShort:20, feeLong:25, 1 noche => 20
  const a902={id:'airbnb', cleanFeeShort:20, cleanFeeLong:25};
  assert.equal(cleanFeePerNight(a902, 1), 20);
});

/* 3. RECALCULADO en sep 2026 — este test pinneaba "Directo NUNCA cobra aseo",
   que era cierto SOLO porque el canal todavia no tenia el campo ("fuera de
   alcance" decia el comentario original de ago 2026). El dueno pidio
   explicitamente el aseo para los cuatro canales, asi que Directo ahora tiene el
   MISMO `cleanFee` plano que Booking/Expedia (ver src/domain/engine.js). Lo que
   se conserva del test viejo, y es lo unico que seguia siendo una garantia real:
   un Directo SIN `cleanFee` configurado sigue aportando 0 — cero regresion para
   toda unidad guardada antes de este cambio. */
test('cleanFeePerNight Directo: 0 sin cleanFee; con cleanFee se diluye igual que Booking/Expedia', () => {
  const direct={id:'direct'};
  assert.equal(cleanFeePerNight(direct, 1), 0);
  assert.equal(cleanFeePerNight(direct, 10), 0);
  const directWithFee={id:'direct', cleanFee:99};
  assert.equal(cleanFeePerNight(directWithFee, 1), 99);
  assert.equal(cleanFeePerNight(directWithFee, 3), 33);
  // mismo comportamiento exacto que Booking/Expedia con el mismo monto
  assert.equal(cleanFeePerNight(directWithFee, 7), cleanFeePerNight({id:'booking', cleanFee:99}, 7));
  // el TOTAL por reserva no depende de la duracion: es una sola vez, como en las OTAs
  assert.equal(cleanFeePerNight(directWithFee, 5)*5, 99);
});

// 4. quoteScenario(): un descuento nativo activo NO reduce el aseo.
test('quoteScenario: descuento nativo (VIP Expedia 20%) no reduce el aseo, solo el guest', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const expedia=channels.find(c=>c.id==='expedia');
  expedia.cleanFee=35;
  const discounts=freshDiscounts();
  const exMod=findDiscount(discounts, 'ex_mod'); // VIP miembros, on:true, pct:20 por catalogo
  assert.equal(exMod.on, true);
  assert.equal(exMod.pct, 20);
  const cfg=isolatedConfig(channels, {discounts});
  const q=quoteScenario({chId:'expedia', days:45, nights:1, price:100}, cfg);
  assert.equal(q.guest, 100*0.8); // 20% de descuento nativo aplicado sobre el precio
  assert.equal(q.feeTotal, 35); // el aseo NO se reduce por el descuento nativo
  assert.equal(q.feePerNight, 35);
});

test('quoteScenario: descuento nativo Booking tampoco reduce el aseo', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  booking.cleanFee=37.5;
  const discounts=freshDiscounts().map(d=>({...d,on:false}));
  const bkGen=findDiscount(discounts, 'bk_gen');
  Object.assign(bkGen, {on:true, pct:10});
  const cfg=isolatedConfig(channels, {discounts});
  const q=quoteScenario({chId:'booking', days:45, nights:1, price:100}, cfg);
  assert.equal(q.guest, 90); // Genius 10% aplicado
  assert.equal(q.feeTotal, 37.5);
});

// 5. quoteScenario(): el aseo SI paga comision -- el payout final es menor que si no pagara.
test('quoteScenario: el aseo de Booking/Expedia paga comision (payout la incluye multiplicada por payoutFactor)', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const expedia=channels.find(c=>c.id==='expedia');
  Object.assign(expedia, {comm:25, bankFeePct:0, cleanFee:35});
  const discounts=freshDiscounts().map(d=>({...d,on:false}));
  const cfg=isolatedConfig(channels, {discounts});
  const q=quoteScenario({chId:'expedia', days:45, nights:1, price:100}, cfg);
  const pf=payoutFactor(expedia);
  // payout = (guest + feePerNight) * payoutFactor -- el aseo SI paga comision
  assert.equal(q.payout, (q.guest+q.feePerNight)*pf);
  // Si el aseo NO pagara comision, el payout hubiera sido mayor (guest*pf + feePerNight completo)
  const payoutSinComisionSobreAseo = q.guest*pf + q.feePerNight;
  assert.ok(q.payout < payoutSinComisionSobreAseo,
    `el payout real (${q.payout}) debe ser menor que si el aseo no pagara comision (${payoutSinComisionSobreAseo})`);
});

test('quoteScenario: el aseo de Booking tambien paga comision', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  Object.assign(booking, {comm:18, bankFeePct:6, cleanFee:37.5});
  const discounts=freshDiscounts().map(d=>({...d,on:false}));
  const cfg=isolatedConfig(channels, {discounts});
  const q=quoteScenario({chId:'booking', days:45, nights:1, price:100}, cfg);
  const pf=payoutFactor(booking);
  assert.equal(q.payout, (q.guest+q.feePerNight)*pf);
  const payoutSinComisionSobreAseo = q.guest*pf + q.feePerNight;
  assert.ok(q.payout < payoutSinComisionSobreAseo);
});

// 6. compute().floor sube cuando se activa un cleanFee en Booking o Expedia.
test('compute().floor sube cuando Expedia activa un cleanFee real', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const expedia=channels.find(c=>c.id==='expedia');
  expedia.comm=25;
  const without=compute(isolatedConfig(channels));
  expedia.cleanFee=35;
  const withFee=compute(isolatedConfig(channels));
  assert.ok(withFee.floor<without.floor,
    `un aseo real que aporta ingreso debe permitir bajar el precio requerido para netear el mismo objetivo (${without.floor} → ${withFee.floor})`);
});

test('compute().floor sube (precio requerido baja) cuando Booking activa un cleanFee real', () => {
  const channels=freshChannels().map(c=>({...c, comm:0, bankFeePct:0, offsetPct:0}));
  const booking=channels.find(c=>c.id==='booking');
  Object.assign(booking, {comm:18, bankFeePct:6});
  const without=compute(isolatedConfig(channels));
  booking.cleanFee=37.5;
  const withFee=compute(isolatedConfig(channels));
  assert.ok(withFee.floor<without.floor,
    `mismo criterio que floor-cleanfee.test.js: el ingreso del aseo baja el precio requerido (${without.floor} → ${withFee.floor})`);
});

// 7. Caso real de Dani: Expedia cleanFee:35, Booking cleanFee:37.5 (120000 COP / 3200).
test('caso real Dani: Expedia USD 35 y Booking USD 37,50 (120.000 COP / 3.200) por reserva', () => {
  const expedia={id:'expedia', cleanFee:35};
  const booking={id:'booking', cleanFee:120000/3200};
  assert.equal(booking.cleanFee, 37.5);
  // 1 noche: monto completo exacto.
  assert.equal(cleanFeePerNight(expedia, 1), 35);
  assert.equal(cleanFeePerNight(booking, 1), 37.5);
  // 4 noches: monto dividido entre 4 exacto (sin split corto/largo).
  assert.equal(cleanFeePerNight(expedia, 4), 8.75);
  assert.equal(cleanFeePerNight(booking, 4), 9.375);
});

// 8. normalizeUnit(): unidad vieja sin `cleanFee` en booking/expedia carga con 0 sin warning falso.
test('normalizeUnit: unidad vieja sin cleanFee en booking/expedia carga con 0, sin warning falso', () => {
  const {state,warnings}=normalizeUnit({name:'Vieja sin cleanFee'});
  assert.equal(state.channels.find(c=>c.id==='booking').cleanFee, 0);
  assert.equal(state.channels.find(c=>c.id==='expedia').cleanFee, 0);
  assert.equal(warnings.some(w=>w.includes('cleanFee')), false);
});

test('normalizeUnit: valor invalido de cleanFee en booking/expedia se descarta a favor de 0, con warning', () => {
  const {state,warnings}=normalizeUnit({name:'Invalida', channels:[
    {id:'booking', cleanFee:-5},
    {id:'expedia', cleanFee:'no-es-numero'}
  ]});
  assert.equal(state.channels.find(c=>c.id==='booking').cleanFee, 0);
  assert.equal(state.channels.find(c=>c.id==='expedia').cleanFee, 0);
  assert.ok(warnings.some(w=>w.includes('cleanFee') && w.includes('booking')));
  assert.ok(warnings.some(w=>w.includes('cleanFee') && w.includes('expedia')));
});

test('normalizeUnit: cleanFee valido en booking/expedia se conserva tal cual, sin warning', () => {
  const {state,warnings}=normalizeUnit({name:'Valida', channels:[
    {id:'booking', cleanFee:37.5},
    {id:'expedia', cleanFee:35}
  ]});
  assert.equal(state.channels.find(c=>c.id==='booking').cleanFee, 37.5);
  assert.equal(state.channels.find(c=>c.id==='expedia').cleanFee, 35);
  assert.equal(warnings.some(w=>w.includes('cleanFee')), false);
});

/* RECALCULADO en sep 2026: `direct` salio de esta lista porque el dueno pidio
   el aseo tambien para Directo — ya no es "un campo fuera de alcance", es un
   campo real del canal (arranca en 0). Airbnb sigue afuera: su aseo tiene DOS
   tramos (`cleanFeeShort`/`cleanFeeLong`), asi que un `cleanFee` plano ahi
   seguiria siendo un campo inventado que ninguna formula lee. */
test('normalizeUnit: cleanFee NO aparece en airbnb (usa cleanFeeShort/Long); SI en direct, en 0 por defecto', () => {
  const {state}=normalizeUnit({name:'Campo fuera de alcance'});
  assert.equal('cleanFee' in state.channels.find(c=>c.id==='airbnb'), false);
  assert.equal(state.channels.find(c=>c.id==='direct').cleanFee, 0);
});

test('normalizeUnit: un cleanFee inventado en airbnb se ignora; en direct se conserva y se valida', () => {
  const {state,warnings}=normalizeUnit({name:'Payload con cleanFee', channels:[
    {id:'airbnb', cleanFee:99},
    {id:'direct', cleanFee:99}
  ]});
  assert.equal('cleanFee' in state.channels.find(c=>c.id==='airbnb'), false);
  assert.equal(state.channels.find(c=>c.id==='direct').cleanFee, 99);
  assert.equal(warnings.some(w=>w.includes('cleanFee')), false);
});

/* Unidad guardada ANTES de que Directo tuviera aseo: no trae el campo y debe
   caer al default del catalogo (0) sin warning — cero cambio de numeros. */
test('normalizeUnit: unidad vieja sin cleanFee en direct cae a 0, sin warning', () => {
  const {state,warnings}=normalizeUnit({name:'Unidad vieja', channels:[
    {id:'direct', comm:3, bankFeePct:6, offsetPct:0}
  ]});
  assert.equal(state.channels.find(c=>c.id==='direct').cleanFee, 0);
  assert.equal(warnings.length, 0);
});

/* Un cleanFee negativo en Directo se rechaza igual que en Booking/Expedia
   (nonNegField: cae al default con warning explicito, nunca Math.max(0,x)). */
test('normalizeUnit: cleanFee negativo en direct se rechaza a favor del default, con warning', () => {
  const {state,warnings}=normalizeUnit({name:'Aseo negativo', channels:[{id:'direct', cleanFee:-5}]});
  assert.equal(state.channels.find(c=>c.id==='direct').cleanFee, 0);
  assert.ok(warnings.some(w=>w.includes('channels.direct.cleanFee')), 'debe advertir sobre channels.direct.cleanFee');
});
