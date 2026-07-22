/* Costo a nivel de RESERVA — Fase 3 de la auditoria.

   Reemplaza el bug P5/P13 de costs-legacy.js: ahi, los costos "por turno"
   (limpieza/lavanderia/insumos, que ocurren UNA VEZ por reserva sin importar
   cuantas noches dure) se dividian entre `avgNights` y ESE PROMEDIO se usaba
   como si fuera el costo real de CUALQUIER reserva — una reserva de 1 noche
   cargaba solo una fraccion de la limpieza real (ej. limpieza=90, avgNights=3
   => 30/noche, y una reserva de 1 noche "pagaba" solo 30 de una limpieza que
   en realidad cuesta 90 completos). Ver tests/reservation-cost-legacy.test.js
   para la demostracion explicita contra el modelo legado, pedida por Dani.

   reservationCost(costBreakdown, {nights}) devuelve el costo TOTAL (numero) de
   una reserva concreta de `nights` noches:
     costoReserva = fijosAsignadosPorNoche*nights + consumosPorNoche*nights
                    + limpieza + lavanderia + insumos   (UNA VEZ, sin dividir)
   `avgNights` se acepta en las opciones (algunos llamadores comparten el mismo
   objeto de config con otras funciones) pero NUNCA se usa para diluir el costo
   de una reserva real — ese es exactamente el bug que este modulo reemplaza. */
export function reservationCost(costBreakdown, {nights} = {}){
  return reservationCostBreakdown(costBreakdown, nights).total;
}

/* Version con desglose, para quien necesite mostrar fijos/consumo/turno por
   separado (Simulador, panel de costos) sin volver a calcular cada pieza. */
export function reservationCostBreakdown(costBreakdown, nights){
  const cb = costBreakdown || {};
  const n = Math.max(1, parseFloat(nights)||1);
  const fixedSum = (parseFloat(cb.rent)||0)+(parseFloat(cb.admin)||0)+(parseFloat(cb.utilities)||0)+(parseFloat(cb.insurance)||0)+(parseFloat(cb.tech)||0);
  const occ = Math.max(1, parseFloat(cb.occNights)||1);
  const fixedPerNight = fixedSum/occ;
  const consumptionPerNight = parseFloat(cb.consumables)||0;
  const turnoTotal = (parseFloat(cb.cleaning)||0)+(parseFloat(cb.laundry)||0)+(parseFloat(cb.supplies)||0);
  const total = (fixedPerNight+consumptionPerNight)*n + turnoTotal;
  return {fixedPerNight, consumptionPerNight, turnoTotal, nights:n, total, perNight: total/n};
}

/* Costo de PLANIFICACION (no de una reserva concreta): cuanto cuesta, en promedio
   por noche, si la unidad se comporta como la estadia tipica (`avgNights`). Sirve
   para comparar contra el Base/Piso agregados (que tampoco son de una reserva
   puntual) sin reintroducir el bug — aqui SI es correcto diluir entre avgNights,
   porque es explicitamente un promedio de planificacion, no el costo de una
   reserva real. Nunca usar esta funcion para facturar/evaluar una reserva
   concreta — para eso es reservationCost()/reservationCostBreakdown() de arriba. */
export function reservationCostAtAvgNights(costBreakdown, avgNights){
  return reservationCostBreakdown(costBreakdown, avgNights).perNight;
}
