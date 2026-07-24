/* Formato de presentacion. Extraido de index.html (Fase 1) con UN cambio de firma
   (no de resultado): `f$` ya no lee `state.currency` de un global implicito, recibe
   la moneda como parametro explicito — necesario para que la funcion sea pura e
   importable desde tests. Para cualquier llamada equivalente (misma moneda, mismo
   x) el resultado es identico al original. La logica de redondeo/formato en si NO
   cambia todavia (eso es tema de la fase de dinero/moneda, pendiente). */
export const f$ = (x, currency = 'USD') =>
  !isFinite(x) ? '—' : (currency || 'USD') + ' ' + new Intl.NumberFormat('es-CO', {maximumFractionDigits: 0}).format(Math.round(x));

export const fP = x => x.toFixed(x < 10 && x > 0 ? 1 : 0) + '%';
