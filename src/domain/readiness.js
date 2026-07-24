/* evaluateRecommendationReadiness() — Fase 5 (revision externa): contrato unico
   de "recomendacion confiable". El motor podia calcular una formula
   correctamente y aun asi dar una recomendacion incorrecta si un dato
   financiero del que depende (comision bancaria real, si Hospy aisla el
   Offset por canal, la mezcla VIP real de Expedia, si Booking realmente tiene
   Genius+Mobile activos, un descuento no reembolsable de Airbnb) no
   representa la cuenta real de Dani. Antes, `verification.js` guardaba el
   estado pero NINGUNA vista lo usaba para bloquear nada — era una etiqueta,
   no una regla. Esta funcion es la UNICA fuente que decide, por canal, que
   falta confirmar y si el canal queda "listo" para mostrarse como
   recomendacion confiable. Ninguna vista (KPIs, Matriz, Alertas, Simulador)
   debe reimplementar esta logica — todas consumen este resultado.

   Es ORTOGONAL a `lmBlocked` (ronda 2, LM sin verificar/automatico) y a
   `baseBlocked` (ronda 3, precio LM fijo en el dia de referencia) — esos dos
   siguen viviendo en engine.js/compute() sin cambios. Esta funcion cubre una
   dimension DISTINTA: datos de negocio (comisiones, Offset, promos OTA) que
   no tienen que ver con Last-Minute.

   config = {channels, discounts, verification} */
import {pct, pct2} from './percent.js';
import {isResolved} from './verification.js';

function offsetFact(c, verification){
  const off = pct2(c.offsetPct);
  if(off===0) return null;
  if(isResolved(verification, 'hospyOffsetIsolated')) return null;
  return {
    key: 'hospyOffsetIsolated',
    severity: 'error',
    label: 'Offset de Hospy/PriceLabs sin confirmar si se aísla por canal',
    reason: `${c.name} tiene un Offset configurado de ${off>0?'+':''}${off}% — si Hospy en realidad distribuye ese Offset a TODOS los canales conectados (no solo ${c.name}), el precio que de verdad se publica en ${c.name} no es el que calculan Piso/Base/Offset aquí.`,
    where: 'Verificación de datos financieros (Resumen) → "Offset de Hospy/PriceLabs se aísla por canal"'
  };
}

function bankFeeFact(c, verification){
  const bankPct = pct(c.bankFeePct);
  if(bankPct<=0) return null;
  if(isResolved(verification, 'bankFeePctByChannel', c.id)) return null;
  return {
    key: 'bankFeePctByChannel',
    severity: 'error',
    label: 'Comisión bancaria/pasarela sin confirmar contra facturas reales',
    reason: `${c.name} descuenta ${bankPct}% de comisión bancaria/pasarela en este modelo, pero ese número es un estimado — no está confirmado contra un extracto o factura real de ${c.name}. Un valor real distinto cambia directamente cuánto neteas.`,
    where: `Verificación de datos financieros (Resumen) → "Comisión bancaria/pasarela real por canal" → ${c.name}`
  };
}

function bookingGeniusMobileFact(discounts, verification){
  const geniusOn = discounts.some(d=>d.ch==='booking' && d.group==='proactive' && d.on && pct(d.pct)>0);
  const mobileOn = discounts.some(d=>d.ch==='booking' && d.group==='proactive-mobile' && d.on && pct(d.pct)>0);
  if(!(geniusOn && mobileOn)) return null;
  if(isResolved(verification, 'bookingGeniusMobileBoth')) return null;
  return {
    key: 'bookingGeniusMobileBoth',
    severity: 'error',
    label: 'Booking: Genius + Mobile Rate sin confirmar en la extranet real',
    reason: 'Este modelo asume que Genius Y Mobile Rate están AMBOS activos y se apilan como aquí se calcula — si en tu extranet real de Booking alguno está apagado, o Booking ya no los combina así, el Piso/Base/Offset de Booking no protegen el escenario real.',
    where: 'Verificación de datos financieros (Resumen) → "Booking: Genius y Mobile Rate en la extranet real"'
  };
}

function expediaVipFact(discounts, verification){
  const vip = discounts.find(d=>d.ch==='expedia' && d.group==='mod');
  if(!vip || !vip.on || pct(vip.pct)<=0) return null;
  if(isResolved(verification, 'expediaVipTierMix')) return null;
  return {
    key: 'expediaVipTierMix',
    severity: 'error',
    label: 'Expedia: mezcla VIP asumida (peor caso) sin confirmar',
    reason: `Este modelo usa ${pct(vip.pct)}% (el peor caso: Gold/Platino) como el descuento VIP de Expedia para TODOS los huéspedes — si la mezcla real de tu unidad es mayoritariamente Blue (10%) o Silver (15%), el Piso/Base real necesario es más bajo que el que muestra esta app; si es peor de lo asumido, podría ser más alto.`,
    where: 'Verificación de datos financieros (Resumen) → "Expedia: mezcla real de niveles VIP"'
  };
}

function airbnbNonRefFact(discounts, verification){
  const nonref = discounts.find(d=>d.id==='ab_nonref');
  if(!nonref || !nonref.on || pct(nonref.pct)<=0) return null;
  if(isResolved(verification, 'airbnbNonRefundable')) return null;
  return {
    key: 'airbnbNonRefundable',
    severity: 'error',
    label: 'Airbnb: descuento no reembolsable activo sin confirmar el % exacto',
    reason: `El modelo tiene un descuento no reembolsable de Airbnb activo (${pct(nonref.pct)}%) sin confirmar que este listing realmente lo tenga activo, o que ese sea el % exacto — un % real distinto cambia el neto de Airbnb.`,
    where: 'Verificación de datos financieros (Resumen) → "Airbnb: descuento no reembolsable"'
  };
}

/* channelFacts: reglas que aplican SOLO al canal indicado por su chId. */
const CHANNEL_SPECIFIC_FACTS = {
  booking: (c, discounts, verification)=>[bookingGeniusMobileFact(discounts, verification)],
  expedia: (c, discounts, verification)=>[expediaVipFact(discounts, verification)],
  airbnb: (c, discounts, verification)=>[airbnbNonRefFact(discounts, verification)]
};

export function evaluateRecommendationReadiness(config){
  const {channels, discounts, verification} = config;
  const byChannel = {};
  channels.forEach(c=>{
    const missing = [offsetFact(c, verification), bankFeeFact(c, verification),
      ...((CHANNEL_SPECIFIC_FACTS[c.id]||(()=>[]))(c, discounts, verification))]
      .filter(Boolean);
    byChannel[c.id] = {ready: missing.length===0, missing};
  });
  const ready = Object.values(byChannel).every(x=>x.ready);
  return {ready, byChannel};
}

/* unreadyChannels() — helper puro compartido (revision externa, P1): matrix.js
   y alerts.js ya recorrian `channels`/`perChannel` filtrando por
   `readiness.byChannel[c.id].ready` cada uno por su cuenta para no afirmar
   "rentable en todos"/"sin conflictos" si CUALQUIER canal (no solo el peor)
   tenia un dato pendiente — la misma pregunta ("¿qué canales, de esta lista,
   siguen con algo sin confirmar?") no debe reimplementarse una tercera vez
   en engine.js para el gate de Min Price/Base Price global. Recibe la LISTA
   de canales a revisar (matrix/alerts a veces solo miran los de una ventana;
   engine.js mira TODOS los canales activos) para no asumir cuál es la
   correcta en cada caller. */
export function unreadyChannels(readiness, channels){
  if(!readiness) return [];
  return channels.filter(c => !(readiness.byChannel[c.id] || {ready:true}).ready);
}

/* evaluateGlobalRecommendationReadiness() — refactor de cierre (revision
   externa): UNICA fuente de verdad para "¿Min Price/Base Price GLOBALES (un
   solo valor que se lleva a PriceLabs y rige los 4 canales) se pueden tratar
   como recomendacion confiable?". Reemplaza a la `globalRecommendationReady()`
   anterior — esa version existia, tenia tests, pero `engine.js` no la
   consumia (calculaba `floorReadinessBlocked`/`baseReadinessBlocked` con su
   propio `unreadyChannels()` inline), asi que la regla vivia duplicada en dos
   lugares con riesgo real de desalinearse. Ademas la version anterior ataba
   `baseBlocked` al `ready` GLOBAL (un solo booleano para los dos), lo cual era
   incorrecto: un precio Last-Minute FIJO en el dia de referencia (`baseBlocked`)
   vuelve irrelevante a BASE, pero el PISO sigue protegiendo de verdad (busca el
   peor escenario real, LM incluido, via `worstScenarioFactor()`) — `baseBlocked`
   nunca debe bloquear el Piso.

   Contrato exacto (no reordenar sin actualizar CLAUDE.md):
   - `floorReady` es true SOLO SI: todos los canales activos tienen sus datos
     financieros resueltos (`unreadyChannels(...).length===0`), `lmBlocked===false`
     Y `currencyBlocked===false`. Last-Minute sin verificar hace que CUALQUIER
     numero global (Piso incluido) sea una proyeccion no verificable — bloquea
     el Piso igual que a Base. Lo mismo aplica a `currencyBlocked` (revision
     externa — simplificacion a USD unico): una unidad marcada "requiere
     revision manual" (su moneda guardada no es USD, ver src/domain/persistence.js)
     no puede mostrar NINGUN numero global — el numero en si podria estar en
     otra moneda, asi que ni el Piso es seguro.
   - `baseReady` es true SOLO SI `floorReady===true` Y `baseBlocked===false`.
     `baseBlocked` (precio LM fijo activo en el dia 45) es una condicion
     ADICIONAL que solo afecta a Base — nunca al Piso.
   - `unreadyChannels`: la lista de canales (objetos `{id,name,...}`) con al
     menos un dato pendiente, para que cualquier consumidor explique CUALES
     canales faltan sin tener que volver a filtrar `readiness.byChannel`.
   - `reasons`: arreglo plano de frases (datos de negocio pendientes + LM sin
     verificar + precio fijo activo, las que apliquen) — bloque reusable para
     construir `floorReason`/`baseReason` sin duplicar texto.
   - `floorReason`/`baseReason`: texto listo para mostrar (o `null` si
     ready), armado SOLO a partir de los parametros recibidos — esta funcion
     no conoce `floorCh`/`baseCh` (que canal fija el numero HOY) a proposito:
     el riesgo que motiva el bloqueo es que CUALQUIER canal pendiente PODRIA
     pasar a fijarlo, no solo el que lo fija en este instante.

   `engine.js` es el UNICO caller de produccion — `floorReadinessBlocked`/
   `floorReadinessBlockedReason`/`baseReadinessBlocked`/`baseReadinessBlockedReason`
   (los campos que expone `compute()`) se derivan DIRECTAMENTE de
   `!floorReady`/`floorReason`/`!baseReady`/`baseReason`, sin recalcular nada.
   Matriz/Alertas usan `unreadyChannels()` (arriba) para sus propios veredictos
   por VENTANA/alerta puntual — una pregunta legitimamente distinta a "¿el
   numero GLOBAL es confiable?" — no llaman a esta funcion. */
export function evaluateGlobalRecommendationReadiness({readiness, channels, lmBlocked, baseBlocked, currencyBlocked}){
  const unready = unreadyChannels(readiness, channels);
  const dataReason = unready.length
    ? `${unready.map(c=>c.name).join(', ')} ${unready.length===1?'depende':'dependen'} de datos financieros sin confirmar: ${unready.map(c=>(readiness.byChannel[c.id].missing||[]).map(m=>m.reason).join(' ')).join(' ')}`
    : null;
  const lmReason = lmBlocked
    ? 'Last-Minute todavía no está verificado — mientras tanto, ningún número global (Min Price ni Base Price) es matemáticamente confiable, es siempre una proyección.'
    : null;
  const baseFixedReason = baseBlocked
    ? 'Hay un precio Last-Minute FIJO activo en el día de referencia (45) — PriceLabs publica ese precio tal cual, así que Base Price no controla nada ahí (el Piso sigue protegiendo: evalúa el peor escenario real, LM incluido).'
    : null;
  /* Simplificacion a USD unico (revision externa): una unidad "requiere
     revision manual" (moneda guardada distinta de USD) nunca puede mostrar
     un numero global — no se sabe con certeza en que moneda quedaria
     expresado. Bloquea igual que lmBlocked (afecta Piso Y Base). */
  const currencyReason = currencyBlocked
    ? 'Esta unidad está marcada "requiere revisión manual" — su moneda guardada no es USD y esta versión solo admite USD. Ningún número global es confiable hasta que corrijas la moneda de la unidad (o la elimines y la vuelvas a crear en USD).'
    : null;

  const floorReady = unready.length===0 && !lmBlocked && !currencyBlocked;
  const baseReady = floorReady && !baseBlocked;

  const floorParts = [dataReason, lmReason, currencyReason].filter(Boolean);
  const baseParts = [dataReason, lmReason, currencyReason, baseFixedReason].filter(Boolean);
  const buildReason = (label, parts) => `${label} es un número GLOBAL que se usa en PriceLabs para TODOS los canales — no se puede tratar como recomendación confiable todavía. ${parts.join(' ')} Confírmalo en Resumen → "Verificación de datos financieros" / "Last-Minute de PriceLabs" antes de usar este número en PriceLabs.`;

  return {
    floorReady, baseReady, unreadyChannels: unready, reasons: baseParts,
    floorReason: floorReady ? null : buildReason('Min Price', floorParts),
    baseReason: baseReady ? null : buildReason('Base Price', baseParts)
  };
}
