/* evaluateCostReadiness() — auditoria externa, ronda 4 (BLOQUEANTE 2).

   Hallazgo confirmado: `costBreakdownIsFilled()` (index.html) trataba
   CUALQUIER campo del desglose detallado de costos con un valor > 0 como
   "el modo detallado ya esta activo/listo para usarse" — y ese desglose,
   por mas PARCIAL que estuviera (ej. escribir solo "Consumos: 5", con
   Arriendo/Limpieza/etc todavia en 0 porque el usuario ni habia llegado a
   esos campos), se pasaba DIRECTO a reservationCostBreakdown()/compute().
   Caso real: costo simple 32+22=54 (Piso 90) caia a un costo de 5 (Piso
   8.33) con solo tocar un campo — como si los demas campos en 0 fueran
   costos reales confirmados, no "todavia no los he escrito".

   Contrato nuevo — tres estados posibles, nunca inferidos de "algun campo >
   0" para decidir si el desglose ALIMENTA una recomendacion (solo se usa
   para decidir la ETIQUETA visible, ver `costBreakdownIsFilled` abajo):
   - 'simple': el desglose detallado nunca se toco — se usa fixedCost/varCost.
     Si esos dos siguen en el valor ilustrativo de fabrica (usingExampleCosts,
     lo decide el caller — ver EXAMPLE_COST_DEFAULTS), TAMBIEN bloquea: un
     costo de ejemplo nunca puede alimentar una recomendacion real.
   - 'detailed_incomplete': se edito AL MENOS un campo del desglose pero
     `costBreakdownConfirmed` no es `true` (explicitamente `false`, el
     valor que usa la UI real) — el desglose NUNCA alimenta el costo real
     mientras tanto; el motor sigue usando el modelo simple (nunca mezcla
     ceros no revisados con datos reales, nunca reemplaza en silencio).
   - 'detailed_confirmed': el desglose fue editado Y confirmado
     explicitamente (`costBreakdownConfirmed===true`) — es el UNICO estado
     que puede alimentar Piso/Base/Offset/Matriz/Alertas/planificacion
     mensual con el costo real de la reserva.

   `costBreakdownConfirmed` es tri-estado a proposito:
   - `undefined` (el default de cualquier caller de test que no participa en
     este contrato, ej. la mayoria de tests/*.test.js que pasan `costBreakdown`
     directo a compute()/quoteScenario()) => se trata como "no aplica esta
     regla", el desglose se usa tal cual llega, CERO regresion.
   - `true`/`false` (lo que de verdad manda index.html, reflejando la casilla
     "Revisé estos costos reales en USD, incluidos los valores en cero") =>
     activa el gate real.
   Lo mismo aplica a `usingExampleCosts`: ausente/undefined nunca bloquea (los
   233 tests existentes usan fixedCost:32/varCost:22 como fixture generico,
   sin relacion con "es el ejemplo de fabrica de la app real" — esa lectura
   es explicitamente responsabilidad del caller real, index.html, nunca de
   esta funcion). */
export function costBreakdownIsFilled(cb){
  const c = cb || {};
  return ['rent','admin','utilities','insurance','tech','cleaning','laundry','consumables','supplies']
    .some(k => (parseFloat(c[k]) || 0) > 0);
}

export const EXAMPLE_COST_DEFAULTS = {fixedCost: 32, varCost: 22};

export function evaluateCostReadiness({costBreakdown, costBreakdownConfirmed, usingExampleCosts} = {}){
  const touched = costBreakdownIsFilled(costBreakdown);
  /* "Cero legitimo confirmado" (auditoria externa, ronda 4): un desglose
     TOTALMENTE en cero (nada "tocado" segun costBreakdownIsFilled, que solo
     mira valores > 0) igual puede ser un dato real que el usuario revisó y
     confirmó explícitamente ("Revisé estos costos reales en USD, incluidos
     los valores en cero") — la confirmación EXPLICITA (`===true`) es
     siempre autoritativa sobre la heurística de "tocado", sin importar los
     valores. Nunca se activa sola con los datos: solo `costBreakdownConfirmed
     ===true` (nunca inferido) la dispara. */
  if(costBreakdownConfirmed === true){
    return {mode: 'detailed_confirmed', blocked: false, useDetailed: true, reason: null, usingExampleCosts: false};
  }
  if(touched){
    if(costBreakdownConfirmed === false){
      return {
        mode: 'detailed_incomplete', blocked: true, useDetailed: false, usingExampleCosts: false,
        reason: 'Editaste la calculadora de costos detallada, pero todavía no confirmaste el desglose — marca "Revisé estos costos reales en USD, incluidos los valores en cero" antes de usarlo en cualquier recomendación. Mientras tanto, ningún campo que sigue en 0 se trata como un costo real confirmado, y el modelo simple (fijo/variable) tampoco se reemplaza en silencio con este desglose parcial.'
      };
    }
    /* costBreakdownConfirmed===undefined: caller de test que no participa de
       este contrato (ver docblock arriba) — comportamiento de siempre, cero
       regresion. */
    return {mode: 'detailed_confirmed', blocked: false, useDetailed: true, reason: null, usingExampleCosts: false};
  }
  if(usingExampleCosts){
    return {
      mode: 'simple_example', blocked: true, useDetailed: false, usingExampleCosts: true,
      reason: `Los costos siguen en el valor ilustrativo de fábrica (fijo ${EXAMPLE_COST_DEFAULTS.fixedCost}, variable ${EXAMPLE_COST_DEFAULTS.varCost}) — es un ejemplo, no un dato real de esta unidad. Carga tus costos reales (fijo/variable, o la calculadora detallada confirmada) antes de usar cualquier recomendación.`
    };
  }
  return {mode: 'simple', blocked: false, useDetailed: false, reason: null, usingExampleCosts: false};
}
