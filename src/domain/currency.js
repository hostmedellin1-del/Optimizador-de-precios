/* Contrato de moneda — preparacion para datos reales (revision externa).
   La app soporta 2 monedas (USD/COP, ver src/catalog/discounts.js). Cada
   unidad tiene una moneda BASE (state.currency) y cada canal puede declarar
   su propia moneda de liquidacion si es distinta (channel.settlementCurrency:
   null|'USD'|'COP' — null significa "misma que la unidad", sin conversion).

   Regla de oro: NUNCA se suma, compara o consolida un monto en una moneda
   distinta de la BASE sin una conversion EXPLICITA que Dani haya confirmado.
   `fxRates` guarda, por moneda de ORIGEN, un tipo de cambio MANUAL hacia la
   moneda base de la unidad — nunca se llama a una API externa ni se inventa
   un valor. Si Dani no lo marca 'verificado' (con fuente/fecha), cualquier
   consolidacion que dependa de esa conversion queda BLOQUEADA — nunca cae a
   un tipo de cambio 1:1 en silencio, ni usa un valor sin confirmar.

   Una cotizacion de UN canal en SU PROPIA moneda puede seguir mostrandose sin
   este chequeo (no hay nada que consolidar) — el bloqueo aplica solo cuando
   dos montos en monedas distintas necesitan combinarse en un solo numero
   (reconciliacion.js, monthly-economics.js escenario canal/mezcla). */

export function defaultFxEntry(){
  return {rate: null, source: '', date: '', status: 'no_verificado'};
}

/* fxRates = {[currencyCode]: {rate, source, date, status}} — vacio hasta que
   algun canal declare una moneda de liquidacion distinta a la de la unidad. */
export function defaultFxRates(){
  return {};
}

/* resolveConversion({amount, fromCurrency, toCurrency, fxRates}):
   - fromCurrency === toCurrency: nada que convertir, se devuelve tal cual.
   - fromCurrency !== toCurrency: exige fxRates[fromCurrency] con
     status:'verificado' y un `rate` numerico finito > 0. Cualquier otra cosa
     (entrada ausente, no_verificado, rate vacio/0/negativo/NaN/texto) es
     ok:false — nunca se inventa un valor ni se asume 1:1. */
export function resolveConversion({amount, fromCurrency, toCurrency, fxRates}){
  if(!fromCurrency || !toCurrency){
    return {ok:false, reason:'Falta la moneda de origen o destino para poder comparar montos.'};
  }
  if(fromCurrency===toCurrency){
    return {ok:true, value: amount, rate: 1, requiresConversion: false};
  }
  const entry = fxRates && fxRates[fromCurrency];
  if(!entry || entry.status!=='verificado'){
    return {
      ok:false, requiresConversion:true,
      reason:`Falta un tipo de cambio ${fromCurrency}→${toCurrency} VERIFICADO — configúralo en Resumen → "Moneda y tipo de cambio" antes de mezclar montos en ${fromCurrency} con la moneda base de la unidad (${toCurrency}). Nunca se asume una conversión 1:1 ni se inventa un valor.`
    };
  }
  const rate = parseFloat(entry.rate);
  if(!Number.isFinite(rate) || rate<=0){
    return {
      ok:false, requiresConversion:true,
      reason:`El tipo de cambio ${fromCurrency}→${toCurrency} configurado ("${entry.rate}") no es un número válido mayor que 0 — corrígelo en Resumen → "Moneda y tipo de cambio".`
    };
  }
  return {
    ok:true, requiresConversion:true, value: amount*rate, rate, source: entry.source||'', date: entry.date||'',
    caveat: `Convertido con el tipo de cambio manual que configuraste (1 ${fromCurrency} = ${rate} ${toCurrency}${entry.source?`, fuente: ${entry.source}`:''}${entry.date?`, ${entry.date}`:''}) — es una REFERENCIA que tú confirmaste, no necesariamente el tipo efectivo real que aplicó tu banco/pasarela en esa liquidación.`
  };
}
