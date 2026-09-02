/* Vista de portafolio — Fase 2 de usabilidad (ago 2026).

   Dani pidió explícitamente "una lista de todas" — hoy la app trabaja de a
   una unidad por vez y él opera ~36. Este módulo es la lógica PURA (sin DOM)
   que arma una fila por unidad guardada: `index.html` solo la llama con la
   lista de unidades ya normalizadas (normalizeUnit()) y renderiza lo que
   devuelve, sin reimplementar ningún criterio de negocio acá.

   Reusa, sin duplicar ninguna regla:
   - `compute()` (src/domain/engine.js) para el Piso/costo real de cada unidad.
   - `costGateForState()` (src/domain/cost-mode.js) — el MISMO criterio que ya
     usa `costGateNow()` en index.html para decidir si el costo de esa unidad
     sigue siendo el ejemplo de fábrica.
   - `comparePricelabsSync()` (src/domain/pricelabs-sync.js) para comparar el
     snapshot de PriceLabs (si la unidad tiene uno guardado) contra el Piso —
     nunca reimplementa esa comparación.

   Rendimiento: ya medido (ver CLAUDE.md) — compute() toma ~1.62ms por unidad,
   58ms para 36 unidades. Se calcula en vivo, sin caché. */
import {WINDOWS} from '../catalog/discounts.js';
import {compute} from './engine.js';
import {costGateForState} from './cost-mode.js';
import {comparePricelabsSync} from './pricelabs-sync.js';

/* Los tres chips de estado que puede mostrar una fila — en ese orden de
   prioridad: sin costos reales confirmados es más urgente que sin
   Last-Minute verificado (sin costos, cualquier precio sería inventado).
   Un bloqueo de moneda (caso raro, unidad "requiere revisión manual") cae
   también en 'faltan_costos' — no hay un cuarto chip para eso, y esa unidad
   de todas formas necesita revisión antes de nada. */
export function portfolioStatus(model){
  if(model.costBlocked) return 'faltan_costos';
  if(model.lmBlocked) return 'falta_lm';
  if(model.floorReadinessBlocked) return 'faltan_costos';
  return 'lista';
}

function computeModelForUnit(state){
  const costGate = costGateForState(state);
  return compute({
    fixedCost: state.fixedCost, varCost: state.varCost, margin: state.margin, marketBase: state.marketBase,
    channels: state.channels, discounts: state.discounts, windows: WINDOWS, ceilings: state.ceilings,
    lmConfig: state.lmConfig,
    costBreakdown: state.costBreakdown, costBreakdownConfirmed: state.costBreakdownConfirmed,
    usingExampleCosts: costGate.usingExampleCosts,
    currency: state.currency, usdManualReviewPending: state.usdManualReviewPending,
    usdManualReviewLog: state.usdManualReviewLog
  });
}

/* buildPortfolioRow(state) -> una fila lista para renderizar. `state` es una
   unidad YA normalizada (normalizeUnit().state) — este módulo no valida
   forma, esa responsabilidad es de persistence.js, como en el resto de la app. */
export function buildPortfolioRow(state){
  const model = computeModelForUnit(state);
  const status = portfolioStatus(model);
  const floorBlockedReason = !model.floorReadinessBlocked ? null
    : model.currencyBlocked ? 'requiere revisión manual (moneda)'
    : model.costBlocked ? 'faltan costos por confirmar'
    : model.lmBlocked ? 'falta verificar Last-Minute'
    : 'sin resolver';

  const sync = state.pricelabsSync || null;
  const comparison = sync ? comparePricelabsSync(model, sync) : null;

  return {
    id: state.id || null,
    key: state.storageKey || null,
    name: state.name || '(sin nombre)',
    currency: state.currency || 'USD',
    floor: model.floorReadinessBlocked ? null : model.floor,
    floorBlockedReason,
    costPerNight: model.cost,
    status, // 'lista' | 'faltan_costos' | 'falta_lm'
    pricelabsSync: sync ? {
      min: sync.min,
      minGapVsFloor: comparison ? comparison.minGapVsFloor : null,
      minBelowFloor: comparison ? comparison.minBelowFloor : null,
      staleDays: comparison ? comparison.staleDays : null
    } : null
  };
}

/* buildPortfolioRows(states) -> una fila por unidad. Lista vacía (ninguna
   unidad guardada todavía) devuelve [] — sin excepción, la UI decide cómo
   mostrar ese caso (estado vacío explicativo, no una tabla vacía). */
export function buildPortfolioRows(states){
  return (states||[]).map(buildPortfolioRow);
}
