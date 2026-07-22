/* Fase 4 — registro de verificacion por unidad. Ninguno de estos hechos se puede
   confirmar sin que Dani revise la cuenta real (extranet Booking, Hospy, facturas
   bancarias, PriceLabs) — esta app NUNCA debe inventar el valor ni asumir que ya
   esta confirmado. Cada clave por defecto queda en 'no_verificado'; solo pasa a
   'verificado' si Dani lo marca explicitamente (con nota de donde lo confirmo). */
export const VERIFICATION_KEYS = {
  bookingGeniusMobileBoth: 'Booking: ¿Genius y Mobile Rate estan AMBOS activos en la extranet real?',
  hospyOffsetIsolated: 'Hospy: ¿el Offset por canal de PriceLabs se aisla de verdad por canal, o se distribuye a todos los conectados?',
  bankFeePctByChannel: 'Comision bancaria/pasarela real por canal (hoy son estimados de Dani, no verificados contra facturas)',
  expediaVipTierMix: 'Expedia: mezcla real de niveles VIP del huesped en esta unidad (hoy se usa 20% — el peor caso — por defecto)',
  airbnbNonRefundable: 'Airbnb: ¿este listing tiene descuento no reembolsable activo? ¿cual es el % exacto?',
  priceLabsLmMode: 'PriceLabs: ¿que modo de Last-Minute usa esta unidad realmente (automatico/flat/gradual/precio fijo/tramos)?'
};

export function defaultVerification(){
  return Object.fromEntries(Object.keys(VERIFICATION_KEYS).map(k=>[k, {status:'no_verificado', note:''}]));
}

export function isVerified(verification, key){
  return !!(verification && verification[key] && verification[key].status==='verificado');
}

/* Merge no destructivo: una unidad guardada antes de que existiera esta clave
   simplemente no la tiene — se completa con el default ('no_verificado'), nunca
   se asume verificada por omision. */
export function mergeVerification(saved){
  return {...defaultVerification(), ...(saved||{})};
}
