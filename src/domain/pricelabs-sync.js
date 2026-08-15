/* Snapshot de solo lectura de PriceLabs.
   Este modulo deliberadamente no hace fetch ni conoce el DOM: PriceLabs se
   sincroniza mediante un JSON exportado/entregado manualmente por Claude. */

const MAX_PRICES = 60;
const MAX_TEXT = 160;

function finiteNonNegative(value){
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function shortText(value, max=MAX_TEXT){
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function validDate(value){
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

export function normalizePricelabsSync(raw, warnings=[]){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const listingId = shortText(raw.listingId, 100);
  if(!listingId){ warnings.push('PriceLabs: falta listingId.'); return null; }
  if(!validDate(raw.fetchedAt)){ warnings.push('PriceLabs: fetchedAt falta o no es una fecha válida — snapshot descartado.'); return null; }
  const min = finiteNonNegative(raw.min);
  const base = finiteNonNegative(raw.base);
  const recommendedBasePrice = finiteNonNegative(raw.recommendedBasePrice);
  if(min===null || base===null || recommendedBasePrice===null){ warnings.push('PriceLabs: min, base y recommendedBasePrice deben ser números no negativos — snapshot descartado.'); return null; }
  const max = raw.max === null || raw.max === undefined ? null : finiteNonNegative(raw.max);
  if(raw.max !== null && raw.max !== undefined && max===null){ warnings.push('PriceLabs: max no es un número no negativo — snapshot descartado.'); return null; }
  const prices=[];
  if(raw.prices !== undefined && !Array.isArray(raw.prices)) warnings.push('PriceLabs: prices no es un arreglo — se dejó vacío.');
  if(Array.isArray(raw.prices)){
    raw.prices.slice(0, MAX_PRICES).forEach((item, index)=>{
      if(!item || typeof item !== 'object' || Array.isArray(item) || !validDate(item.date)){
        warnings.push(`PriceLabs: prices[${index}] inválido — descartado.`); return;
      }
      const price = finiteNonNegative(item.price);
      const minStay = typeof item.minStay === 'number' ? item.minStay : (typeof item.minStay === 'string' && item.minStay.trim() !== '' ? Number(item.minStay) : NaN);
      if(price===null || !Number.isInteger(minStay) || minStay <= 0){
        warnings.push(`PriceLabs: prices[${index}] tiene price/minStay inválido — descartado.`); return;
      }
      prices.push({date:item.date.slice(0,40), price, minStay});
    });
    if(raw.prices.length > MAX_PRICES) warnings.push(`PriceLabs: prices excede ${MAX_PRICES} entradas — se recortó.`);
  }
  return {
    kind:'pricelabs-sync', version:1, listingId,
    pmsName:shortText(raw.pmsName), currency:shortText(raw.currency, 12),
    fetchedAt:raw.fetchedAt.slice(0,40), min, base, max,
    recommendedBasePrice, prices
  };
}

export function validatePricelabsSyncFile(raw){
  const errors=[];
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return {valid:false, errors:['El archivo no es un objeto JSON válido.']};
  if(raw.kind !== 'pricelabs-sync') errors.push('El archivo no tiene kind:"pricelabs-sync".');
  if(typeof raw.listingId !== 'string' || !raw.listingId.trim()) errors.push('Falta listingId.');
  return {valid:errors.length===0, errors};
}

export function comparePricelabsSync(model, sync){
  if(!sync) return null;
  const staleDays = Math.floor((Date.now()-Date.parse(sync.fetchedAt))/86400000);
  const floorBlocked = !!(model?.floorReadinessBlocked || model?.currencyBlocked || model?.costBlocked || model?.lmBlocked);
  const baseBlocked = !!(model?.baseReadinessBlocked || model?.currencyBlocked || model?.costBlocked || model?.lmBlocked);
  return {
    minGapVsFloor: floorBlocked ? null : sync.min - model.floor,
    minBelowFloor: floorBlocked ? null : sync.min < model.floor,
    baseGapVsOurs: baseBlocked ? null : sync.base - model.base,
    recommendedGapVsOurs: baseBlocked ? null : sync.recommendedBasePrice - model.base,
    staleDays
  };
}
