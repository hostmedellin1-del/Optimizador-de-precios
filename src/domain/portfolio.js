/* Vista de portafolio — Fase 2 de usabilidad (ago 2026).

   Dani pidió explícitamente "una lista de todas" — hoy la app trabaja de a
   una unidad por vez y él opera ~36. Este módulo es la lógica PURA (sin DOM)
   que arma una fila por unidad guardada: `index.html` solo la llama con la
   lista de unidades ya normalizadas (normalizeUnit()) y renderiza lo que
   devuelve, sin reimplementar ningún criterio de negocio acá.

   Reusa, sin duplicar ninguna regla:
   - `compute()` (src/domain/engine.js) para el Piso/costo real de cada unidad.
   - `computeConfigForState()` (src/domain/compute-config.js) — el MISMO
     armado de config (incluye el gate de costos vía `costGateForState()`)
     que ya usa `compute()` en index.html, para que el portafolio nunca
     calcule con una config distinta de la vista principal.
   - `comparePricelabsSync()` (src/domain/pricelabs-sync.js) para comparar el
     snapshot de PriceLabs (si la unidad tiene uno guardado) contra el Piso —
     nunca reimplementa esa comparación.

   Rendimiento: ya medido (ver CLAUDE.md) — compute() toma ~1.62ms por unidad,
   58ms para 36 unidades. Se calcula en vivo, sin caché. */
import {compute} from './engine.js';
import {computeConfigForState} from './compute-config.js';
import {comparePricelabsSync} from './pricelabs-sync.js';

/* Tabla única de bloqueos, ordenada por prioridad — de acá salen TANTO el
   chip de estado (portfolioStatus()) COMO el motivo (floorBlockedReason en
   buildPortfolioRow()), para que las dos lecturas nunca puedan volver a
   divergir. Antes eran dos criterios paralelos con órdenes distintos:
   portfolioStatus() miraba costBlocked/lmBlocked ANTES de currencyBlocked,
   mientras que floorBlockedReason miraba currencyBlocked primero — una
   unidad en COP (lmBlocked:true por defecto) mostraba el chip "Falta
   Last-Minute" en la MISMA fila donde el motivo decía "requiere revisión
   manual (moneda)", que era el motivo real. Un bloqueo de moneda ahora tiene
   su propio chip ('revisar_moneda'), no cae en 'faltan_costos'. */
const BLOCKS = [
  {test: m => m.currencyBlocked, status: 'revisar_moneda', reason: 'requiere revisión manual (moneda)'},
  {test: m => m.costBlocked, status: 'faltan_costos', reason: 'faltan costos por confirmar'},
  {test: m => m.lmBlocked, status: 'falta_lm', reason: 'falta verificar Last-Minute'}
];

function resolveBlock(model){
  return BLOCKS.find(b => b.test(model)) || null;
}

export function portfolioStatus(model){
  const block = resolveBlock(model);
  if(block) return block.status;
  // floorReadinessBlocked puede quedar en true por un dato de negocio
  // pendiente (unreadyChannels) sin que ninguna de las tres condiciones de
  // arriba coincida — mismo fallback que ya existía, ver 'sin resolver' abajo.
  return model.floorReadinessBlocked ? 'faltan_costos' : 'lista';
}

function computeModelForUnit(state){
  return compute(computeConfigForState(state));
}

/* buildPortfolioRow(state) -> una fila lista para renderizar. `state` es una
   unidad YA normalizada (normalizeUnit().state) — este módulo no valida
   forma, esa responsabilidad es de persistence.js, como en el resto de la app. */
export function buildPortfolioRow(state){
  const model = computeModelForUnit(state);
  const status = portfolioStatus(model);
  const block = resolveBlock(model);
  const floorBlockedReason = !model.floorReadinessBlocked ? null
    : block ? block.reason
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
    status, // 'lista' | 'faltan_costos' | 'falta_lm' | 'revisar_moneda'
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
