/* Fabrica de estado fresco para tests — evita que los tests compartan (y muten) el
   mismo arreglo de descuentos/canales entre si, ya que el motor ahora recibe estas
   estructuras por parametro en vez de leer un `state` global mutable. */
import {CHANNELS, defaultDiscounts, WINDOWS, defaultCostBreakdown} from '../../src/catalog/discounts.js';

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
