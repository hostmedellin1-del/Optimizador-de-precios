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
