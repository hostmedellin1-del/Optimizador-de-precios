/* evaluateUsdOnlyReadiness() — auditoria externa, ronda 4 (BLOQUEANTE 1).

   Hallazgo confirmado: una unidad con state.currency==='USD' pero con un
   canal HISTORICO marcado settlementCurrency:'COP' (dato de antes de la
   simplificacion a USD unico) podia devolver Piso/Base sin bloqueo —
   monthly-economics.js y audit.js SI detectaban ese canal, pero
   engine.js/compute() (y por lo tanto Matriz/Alertas/Offset/KPIs, que leen
   `model.currencyBlocked`) solo miraban `state.currency`, nunca los canales.
   Tres lugares distintos decidian "¿esta unidad tiene un dato monetario no-USD
   activo?" cada uno a su manera — con riesgo real de desalinearse, que es
   exactamente lo que paso aqui.

   Esta funcion es la UNICA fuente de verdad para esa pregunta. Bloquea si:
   - la moneda GUARDADA de la unidad (`unitCurrency`) no es exactamente 'USD'; o
   - CUALQUIER canal activo tiene `settlementCurrency` explicito distinto de
     'USD' (dato historico — la UI ya no ofrece forma de crear uno nuevo); o
   - cualquier entrada de `legacyData` (reservado para futuros datos monetarios
     que no sean ni la unidad ni un canal) trae una moneda explicita != 'USD'.

   El bloqueo es GLOBAL (afecta a TODA la unidad, no solo al canal problematico)
   — consistente con como ya se trata `state.currency!=='USD'`: no se sabe con
   certeza que otros numeros dependen, directa o indirectamente, del dato en
   otra moneda (Piso/Base son numeros GLOBALES que PriceLabs aplica a los 4
   canales), asi que ninguno se puede tratar como confiable.

   engine.js, reconciliation.js y monthly-economics.js llaman a esta MISMA
   funcion (nunca reimplementan el chequeo) para derivar su propio
   `costBlocked`/`currencyBlocked` — ver comentarios en cada uno.

   BLOQUEANTE 3 (auditoria externa, ronda 5 — "recuperación segura de COP no
   es segura"): crear una copia USD de una unidad COP NO convierte ningún
   valor — los números copiados podrían seguir representando COP con la
   etiqueta 'USD' encima. Antes de este fix, la copia tenía `unitCurrency
   ==='USD'` desde el instante en que se creaba, así que ESTA MISMA función
   la daba por buena en cuanto se resolvían LM/verificaciones — sin importar
   que nadie hubiera revisado un solo número. `usdManualReviewPending` es el
   gate que cierra ese hueco: es una bandera EXPLICITA (no inferida de la
   moneda) que la copia arranca en `true` y que solo un caller real
   (index.html, tras la confirmación fuerte de revisión manual) puede pasar
   a `false` — nunca esta función, nunca por defecto. Se revisa ANTES que
   `unitCurrency`, con su propio mensaje: aunque la moneda ya diga 'USD', la
   razón real del bloqueo es la revisión pendiente, no la moneda en sí.

   BLOQUEANTE (auditoria externa, ronda 6 — "bypass de copia COP→USD por
   importación"): el booleano `usdManualReviewPending` SOLO no bastaba —
   un JSON exportado, editado a mano para dejarlo en `false` pero
   conservando en `usdManualReviewLog` un `copy_created` SIN un
   `review_confirmed` real después, desbloqueaba la unidad igual, porque
   nada contrastaba el booleano contra la bitácora. Ver
   `evaluateUsdManualReviewState()` (debajo) — la fuente ÚNICA y pura que
   decide el estado EFECTIVO de revisión manual, cruzando el booleano con
   la bitácora en orden temporal. `evaluateUsdOnlyReadiness()` NUNCA vuelve
   a leer `usdManualReviewPending` crudo — siempre pasa por esa función. */
const REVIEW_EVENTS = ['copy_created', 'review_confirmed'];

function isValidReviewEntry(e){
  return !!e && typeof e === 'object'
    && REVIEW_EVENTS.includes(e.event)
    && typeof e.at === 'string' && e.at.trim() !== ''
    && Number.isFinite(Date.parse(e.at));
}

/* evaluateUsdManualReviewState({usdManualReviewPending, usdManualReviewLog})
   — pura, sin efectos secundarios, se puede llamar directo (tests) o desde
   evaluateUsdOnlyReadiness()/normalizeUnit() (persistence.js), que la
   reusan como MISMA fuente en vez de reimplementar el cruce.

   Regla: se ordenan las entradas VÁLIDAS del log cronológicamente (por
   `at`; un empate se resuelve por la posición original en el arreglo, que
   es append-only desde la UI real — nunca se reordena a mano salvo que
   alguien edite el JSON, y en ese caso el orden temporal manda). Si el
   `copy_created` MÁS RECIENTE no tiene un `review_confirmed` VÁLIDO
   después de él en esa línea de tiempo, el estado efectivo es "pendiente"
   — sin importar lo que diga `usdManualReviewPending`. Entradas
   malformadas (evento desconocido, fecha ausente/no parseable) se ignoran
   POR COMPLETO: nunca cuentan como confirmación, y nunca fabrican un
   `copy_created` que no exista. `usdManualReviewPending:true` SIEMPRE
   bloquea, tenga o no bitácora — sigue siendo la bandera explícita que usa
   index.html para marcar una copia recién creada, antes de que exista
   ninguna entrada de log. Una unidad SIN log en absoluto (normal,
   preexistente) y `usdManualReviewPending` ausente/false nunca queda
   bloqueada por esta regla — cero regresión. */
export function evaluateUsdManualReviewState({usdManualReviewPending, usdManualReviewLog} = {}){
  const log = Array.isArray(usdManualReviewLog) ? usdManualReviewLog : [];
  const sorted = log
    .map((e, i) => ({e, i}))
    .filter(({e}) => isValidReviewEntry(e))
    .sort((a, b) => {
      const ta = Date.parse(a.e.at), tb = Date.parse(b.e.at);
      if(ta !== tb) return ta - tb;
      return a.i - b.i;
    })
    .map(({e}) => e);

  let lastCopyCreatedIdx = -1;
  sorted.forEach((e, idx) => { if(e.event === 'copy_created') lastCopyCreatedIdx = idx; });
  const confirmedAfter = lastCopyCreatedIdx >= 0
    && sorted.slice(lastCopyCreatedIdx + 1).some(e => e.event === 'review_confirmed');
  const historyRequiresReview = lastCopyCreatedIdx >= 0 && !confirmedAfter;

  const rawPending = usdManualReviewPending === true;
  const pending = rawPending || historyRequiresReview;
  const inconsistentRaw = usdManualReviewPending === false && historyRequiresReview;

  return {
    pending, historyRequiresReview, inconsistentRaw,
    reason: !pending ? null : (inconsistentRaw
      ? 'el archivo indicaba que la revisión ya se había completado (usdManualReviewPending:false), pero la bitácora de la unidad registra una copia sin convertir (copy_created) sin una confirmación de revisión manual (review_confirmed) válida y posterior — por seguridad, se trata como pendiente'
      : 'es una copia creada a partir de otra unidad en otra moneda, y sus valores monetarios (costos, tarifas, comisiones) todavía NO fueron revisados/confirmados uno por uno en USD; ningún valor fue convertido automáticamente')
  };
}

export function evaluateUsdOnlyReadiness({unitCurrency, channels, legacyData, usdManualReviewPending, usdManualReviewLog} = {}){
  const reasons = [];
  const reviewState = evaluateUsdManualReviewState({usdManualReviewPending, usdManualReviewLog});
  if(reviewState.pending){
    reasons.push(`la unidad quedó marcada "pendiente de revisión manual" — ${reviewState.reason}`);
  }
  if(unitCurrency && unitCurrency !== 'USD'){
    reasons.push(`la unidad está guardada en ${unitCurrency}, no en USD`);
  }
  const nonUsdChannels = (channels || []).filter(c => c && c.settlementCurrency && c.settlementCurrency !== 'USD');
  nonUsdChannels.forEach(c => {
    reasons.push(`${c.name || c.id} quedó marcado con una moneda de liquidación distinta de USD (${c.settlementCurrency}, dato de una versión anterior)`);
  });
  (legacyData || []).forEach(d => {
    if(d && d.currency && d.currency !== 'USD') reasons.push(`${d.label || 'un dato guardado'} está en ${d.currency}, no en USD`);
  });
  const reason = reasons.length
    ? reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1) + (reasons.length>1 ? '; ' + reasons.slice(1).join('; ') : '') + '.'
    : null;
  return {blocked: reasons.length>0, reasons, nonUsdChannels, reason};
}
