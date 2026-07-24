/* Auditoría de datos reales por unidad — preparación para datos reales
   (revisión externa). Rollup de señales que YA calculan otros módulos
   (readiness.js, pricelabs-lm.js, currency.js, reconciliation.js) — este
   archivo NUNCA vuelve a decidir si un dato de negocio está pendiente, solo
   agrupa lo que `readiness.byChannel[...].missing` ya reporta, para no
   duplicar esa regla una tercera vez.

   Estado final — SOLO 3 valores posibles, NUNCA "producción":
   - 'simulacion': los costos siguen en el valor ilustrativo de fábrica — todo
     lo demás es matemáticamente correcto pero parte de un dato fabricado.
   - 'datos_parciales': hay costos reales cargados, pero falta confirmar algo
     (comisiones, LM, Offset, promos, moneda) o todavía no se concilió
     ninguna reserva real, o la última conciliación no fue confiable.
   - 'listo_supervisado' ("listo para uso interno supervisado"): costos
     reales, TODOS los datos de negocio confirmados, LM confirmado, unidad en
     USD, y al menos una reconciliación reciente con diferencia dentro de lo
     esperado. Sigue sin ser "producción" — esa palabra la usa Dani, nunca
     esta herramienta.

   Simplificación a USD único (revisión externa): esta versión SOLO admite
   USD — el item "currency" del checklist ya NO intenta resolver una
   conversión (currency.js se conserva pero no se llama desde aquí). Una
   unidad marcada "requiere revisión manual" (moneda guardada != USD) o con
   algún canal marcado en otra moneda (dato viejo) siempre falla este item —
   no existe ningún camino para que pase con datos multimoneda.

   BLOQUEANTE 3 (auditoria externa, ronda 5): el item "currency" ahora llama
   a evaluateUsdOnlyReadiness() (src/domain/usd-only.js, la MISMA fuente que
   engine.js/reconciliation.js/monthly-economics.js) en vez de reimplementar
   su propio chequeo de moneda por canal — así una copia USD pendiente de
   revisión manual (`usdManualReviewPending:true`) tampoco puede marcar
   "listo_supervisado" en el checklist, aunque su `currency` ya diga 'USD'. */
import {evaluateUsdOnlyReadiness} from './usd-only.js';

const PROMO_KEYS = ['bookingGeniusMobileBoth', 'expediaVipTierMix', 'airbnbNonRefundable'];

/* config = {usingExampleCosts, readiness, lmBlocked, channels, currency,
   usdManualReviewPending, usdManualReviewLog, lastReconciliation} */
export function buildAuditChecklist(config){
  const {usingExampleCosts, readiness, lmBlocked, channels, lastReconciliation} = config;
  const currency = config.currency || 'USD';

  const chName = chId => (channels||[]).find(c=>c.id===chId)?.name || chId;
  const missingByKey = {};
  if(readiness){
    Object.entries(readiness.byChannel).forEach(([chId, r])=>{
      (r.missing||[]).forEach(m=>{
        (missingByKey[m.key] = missingByKey[m.key]||[]).push(chName(chId));
      });
    });
  }

  const items = [];

  items.push({
    key:'costs', label:'Costos reales cargados', ok: !usingExampleCosts,
    detail: usingExampleCosts
      ? 'Los costos siguen en el valor ilustrativo de fábrica — carga los costos reales de esta unidad antes de confiar en cualquier número.'
      : 'Costos cargados (no están en el valor ilustrativo de fábrica).'
  });

  const bankPending = missingByKey.bankFeePctByChannel || [];
  items.push({
    key:'commissions', label:'Comisiones por canal verificadas', ok: bankPending.length===0,
    detail: bankPending.length ? `Falta confirmar la comisión bancaria/pasarela real de: ${bankPending.join(', ')}.` : 'Comisión bancaria/pasarela confirmada en todos los canales que la cobran.'
  });

  items.push({
    key:'lastMinute', label:'Last-Minute verificado', ok: !lmBlocked,
    detail: lmBlocked ? 'El modo de Last-Minute todavía no está confirmado directamente en PriceLabs.' : 'Modo de Last-Minute confirmado en PriceLabs.'
  });

  const offsetPending = missingByKey.hospyOffsetIsolated || [];
  items.push({
    key:'offset', label:'Offset verificado', ok: offsetPending.length===0,
    detail: offsetPending.length ? `Falta confirmar en Hospy si el Offset se aísla por canal (afecta: ${offsetPending.join(', ')}).` : 'Sin Offset pendiente de confirmar en Hospy.'
  });

  const promoPending = [...new Set(PROMO_KEYS.flatMap(k=>missingByKey[k]||[]))];
  items.push({
    key:'promotions', label:'Promociones verificadas', ok: promoPending.length===0,
    detail: promoPending.length ? `Falta confirmar promociones/reglas de plataforma en: ${promoPending.join(', ')}.` : 'Sin promociones pendientes de confirmar.'
  });

  const usdGate = evaluateUsdOnlyReadiness({unitCurrency: currency, channels, usdManualReviewPending: config.usdManualReviewPending, usdManualReviewLog: config.usdManualReviewLog});
  items.push({
    key:'currency', label:'Moneda en USD', ok: !usdGate.blocked,
    detail: usdGate.blocked
      ? `Esta unidad está marcada "requiere revisión manual" — ${usdGate.reason} Corrígela antes de confiar en cualquier recomendación.`
      : 'Unidad en USD — sin canales marcados en otra moneda ni copias pendientes de revisión manual.'
  });

  const reconOk = !!(lastReconciliation && lastReconciliation.ok && !lastReconciliation.currencyBlocked && lastReconciliation.reliable);
  items.push({
    key:'reconciliation', label:'Última reserva conciliada', ok: reconOk,
    detail: !lastReconciliation
      ? 'Todavía no has conciliado ninguna reserva real contra el estimado del motor.'
      : lastReconciliation.currencyBlocked
        ? `La última conciliación quedó bloqueada por moneda: ${lastReconciliation.currencyBlockedReason||'esta versión solo admite USD.'}`
        : `Última diferencia: ${lastReconciliation.diff && lastReconciliation.diff.percent!=null ? lastReconciliation.diff.percent.toFixed(1)+'%' : '—'} (severidad: ${lastReconciliation.severity||'—'}).`
  });

  let status;
  if(usingExampleCosts) status = 'simulacion';
  else if(items.every(i=>i.ok)) status = 'listo_supervisado';
  else status = 'datos_parciales';

  const STATUS_LABELS = {
    simulacion: 'Simulación — costos de ejemplo, ningún número debe usarse como recomendación real',
    datos_parciales: 'Datos parcialmente verificados — revisa los puntos pendientes antes de confiar en la recomendación',
    listo_supervisado: 'Listo para uso interno supervisado — sigue sin ser "producción": revisa periódicamente'
  };

  return {items, status, statusLabel: STATUS_LABELS[status]};
}
