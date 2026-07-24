/* Planificación mensual y reparto de utilidad — módulo de dominio puro, sin DOM.
   Responde preguntas que compute()/quoteScenario() (rentabilidad de UNA reserva
   concreta) no responden: ¿la unidad es rentable al final del mes?, ¿cuántas
   noches hay que vender para no perder plata?, ¿qué le queda al propietario y
   al administrador/PM?

   Dos conceptos que este archivo mantiene DELIBERADAMENTE separados (no los
   mezcles al modificar esto):
   - Rentabilidad por RESERVA (compute()/quoteScenario(), src/domain/engine.js
     y quote.js): costo de una reserva concreta de N noches, sin diluir
     limpieza/lavandería/insumos por promedio — eso sigue intacto, este archivo
     no lo toca ni lo reimplementa.
   - Planificación MENSUAL (este archivo): usa costos fijos mensuales
     completos y una estimación de CUÁNTAS reservas caben en el mes
     (noches ocupadas planeadas ÷ estadía promedio) para proyectar costo por
     turno agregado. Es una PROYECCIÓN de planificación, nunca el costo exacto
     de cada reserva — ver `reservationCostBreakdown()` (costs.js) para eso.

   Fuente de los costos: reutiliza exactamente `state.costBreakdown` (Resumen →
   "Costos por noche → calculadora detallada") — nunca inventa un input nuevo
   de costos fijos mensuales:
   - fijos mensuales = rent+admin+utilities+insurance+tech (YA son montos
     mensuales completos, ver costs.js — costBreakdown.occNights es
     literalmente "noches ocupadas al mes", así que se reutiliza tal cual como
     `plannedOccupiedNights`, no se pide un campo nuevo).
   - variable por noche ocupada = consumables.
   - costo por reserva (una vez, no diluido) = cleaning+laundry+supplies.
   Si `costBreakdown` no está lleno (unidad usando solo el modelo simple
   fixedCost/varCost por noche), NO hay costos fijos mensuales reales que
   agregar — este módulo se niega a inventar un total mensual a partir de un
   número por noche (eso sería asumir una ocupación), y devuelve `ok:false`.

   Ingreso: SIEMPRE via quoteScenario() cuando el escenario es 'channel'/'mix'
   (fuente única de verdad, nunca se reimplementa la fórmula de comisiones/
   descuentos/LM/Offset aquí) — o un neto manual directo si el escenario es
   'manual'. Nunca se inventa una mezcla de canales, precio ni ocupación: si
   falta un dato esencial, se devuelve `{ok:false, reason}`, nunca un número
   fabricado. */
import {quoteScenario} from './quote.js';
import {evaluateUsdOnlyReadiness} from './usd-only.js';

/* Simplificacion a USD unico (revision externa) + BLOQUEANTE 1 corregido
   (auditoria externa, ronda 4): esta version SOLO consolida valores en USD
   — nunca convierte, suma ni compara monedas distintas. Antes esta funcion
   intentaba convertir con currency.js/resolveConversion() si un canal
   declaraba `settlementCurrency` distinta; ese camino se eliminó del flujo
   activo (currency.js se conserva para una fase multimoneda futura, pero
   nada en este archivo lo llama). El chequeo de moneda ya NO se hace canal
   por canal dentro de `resolveIncomeScenario()` (eso dejaba pasar canales
   con settlementCurrency distinta de USD que no fueran EL usado en el
   escenario, aunque estuvieran en el mismo catálogo) — `computeMonthlyEconomics()`
   llama a `evaluateUsdOnlyReadiness()` (src/domain/usd-only.js, la MISMA
   función que usan engine.js y reconciliation.js) UNA sola vez, con el
   catálogo COMPLETO de canales, antes de resolver cualquier escenario. Si la
   unidad misma no está en USD, o CUALQUIER canal del catálogo quedó marcado
   con una `settlementCurrency` distinta de USD (dato viejo, ya no
   configurable desde la UI), el escenario se BLOQUEA por completo — nunca
   mezcla montos en silencio. */

/* `mix` trae 4 filas fijas (una por canal del catálogo), todas apagadas
   (`on:false`) por defecto — la UI solo pasa a computeMonthlyEconomics() las
   filas que Dani activó explícitamente (ver index.html, renderMonthlyResult).
   channelIds se recibe explícito (nunca hardcodeado aquí) para no duplicar el
   catálogo de canales — lo pasa el caller (index.html: CHANNELS.map(c=>c.id)). */
export function defaultMonthlyIncomeScenario(channelIds = ['airbnb','booking','expedia','direct']){
  return {
    type: 'manual',
    manualNetPerNight: null, // no configurado — ver P2 (revision externa): 0 NO es "sin dato", es un ingreso real de $0
    channel: {chId: channelIds[0], days:45, nights:1, price:0},
    mix: channelIds.map(chId => ({chId, on:false, weightPct:0, days:45, nights:1, price:0}))
  };
}

/* configured:false por defecto — nunca reparte el `margin` existente de una
   unidad vieja automáticamente entre Propietario/PM (ver CLAUDE.md). */
export function defaultMonthlyDistribution(){
  return {configured:false, ownerTargetPct:0, managerTargetPct:0, reservePct:0, taxReservePct:0};
}

/* --- Reparto propietario/PM/reserva/impuestos ---------------------------
   POLÍTICA ÚNICA (documentada aquí y en CLAUDE.md, no la reinventes en otro
   lado): reservePct/taxReservePct son % del INGRESO NETO MENSUAL (como una
   retención sobre lo que entra, antes de repartir utilidad) — ownerTargetPct/
   managerTargetPct son % de la UTILIDAD DISTRIBUIBLE que queda DESPUÉS de
   costos fijos+variables+reserva+impuestos. No son la misma base: retener
   "impuestos" como % de ingresos es el modelo real de negocio (impuestos se
   pagan sobre lo facturado, no sobre lo que sobra), mientras que Propietario/
   PM se reparten lo que efectivamente queda como ganancia. */
export function validateDistribution(distribution){
  if(!distribution || !distribution.configured) return {ok:true, errors:[]};
  const {ownerTargetPct=0, managerTargetPct=0, reservePct=0, taxReservePct=0} = distribution;
  const errors = [];
  [['ownerTargetPct', ownerTargetPct], ['managerTargetPct', managerTargetPct], ['reservePct', reservePct], ['taxReservePct', taxReservePct]]
    .forEach(([k, v]) => {
      if(!Number.isFinite(v) || v<0) errors.push(`${k}: debe ser un porcentaje válido >= 0 (recibido: ${v}).`);
    });
  if(errors.length) return {ok:false, errors};
  if(ownerTargetPct+managerTargetPct > 100+1e-9)
    errors.push(`Propietario (${ownerTargetPct}%) + Administrador/PM (${managerTargetPct}%) suman ${(ownerTargetPct+managerTargetPct).toFixed(1)}% — no puede superar 100% de la utilidad distribuible.`);
  if(reservePct+taxReservePct > 100+1e-9)
    errors.push(`Reserva (${reservePct}%) + Impuestos (${taxReservePct}%) suman ${(reservePct+taxReservePct).toFixed(1)}% — no puede superar 100% del ingreso neto mensual.`);
  return {ok: errors.length===0, errors};
}

/* Resuelve el neto/noche del escenario de ingreso — la ÚNICA función de este
   archivo que le pide algo a quoteScenario(). `readiness` es el mismo objeto
   que ya devuelve compute() (src/domain/readiness.js) — se REUSA para marcar
   el escenario como no confiable si el canal usado depende de un dato de
   negocio sin confirmar; no se reimplementa esa regla aquí. */
function resolveIncomeScenario(incomeScenario, quoteConfig, readiness){
  const type = incomeScenario && incomeScenario.type;
  if(type==='manual'){
    /* P2 (revision externa): `manualNetPerNight` en null/undefined/'' significa
       "todavia no lo escribiste" — DISTINTO de 0, que es un ingreso real de
       cero. Antes el default era 0 y `Number.isFinite(0)` es true, asi que una
       unidad nueva (nadie toco este campo) mostraba una proyeccion mensual de
       PERDIDA basada en un ingreso que nadie configuro. Ahora null/''/NaN/0/
       negativo devuelven ok:false explicito — no hay una via para "simular en
       0" sin escribir un numero positivo real; no se agrega ese atajo porque
       ningun test/UI lo pide y evita reabrir el mismo hueco por otra puerta. */
    const raw = incomeScenario.manualNetPerNight;
    const netPerNight = parseFloat(raw);
    if(raw===null || raw===undefined || raw===''
      || !Number.isFinite(netPerNight) || netPerNight<=0)
      return {ok:false, reason:'Falta ingresar neto manual por noche — escribe un neto por noche (después de comisiones) mayor que 0 para proyectar el mes. Un campo vacío o en 0 no es un ingreso real, es la ausencia del dato.'};
    return {ok:true, netPerNight, unverified:false, unverifiedReasons:[], usedChannels:[],
      description:`Neto manual: ${netPerNight}/noche (dato directo que escribiste, no calculado por el motor).`};
  }
  if(type==='channel'){
    const ch = incomeScenario.channel || {};
    if(!ch.chId) return {ok:false, reason:'Escenario de canal específico: falta elegir un canal.'};
    if(!quoteConfig) return {ok:false, reason:'Escenario de canal específico: falta la configuración de canales/descuentos/LM para cotizar.'};
    const price = parseFloat(ch.price);
    if(!Number.isFinite(price) || price<=0)
      return {ok:false, reason:'Escenario de canal específico: falta un precio de PriceLabs válido (> 0) para cotizar.'};
    const days = Math.max(0, parseFloat(ch.days)||0);
    const nights = Math.max(1, parseFloat(ch.nights)||1);
    const q = quoteScenario({chId: ch.chId, days, nights, price}, quoteConfig);
    const chReady = !readiness || !readiness.byChannel[ch.chId] || readiness.byChannel[ch.chId].ready;
    const unverifiedReasons = [];
    if(q.lmBlocked) unverifiedReasons.push('Last-Minute sin verificar');
    if(!chReady) readiness.byChannel[ch.chId].missing.forEach(m=>unverifiedReasons.push(m.label));
    return {ok:true, netPerNight: q.payout, unverified: unverifiedReasons.length>0, unverifiedReasons, usedChannels:[ch.chId],
      description:`Cotizado con quoteScenario() — ${q.ch.name}, día ${days}, ${nights} noche${nights===1?'':'s'}, precio ${price}: payout ${q.payout.toFixed(2)}/noche.`};
  }
  if(type==='mix'){
    const mix = Array.isArray(incomeScenario.mix) ? incomeScenario.mix.filter(m=>m && m.chId) : [];
    if(!mix.length) return {ok:false, reason:'Escenario de mezcla de canales: falta configurar al menos un canal con su % de peso.'};
    if(!quoteConfig) return {ok:false, reason:'Escenario de mezcla de canales: falta la configuración de canales/descuentos/LM para cotizar.'};
    const totalWeight = mix.reduce((s, m) => s+(parseFloat(m.weightPct)||0), 0);
    if(Math.abs(totalWeight-100) > 0.5)
      return {ok:false, reason:`Escenario de mezcla de canales: los % de peso suman ${totalWeight.toFixed(1)}%, deben sumar 100% — no se asume una normalización silenciosa.`};
    let weightedSum = 0;
    const unverifiedReasons = [];
    const usedChannels = [];
    for(const m of mix){
      const price = parseFloat(m.price);
      if(!Number.isFinite(price) || price<=0)
        return {ok:false, reason:`Escenario de mezcla de canales: falta un precio válido (> 0) para ${m.chId}.`};
      const days = Math.max(0, parseFloat(m.days)||0);
      const nights = Math.max(1, parseFloat(m.nights)||1);
      const w = (parseFloat(m.weightPct)||0)/100;
      const q = quoteScenario({chId: m.chId, days, nights, price}, quoteConfig);
      weightedSum += q.payout*w;
      usedChannels.push(m.chId);
      const chReady = !readiness || !readiness.byChannel[m.chId] || readiness.byChannel[m.chId].ready;
      if(q.lmBlocked && !unverifiedReasons.includes('Last-Minute sin verificar')) unverifiedReasons.push('Last-Minute sin verificar');
      if(!chReady) readiness.byChannel[m.chId].missing.forEach(mi=>{ if(!unverifiedReasons.includes(mi.label)) unverifiedReasons.push(mi.label); });
    }
    return {ok:true, netPerNight: weightedSum, unverified: unverifiedReasons.length>0, unverifiedReasons, usedChannels,
      description:`Mezcla ponderada de ${mix.length} canal(es) — neto ponderado ${weightedSum.toFixed(2)}/noche.`};
  }
  return {ok:false, reason:'Escenario de ingreso mensual no configurado — elige Manual, Canal específico o Mezcla de canales.'};
}

/* Un punto (fijo un numero de noches ocupadas) de la proyeccion mensual —
   reutilizado tanto para el resultado principal como para cada fila de la
   tabla de sensibilidad, para que ambos usen EXACTAMENTE la misma fórmula. */
function monthlyPoint({netPerNight, occupiedNights, avgNights, fixedCostsMonthly, perNightVarCost, perReservationCost, reservePct, taxReservePct}){
  const estimatedReservations = occupiedNights/avgNights;
  const netIncomeMonthly = netPerNight*occupiedNights;
  const variableCostsMonthly = perNightVarCost*occupiedNights + perReservationCost*estimatedReservations;
  const reserveAmt = netIncomeMonthly*(reservePct||0)/100;
  const taxAmt = netIncomeMonthly*(taxReservePct||0)/100;
  const profitMonthly = netIncomeMonthly - fixedCostsMonthly - variableCostsMonthly - reserveAmt - taxAmt;
  return {occupiedNights, estimatedReservations, netIncomeMonthly, variableCostsMonthly, reserveAmt, taxAmt, profitMonthly};
}

/* config = {costBreakdown, avgNights, incomeScenario, quoteConfig?, distribution?,
   currency?, readiness?, sensitivityNights?, usdManualReviewPending?} */
export function computeMonthlyEconomics(config){
  const {costBreakdown, incomeScenario, quoteConfig, distribution, readiness} = config;
  const currency = config.currency || 'USD';
  const sensitivityNights = config.sensitivityNights || [0, 5, 10, 15, 20, 25, 30];
  const assumptions = [];

  /* Simplificacion a USD unico (revision externa) + BLOQUEANTE 1 corregido
     (auditoria externa, ronda 4): gate MAS FUNDAMENTAL, antes que cualquier
     otra validacion — una unidad marcada "requiere revision manual" (moneda
     guardada != USD, O CUALQUIER canal del catálogo con settlementCurrency
     distinta de USD) no puede proyectar NADA, ni siquiera el escenario
     manual (el ingreso que Dani escribe podria estar el mismo afectado por
     un dato historico en otra moneda). evaluateUsdOnlyReadiness() (src/domain/
     usd-only.js) es la MISMA fuente que usan engine.js/reconciliation.js —
     nunca convierte, nunca asume 1:1. */
  const usdGate = evaluateUsdOnlyReadiness({unitCurrency: currency, channels: quoteConfig && quoteConfig.channels, usdManualReviewPending: config.usdManualReviewPending, usdManualReviewLog: config.usdManualReviewLog});
  if(usdGate.blocked){
    return {ok:false, reason:`Esta unidad está marcada "requiere revisión manual" — ${usdGate.reason} Esta versión solo admite USD. Corrige el dato (o elimina y recrea la unidad/canal directamente en USD) antes de calcular la planificación mensual.`, currency};
  }

  const avgNights = parseFloat(config.avgNights);
  if(!Number.isFinite(avgNights) || avgNights<1){
    return {ok:false, reason:'Falta la Estadía promedio (noches) — debe ser un número >= 1. Sin esto no se puede estimar cuántas reservas caben en el mes.', currency};
  }

  const cb = costBreakdown || {};
  const fixedCostsMonthly = (parseFloat(cb.rent)||0)+(parseFloat(cb.admin)||0)+(parseFloat(cb.utilities)||0)+(parseFloat(cb.insurance)||0)+(parseFloat(cb.tech)||0);
  const perNightVarCost = parseFloat(cb.consumables)||0;
  const perReservationCost = (parseFloat(cb.cleaning)||0)+(parseFloat(cb.laundry)||0)+(parseFloat(cb.supplies)||0);
  const plannedOccupiedNights = parseFloat(cb.occNights);
  if(!costBreakdown || !Number.isFinite(plannedOccupiedNights) || plannedOccupiedNights<0){
    return {ok:false, reason:'Falta "Noches ocupadas al mes" en la calculadora de costos detallada (Resumen → Costos por noche) — sin este dato no hay una base mensual real que proyectar.', currency};
  }
  if(fixedCostsMonthly<=0){
    assumptions.push('Costos fijos mensuales (arriendo + administración + servicios + seguro + tecnología) suman 0 en la calculadora detallada — si esto no es correcto, complétalos antes de confiar en este resultado.');
  }

  const income = resolveIncomeScenario(incomeScenario, quoteConfig, readiness);
  if(!income.ok) return {ok:false, reason: income.reason, currency};

  const distValidation = validateDistribution(distribution);
  if(!distValidation.ok) return {ok:false, reason: distValidation.errors.join(' '), currency};

  /* reservePct/taxReservePct son parte del MISMO interruptor que Propietario/PM
     (`distribution.configured`) — si el reparto detallado está apagado, NINGUNO
     de los cuatro aplica (ver CLAUDE.md: "la migración no debe cambiar
     resultados existentes hasta que el usuario active el reparto detallado").
     Sin este gate, un valor viejo de reserva/impuestos que quedó en `state`
     seguiría restando de la utilidad aunque la UI ya no muestre esos campos. */
  const reservePct = (distribution && distribution.configured && distribution.reservePct) || 0;
  const taxReservePct = (distribution && distribution.configured && distribution.taxReservePct) || 0;

  const base = monthlyPoint({netPerNight: income.netPerNight, occupiedNights: plannedOccupiedNights, avgNights, fixedCostsMonthly, perNightVarCost, perReservationCost, reservePct, taxReservePct});

  /* Punto de equilibrio: contribución REAL por noche ocupada — neto por noche
     menos el consumo variable de esa noche, menos el costo por reserva
     diluido SOLO aquí (proyección de planificación) entre la estadía
     promedio (nunca al evaluar una reserva concreta, ver costs.js). Si esa
     contribución es <= 0, ningún volumen de ventas cubre los fijos: el
     equilibrio no es "Infinity", es explícitamente "no alcanzable". */
  const contributionPerNight = income.netPerNight - perNightVarCost - (perReservationCost/avgNights);
  const breakeven = contributionPerNight<=0
    ? {reachable:false, nightsExact:null, nightsCeil:null, contributionPerNight,
        reason:'La contribución por noche ocupada (neto por noche − consumo por noche − costo por reserva ÷ estadía promedio) es <= 0 — ningún volumen de noches cubre los costos fijos con este precio/costo. Sube el precio, baja costos, o revisa el escenario de ingreso.'}
    : {reachable:true, nightsExact: fixedCostsMonthly/contributionPerNight, nightsCeil: Math.ceil(fixedCostsMonthly/contributionPerNight), contributionPerNight, reason:null};

  /* Reparto: NUNCA se infiere de `margin` (el objetivo total sin repartir de
     una unidad vieja) — solo se calcula si `distribution.configured===true`,
     una acción explícita de Dani. Si no está configurado, la utilidad
     distribuible se muestra completa, sin dividir, con un aviso. */
  let distributionResult;
  if(distribution && distribution.configured){
    const ownerAmt = base.profitMonthly*(distribution.ownerTargetPct||0)/100;
    const managerAmt = base.profitMonthly*(distribution.managerTargetPct||0)/100;
    distributionResult = {configured:true, ownerAmt, managerAmt, undistributedAmt: base.profitMonthly-ownerAmt-managerAmt};
  } else {
    distributionResult = {configured:false, ownerAmt:null, managerAmt:null, undistributedAmt: base.profitMonthly};
    assumptions.push('Reparto Propietario/Administrador no configurado — la utilidad distribuible se muestra completa, sin dividir. Actívalo explícitamente para separar Propietario/PM/Reserva/Impuestos; el margen objetivo existente NUNCA se reparte automáticamente.');
  }

  if(income.unverified){
    assumptions.push(`Este escenario de ingreso depende de datos financieros sin confirmar (${income.unverifiedReasons.join('; ')}) — es una SIMULACIÓN, no una recomendación automática, hasta que los confirmes.`);
  }

  const marginMonthlyPct = base.netIncomeMonthly>0 ? (base.profitMonthly/base.netIncomeMonthly)*100 : null;

  const sensitivity = sensitivityNights.map(n => {
    const p = monthlyPoint({netPerNight: income.netPerNight, occupiedNights:n, avgNights, fixedCostsMonthly, perNightVarCost, perReservationCost, reservePct, taxReservePct});
    return {nights:n, estimatedReservations:p.estimatedReservations, netIncomeMonthly:p.netIncomeMonthly, variableCostsMonthly:p.variableCostsMonthly, profitMonthly:p.profitMonthly};
  });

  return {
    ok:true, reason:null, currency,
    plannedOccupiedNights, avgNights, estimatedReservations: base.estimatedReservations,
    fixedCostsMonthly, perNightVarCost, perReservationCost,
    incomeSource: income,
    netIncomeMonthly: base.netIncomeMonthly, variableCostsMonthly: base.variableCostsMonthly,
    reserveAmt: base.reserveAmt, taxAmt: base.taxAmt,
    profitMonthly: base.profitMonthly, marginMonthlyPct,
    breakeven,
    distribution: distributionResult,
    sensitivity,
    assumptions
  };
}
