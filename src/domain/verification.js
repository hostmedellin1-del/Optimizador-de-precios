/* Fase 4 — registro de verificacion por unidad. Ninguno de estos hechos se puede
   confirmar sin que Dani revise la cuenta real (extranet Booking, Hospy, facturas
   bancarias, PriceLabs) — esta app NUNCA debe inventar el valor ni asumir que ya
   esta confirmado. Cada clave por defecto queda en 'no_verificado'; solo pasa a
   'verificado' (o 'no_aplica', si Dani confirma que ese dato no aplica a esta
   unidad) si Dani lo marca explicitamente, con fuente/fecha/nota de donde lo
   confirmo.

   Fase 5 (revision externa — "datos financieros verificados"): esta lista dejo
   de ser solo una etiqueta visual. src/domain/readiness.js la usa para BLOQUEAR
   recomendaciones automaticas (Piso/Base/Offset/Matriz) por canal cuando un
   hecho financiero del que depende ese canal sigue sin confirmar — ver
   evaluateRecommendationReadiness(). Cada clave declara su `scope`:
   - 'global': un solo registro para toda la unidad (ej. el modo de LM de
     PriceLabs es un dato de LISTING, no de canal).
   - 'channel': un registro POR CANAL (ej. la comision bancaria/pasarela puede
     ser distinta por canal, y Dani puede haber confirmado unos canales y no
     otros) — ver CHANNEL_IDS. */
import {CHANNELS} from '../catalog/discounts.js';

export const CHANNEL_IDS = CHANNELS.map(c=>c.id);

export const VERIFICATION_KEYS = {
  hospyOffsetIsolated: {
    scope: 'global',
    label: 'Hospy: ¿el Offset por canal de PriceLabs se aísla de verdad por canal, o se distribuye a todos los conectados?'
  },
  bankFeePctByChannel: {
    scope: 'channel',
    label: 'Comisión bancaria/pasarela real por canal (hoy son estimados de Dani, no verificados contra facturas)'
  },
  bookingGeniusMobileBoth: {
    scope: 'global',
    label: 'Booking: ¿Genius y Mobile Rate están AMBOS activos en la extranet real?'
  },
  expediaVipTierMix: {
    scope: 'global',
    label: 'Expedia: mezcla real de niveles VIP del huésped en esta unidad (hoy se usa 20% — el peor caso — por defecto)'
  },
  airbnbNonRefundable: {
    scope: 'global',
    label: 'Airbnb: ¿este listing tiene descuento no reembolsable activo? ¿cuál es el % exacto?'
  },
  priceLabsLmMode: {
    scope: 'global',
    label: 'PriceLabs: ¿qué modo de Last-Minute usa esta unidad realmente (automático/plano/gradual/precio fijo/tramos)? — el bloqueo real de Min Price/Base/Offset ya lo hace la casilla "Confirmé este modo directamente en PriceLabs" (Resumen → Last-Minute); este registro es solo para dejar nota/fuente/fecha de esa confirmación, no una segunda fuente de verdad.'
  }
};

export function emptyVerificationEntry(){
  return {status:'no_verificado', source:'', date:'', note:''};
}

/* defaultVerification(): unidad nueva, nada confirmado todavia — jamas
   'verificado' por defecto. Las claves de alcance 'channel' arrancan con un
   registro por cada canal conocido (CHANNEL_IDS), no un unico registro plano. */
export function defaultVerification(){
  const out = {};
  Object.keys(VERIFICATION_KEYS).forEach(key=>{
    out[key] = VERIFICATION_KEYS[key].scope==='channel'
      ? Object.fromEntries(CHANNEL_IDS.map(chId=>[chId, emptyVerificationEntry()]))
      : emptyVerificationEntry();
  });
  return out;
}

/* isVerified(verification, key, chId?) — para claves 'global', omite chId. Para
   claves 'channel', chId es obligatorio (si se omite, no hay registro que leer
   y se trata como no verificado — nunca se asume verificado por falta de dato). */
export function isVerified(verification, key, chId){
  if(!verification || !verification[key]) return false;
  const entry = chId!=null ? verification[key][chId] : verification[key];
  return !!(entry && entry.status==='verificado');
}

/* Un hecho "no aplica" (Dani confirmo explicitamente que ese dato no es
   relevante para esta unidad/canal) tampoco debe bloquear — es una resolucion
   explicita, distinta de 'no_verificado' (pendiente) y de 'verificado'
   (confirmado con un valor real). */
export function isResolved(verification, key, chId){
  if(!verification || !verification[key]) return false;
  const entry = chId!=null ? verification[key][chId] : verification[key];
  return !!(entry && (entry.status==='verificado' || entry.status==='no_aplica'));
}
