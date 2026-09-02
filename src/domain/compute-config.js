/* computeConfigForState(state) — fuente ÚNICA del objeto de configuración que
   se le pasa a compute() (src/domain/engine.js). Antes index.html armaba este
   objeto a mano dentro de su propio wrapper compute(), y
   src/domain/portfolio.js armaba una copia PARALELA, campo por campo, dentro
   de computeModelForUnit() — hoy las dos son idénticas y el resultado es
   correcto, pero si mañana se agrega un campo de gate nuevo y alguien lo
   agrega solo en index.html, el portafolio calcularía con una config más
   permisiva y podría mostrar unidades como "Lista" cuando no lo están. En una
   herramienta de plata eso hay que cerrarlo: index.html y portfolio.js solo
   LLAMAN a esta función, ninguno de los dos vuelve a armar el objeto por su
   cuenta. */
import {WINDOWS} from '../catalog/discounts.js';
import {costGateForState} from './cost-mode.js';

export function computeConfigForState(state){
  /* BLOQUEANTE CRITICO corregido: el Piso/Base ahora SI reciben `ceilings` y
     `lmConfig` — antes esta llamada nunca los pasaba, asi que compute() jamas
     podia proteger contra un Last-Minute configurado, sin importar que
     src/domain/engine.js ya supiera hacerlo. */
  return {
    fixedCost: state.fixedCost, varCost: state.varCost, margin: state.margin, marketBase: state.marketBase,
    channels: state.channels, discounts: state.discounts, windows: WINDOWS, ceilings: state.ceilings,
    lmConfig: state.lmConfig,
    /* Se pasa el desglose SIEMPRE (aunque este vacio o sin confirmar) —
       engine.js decide internamente si es usable (`costBreakdownConfirmed`),
       nunca index.html: fuente unica de verdad, ver cost-mode.js. */
    costBreakdown: state.costBreakdown, costBreakdownConfirmed: state.costBreakdownConfirmed,
    usingExampleCosts: costGateForState(state).usingExampleCosts,
    /* Simplificacion a USD unico (revision externa): `currency` es la moneda
       GUARDADA de la unidad (normalmente 'USD') — engine.js deriva el gate
       real (unidad + canales) el mismo con evaluateUsdOnlyReadiness(), ver
       src/domain/usd-only.js.
       BLOQUEANTE 3 (auditoria externa, ronda 5): `usdManualReviewPending`
       bloquea igual aunque `state.currency` ya sea 'USD' — ver el docblock
       de evaluateUsdOnlyReadiness() para el hallazgo (copia USD de una
       unidad COP, sin convertir ningun valor). */
    currency: state.currency,
    usdManualReviewPending: state.usdManualReviewPending,
    usdManualReviewLog: state.usdManualReviewLog
  };
}
