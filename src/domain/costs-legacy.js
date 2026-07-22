/* Calculadora de costos por noche (modo "detallado"). Extraida verbatim de index.html
   (Fase 1), firma cambiada a parametros explicitos.

   BUG CONOCIDO (P5/P13 de la auditoria, sin corregir en esta Fase 1): las lineas "por
   turno" (limpieza/lavanderia/insumos) se dividen entre `avgNights` y ESE PROMEDIO se
   usa como si fuera el costo real de CUALQUIER reserva — una reserva de 1 noche carga
   solo una fraccion de la limpieza real, y una de 30 noches carga de mas. El costo de
   turno ocurre UNA VEZ por reserva, no a tasa promedio. Se corrige en Fase 3 con un
   costo a nivel de reserva real (`costs.js`); este archivo se llama "legacy" a
   proposito para no confundirlo con el reemplazo.

   Tambien tiene el bug de desincronizacion (P13): si `avgNights` cambia, esta funcion
   SI refleja el nuevo promedio en su resultado — pero en index.html el resultado solo
   se escribia de vuelta a `state.varCost` dentro del handler de `data-cb`, nunca al
   cambiar `avgNights` directamente. Ese bug vive en el pegamento de index.html
   (Fase 1 no lo toca todavia), no en esta funcion pura. */
export function costCalcTotals(costBreakdown, avgNights){
  const cb=costBreakdown;
  const occ=Math.max(1,parseFloat(cb.occNights)||1), avgN=Math.max(1,parseFloat(avgNights)||1);
  const fixedSum=(parseFloat(cb.rent)||0)+(parseFloat(cb.admin)||0)+(parseFloat(cb.utilities)||0)+(parseFloat(cb.insurance)||0)+(parseFloat(cb.tech)||0);
  const turnoSum=(parseFloat(cb.cleaning)||0)+(parseFloat(cb.laundry)||0)+(parseFloat(cb.supplies)||0);
  const turnoPerNight=turnoSum/avgN;
  const consumptionPerNight=parseFloat(cb.consumables)||0;
  return {fixedPerNight:fixedSum/occ, turnoPerNight, consumptionPerNight, varPerNight:turnoPerNight+consumptionPerNight};
}
