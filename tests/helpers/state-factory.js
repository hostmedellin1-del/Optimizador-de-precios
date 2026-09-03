/* Fabrica de estado fresco para tests — evita que los tests compartan (y muten) el
   mismo arreglo de descuentos/canales entre si, ya que el motor ahora recibe estas
   estructuras por parametro en vez de leer un `state` global mutable. */
import {CHANNELS, defaultDiscounts, WINDOWS, defaultCostBreakdown, defaultLmConfig} from '../../src/catalog/discounts.js';

export function freshChannels(){ return CHANNELS.map(c=>({...c})); }
export function freshDiscounts(){ return defaultDiscounts(); }
export function freshWindows(){ return WINDOWS.map(w=>({...w})); }
export function defaultCeilings(windows = freshWindows()){
  return Object.fromEntries(windows.map(w=>[w.id, w.ceil]));
}
export function freshCostBreakdown(){ return defaultCostBreakdown(); }

export function findDiscount(discounts, id){
  const d = discounts.find(x=>x.id===id);
  if(!d) throw new Error(`discount id no encontrado en el catalogo: ${id}`);
  return d;
}

/* Unidad 902 (Alcázar de Oviedo) — la config REAL de producción del dueño,
   reconstruida campo por campo desde su respaldo
   (revenue-ops-backup-2026-08-14.json). Estaba inline en
   tests/floor-cost-por-noche.test.js; se extrae acá porque desde sep 2026 hay
   más de un test que necesita exactamente esta unidad (el fix del VALOR del
   Piso y la propiedad de monotonía del aseo). UNA sola definición: si se
   duplicara, dos tests podrían "pasar" contra dos 902 distintas.
   Las tarifas de aseo de Booking/Expedia NO están acá a propósito: el respaldo
   de agosto es anterior a que esos campos existieran, así que el fixture refleja
   el archivo tal cual y cada test agrega los valores confirmados por el dueño
   (Expedia 35, Booking 37,50) cuando los necesita. */
export function unit902Config(){
  const channels = freshChannels();
  const discounts = freshDiscounts();
  const windows = freshWindows();
  const setCh = (id, patch) => Object.assign(channels.find(c=>c.id===id), patch);
  const setD = (id, patch) => Object.assign(findDiscount(discounts, id), patch);

  setCh('airbnb',  {comm:15.5, offsetPct:16, bankFeePct:0, cleanFeeShort:20, cleanFeeLong:25});
  setCh('booking', {comm:21,   offsetPct:75, bankFeePct:6});
  setCh('expedia', {comm:25,   offsetPct:70, bankFeePct:0});
  setCh('direct',  {comm:3,    offsetPct:5,  bankFeePct:6});

  setD('ab_los2', {pct:14, on:true});               // ≥7 noches
  setD('ab_los3', {pct:14, on:true});               // ≥14 noches
  setD('ab_los4', {pct:25, on:true});               // ≥28 noches (ya es el default del catálogo)
  setD('ab_los5', {pct:10, on:true, minN:4});       // ≥4 noches
  setD('ab_los6', {pct:15, on:true, minN:21});      // ≥21 noches
  setD('ab_los7', {pct:21, on:true, minN:35});      // ≥35 noches
  setD('ab_eb2',  {pct:15, on:true});               // ≥60 días
  setD('ab_topguest', {pct:15, on:true});

  setD('bk_gen', {pct:10, on:true});                // Genius
  setD('bk_mob', {pct:10, on:true});                // Mobile
  setD('bk_cty', {pct:5,  on:true});                // Country

  setD('ex_mod',  {pct:20, on:true});               // VIP (siempre activa)
  setD('ex_mob',  {pct:10, on:true});               // Mobile-only
  setD('ex_los1', {pct:15, on:true});               // ≥7 noches

  const costBreakdown = {
    rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26,
    cleaning:20, laundry:5, consumables:4, supplies:5
  };

  const lmConfig = {
    ...defaultLmConfig(),
    mode:'gradual', verified:true,
    gradual:{maxPct:28, days:6, on:true}
  };

  const ceilings = {w0:40, w1:30, w2:15, w3:0, w4:0, w5:15};

  return {
    channels, discounts, windows,
    costBreakdown, costBreakdownConfirmed:true,
    lmConfig, ceilings, margin:25,
    fixedCost:0, varCost:0
  };
}

/* config base para compute()/combineChannel()/worstNative(), con overrides puntuales. */
export function baseConfig(overrides = {}){
  const channels = overrides.channels || freshChannels();
  const discounts = overrides.discounts || freshDiscounts();
  const windows = overrides.windows || freshWindows();
  return {
    fixedCost: 0, varCost: 0, margin: 45, marketBase: 0, avgNights: 3,
    ...overrides,
    channels, discounts, windows
  };
}
