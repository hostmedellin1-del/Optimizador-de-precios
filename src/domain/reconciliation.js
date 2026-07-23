/* Reconciliacion de reservas reales — preparacion para datos reales (revision
   externa). El motor (compute()/quoteScenario()) es matematicamente correcto
   dado lo que Dani configura, pero eso no prueba que la configuracion
   represente la cuenta real: una comision, tarifa o descuento mal cargado
   produce un estimado consistente pero incorrecto. Este modulo compara el
   estimado de quoteScenario() (fuente UNICA, nunca se reimplementa la formula
   aqui) contra los datos REALES de una liquidacion/reserva que Dani ingresa a
   mano, y explica la diferencia — nunca cambia `state.channels`/`state.discounts`
   automaticamente: solo sugiere "revisar/verificar", la confirmacion sigue
   siendo 100% manual (Resumen → Verificación de datos financieros).

   real = {chId, price, days, nights, currency, payoutReceived, reference?,
           otaCommissionPct?, bankFeePct?, cleaningFeeCharged?, nativeDiscountPct?}
   config = {quoteConfig, currency, fxRates, readiness} */
import {quoteScenario} from './quote.js';
import {resolveConversion} from './currency.js';

const EPS = 0.05; // umbral de "distinto" para comparar % configurado vs real — ruido de tecleo por debajo de esto no cuenta como discrepancia

/* Severidad — umbral documentado (no lo reinventes en otro lado):
   |diff%| <= 3%  -> 'ok' (ruido normal de redondeo/timing, confiable).
   |diff%| > 3%   -> 'warn' si el real es MAYOR al estimado (mejor de lo
                     esperado — vale la pena entender por que, pero no es una
                     alarma de perdida).
   |diff%| > 3% Y el real es MENOR al estimado -> 'warn', y si ademas supera
                     10% -> 'bad' (estas recibiendo menos de lo que el modelo
                     asume — el Piso/Base calculados con este canal podrian
                     estar protegiendo de menos de lo que crees). */
function severityOf(diffAbs, diffPct){
  if(diffPct===null) return 'ok';
  const absPct = Math.abs(diffPct);
  if(absPct<=3) return 'ok';
  if(diffAbs<0 && absPct>10) return 'bad';
  return 'warn';
}

export function reconcileReservation(config){
  const {real, quoteConfig, currency, fxRates, readiness} = config;
  if(!real || typeof real!=='object')
    return {ok:false, reason:'Faltan los datos de la reserva real.'};
  if(!quoteConfig || !Array.isArray(quoteConfig.channels))
    return {ok:false, reason:'Falta la configuración de canales/descuentos/LM para cotizar el estimado.'};

  const chId = real.chId;
  const ch = quoteConfig.channels.find(c=>c.id===chId);
  if(!ch) return {ok:false, reason:'Elige un canal real conocido para poder cotizar el estimado.'};

  const price = parseFloat(real.price);
  if(!Number.isFinite(price) || price<=0)
    return {ok:false, reason:'Falta el precio publicado por PriceLabs (> 0) de la reserva real — sin esto no hay nada que cotizar como estimado.'};
  const nightsRaw = parseFloat(real.nights);
  if(!Number.isFinite(nightsRaw) || nightsRaw<1)
    return {ok:false, reason:'Faltan las noches reales de la reserva (número entero >= 1).'};
  const nights = Math.max(1, nightsRaw);
  const days = Math.max(0, parseFloat(real.days)||0);
  const payoutReceived = parseFloat(real.payoutReceived);
  if(!Number.isFinite(payoutReceived))
    return {ok:false, reason:'Falta el payout/liquidación real recibido — sin este dato no hay nada que comparar contra el estimado.'};

  /* Estimado — SIEMPRE via quoteScenario(), nunca una formula paralela. */
  const estimate = quoteScenario({chId, days, nights, price}, quoteConfig);

  /* Contrato de moneda (revision externa): el estimado esta expresado en la
     moneda BASE de la unidad (`currency`) — si la liquidacion real llego en
     otra moneda, se exige una conversion EXPLICITA y VERIFICADA antes de
     calcular cualquier diferencia numerica. Sin esa conversion, NUNCA se
     resta un monto en USD de un monto en COP como si fueran comparables. */
  const realCurrency = real.currency || currency;
  let payoutReceivedInBase = payoutReceived;
  let conversionCaveat = null;
  if(realCurrency !== currency){
    const conv = resolveConversion({amount: payoutReceived, fromCurrency: realCurrency, toCurrency: currency, fxRates});
    if(!conv.ok){
      return {
        ok:true, currencyBlocked:true, currencyBlockedReason: conv.reason,
        estimate,
        real: {...real, chId, price, nights, days, payoutReceived, currency: realCurrency},
        diff:null, breakdown:[], causes:[], severity:null, reliable:false, unverifiedAssumptions:[]
      };
    }
    payoutReceivedInBase = conv.value;
    conversionCaveat = conv.caveat;
  }

  const diffAbs = payoutReceivedInBase - estimate.payout;
  const diffPct = estimate.payout>0 ? (diffAbs/estimate.payout)*100 : null;

  /* Desglose por componente — SOLO se compara lo que Dani realmente escribio
     (campos opcionales); no se inventa un "real" para un campo que no llego. */
  const breakdown = [];
  const causes = [];
  const addComponent = (label, configured, realValue, causeText)=>{
    if(realValue==null || !Number.isFinite(realValue)) return;
    if(Math.abs(realValue-configured) <= EPS) return;
    breakdown.push({component:label, configured, real:realValue});
    causes.push(causeText(configured, realValue));
  };
  addComponent('Comisión OTA %', ch.comm||0, real.otaCommissionPct!=null && real.otaCommissionPct!=='' ? parseFloat(real.otaCommissionPct) : null,
    (cfg,r)=>`Comisión OTA real de ${ch.name} (${r}%) distinta de la configurada (${cfg}%) — confirma el % real en la extranet/factura de ${ch.name} antes de tratar el modelo como definitivo.`);
  addComponent('Comisión bancaria/pasarela %', ch.bankFeePct||0, real.bankFeePct!=null && real.bankFeePct!=='' ? parseFloat(real.bankFeePct) : null,
    (cfg,r)=>`Comisión bancaria/pasarela real (${r}%) distinta de la configurada (${cfg}%) — revisa el extracto bancario de esa liquidación.`);
  addComponent('Tarifa de aseo', estimate.feeTotal, real.cleaningFeeCharged!=null && real.cleaningFeeCharged!=='' ? parseFloat(real.cleaningFeeCharged) : null,
    (cfg,r)=>`Tarifa de aseo cobrada realmente (${r}) distinta de la configurada (${cfg.toFixed(2)}) para ${ch.name}.`);
  addComponent('Descuento nativo del canal %', estimate.nativoPct, real.nativeDiscountPct!=null && real.nativeDiscountPct!=='' ? parseFloat(real.nativeDiscountPct) : null,
    (cfg,r)=>`Descuento nativo reportado por ${ch.name} (${r}%) distinto del calculado por el modelo (${cfg}%) — puede haber aplicado una promo distinta a la configurada aquí.`);

  if(!breakdown.length && Math.abs(diffAbs)>EPS){
    causes.push('No se ingresaron comisiones/tarifas reales específicas para aislar la causa exacta — solo se sabe que el payout total difiere. Ingresa la comisión OTA, bancaria y/o tarifa de aseo reales (de la factura/extranet) para acotar el motivo.');
  }

  /* Si el estimado YA dependia de un supuesto sin confirmar, la diferencia
     podria explicarse exactamente por eso — se propaga, no se reimplementa
     la regla de Fase 5/LM (isLmBlocked()/readiness.js siguen siendo la unica
     fuente, aqui solo se lee lo que ya calculo quoteScenario()/engine.js). */
  const unverifiedAssumptions = [];
  if(estimate.lmBlocked) unverifiedAssumptions.push('El estimado depende de Last-Minute sin verificar (modo automático o sin marcar como confirmado) — esta diferencia podría explicarse por eso.');
  const chReady = !readiness || !readiness.byChannel[chId] || readiness.byChannel[chId].ready;
  if(!chReady) readiness.byChannel[chId].missing.forEach(m=>unverifiedAssumptions.push(`El estimado depende de un dato sin confirmar: ${m.label}.`));

  const severity = severityOf(diffAbs, diffPct);
  const reliable = severity==='ok';

  return {
    ok:true, currencyBlocked:false, currencyBlockedReason:null, conversionCaveat,
    estimate,
    real: {...real, chId, price, nights, days, payoutReceived, payoutReceivedInBase, currency: realCurrency},
    diff: {absolute: diffAbs, percent: diffPct},
    breakdown, causes, severity, reliable,
    unverifiedAssumptions
  };
}
