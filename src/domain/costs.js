/* Costo a nivel de RESERVA (Fase 3 de la auditoria — PENDIENTE, no implementado
   todavia). Contrato objetivo, para que el test de regresion falle de forma
   explicita y legible ("aun no implementado") en vez de con un error de import
   roto, y quede documentado exactamente que se espera antes de escribir la
   implementacion real:

   reservationCost(costBreakdown, {nights, avgNights}) debe devolver el costo TOTAL
   de una reserva concreta:
     costoReserva = fijosAsignadosPorNoche*nights + consumosPorNoche*nights
                    + limpiezaPorTurno + lavanderiaPorTurno + insumosPorTurno
   Los costos "por turno" (limpieza/lavanderia/insumos) ocurren UNA VEZ por reserva,
   sin importar cuantas noches dure — NO se dividen entre avgNights ni se multiplican
   por nights. `avgNights` puede seguir usandose para planificacion (ADR de
   equilibrio a ocupacion esperada), pero nunca para calcular el costo de UNA reserva
   concreta — ese es precisamente el bug P5/P13 de costs-legacy.js que este modulo
   reemplaza. */
export function reservationCost(){
  throw new Error('reservationCost() aun no implementado — Fase 3 de la auditoria (costo a nivel de reserva)');
}
