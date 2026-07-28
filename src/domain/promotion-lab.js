/*
  Probador de promociones
  -----------------------
  Este módulo no guarda nada ni modifica el objeto que recibe. Construye una
  configuración temporal con una promoción propuesta y la cotiza siempre con
  quoteScenario(), la fuente única de verdad del dinero en la aplicación.

  Orden que se está simulando (el mismo del simulador de reserva):
  Precio FINAL de PriceLabs -> Offset de Kunas por OTA -> promociones OTA ->
  tarifa de aseo -> comisiones OTA/banco -> neto para el anfitrión.
*/
import {compute} from './engine.js';
import {quoteScenario} from './quote.js';

const DEFAULT_NIGHT_SAMPLES = [1, 2, 3, 4, 7, 14, 28];
const OFFSET_MIN = -99.999;
const OFFSET_START_MAX = 1000;

function finiteNumber(value, fallback = null){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

/** Devuelve una copia aislada, segura para probar sin alterar datos guardados. */
export function clonePricingConfig(config){
  return {
    ...config,
    channels: (config.channels || []).map(channel => ({...channel})),
    discounts: (config.discounts || []).map(discount => ({...discount})),
    windows: (config.windows || []).map(window => ({...window})),
    ceilings: {...(config.ceilings || {})},
    costBreakdown: config.costBreakdown ? {...config.costBreakdown} : config.costBreakdown,
    lmConfig: config.lmConfig ? clone(config.lmConfig) : config.lmConfig,
    verification: config.verification ? clone(config.verification) : config.verification,
    usdManualReviewLog: config.usdManualReviewLog ? clone(config.usdManualReviewLog) : config.usdManualReviewLog
  };
}

function applyPromotionProposal(next, proposal){
  const discount = next.discounts.find(item => item.id === proposal?.discountId);
  if(!discount) return {ok:false, reason:'Selecciona una promoción válida del canal.'};

  const pct = finiteNumber(proposal.pct);
  if(pct === null || pct < 0 || pct >= 100){
    return {ok:false, reason:'El descuento debe ser un porcentaje entre 0% y menos de 100%.'};
  }

  discount.on = true;
  discount.pct = pct;
  if(discount.kind === 'window'){
    const from = finiteNumber(proposal.from, discount.from ?? 0);
    const to = finiteNumber(proposal.to, discount.to ?? 9999);
    if(from < 0 || to < from) return {ok:false, reason:'El rango de días de la promoción no es válido.'};
    discount.from = from;
    discount.to = to;
  }
  if(discount.kind === 'los'){
    const minN = finiteNumber(proposal.minN, discount.minN ?? 1);
    if(minN < 1) return {ok:false, reason:'La duración mínima debe ser al menos una noche.'};
    discount.minN = minN;
  }
  return {ok:true, discount};
}

/**
 * Enciende o modifica VARIAS promociones en una copia temporal. Todas deben
 * pertenecer al mismo canal porque el resultado propone un único Offset de
 * Kunas para ese canal. Después, combineChannel() decide cuáles se apilan de
 * verdad y cuáles compiten según las reglas reales de esa OTA.
 */
export function configWithPromotionProposals(config, proposals){
  const next = clonePricingConfig(config);
  const list = Array.isArray(proposals) ? proposals : [];
  if(!list.length) return {ok:false, reason:'Agrega al menos una promoción para probar.', config:next};
  const ids = new Set();
  const discounts=[];
  for(const proposal of list){
    if(ids.has(proposal?.discountId)) return {ok:false, reason:'No agregues la misma promoción dos veces.', config:next};
    ids.add(proposal?.discountId);
    const result = applyPromotionProposal(next, proposal);
    if(!result.ok) return {...result, config:next};
    discounts.push(result.discount);
  }
  const channelIds=[...new Set(discounts.map(discount=>discount.ch))];
  if(channelIds.length!==1) return {ok:false, reason:'Para una prueba, todas las promociones deben ser del mismo canal.', config:next};
  return {ok:true, config:next, discounts, channelId:channelIds[0]};
}

/** Compatibilidad para pruebas/consumidores que envían una sola promoción. */
export function configWithPromotionProposal(config, proposal){
  const result=configWithPromotionProposals(config,[proposal]);
  return result.ok ? {...result, discount:result.discounts[0]} : result;
}

function quoteWithOffset(config, scenario, offsetPct){
  const trial = clonePricingConfig(config);
  const channel = trial.channels.find(item => item.id === scenario.chId);
  if(!channel) return null;
  channel.offsetPct = offsetPct;
  return quoteScenario(scenario, trial);
}

/**
 * Encuentra por búsqueda binaria el Offset mínimo que deja el payout en el
 * objetivo. No repite la fórmula: cada punto se calcula con quoteScenario().
 */
export function offsetForTargetPayout(config, scenario, targetPayout){
  const target = finiteNumber(targetPayout);
  if(target === null || target < 0) return {ok:false, reason:'El objetivo de neto no es válido.'};
  if(!config.channels?.some(channel => channel.id === scenario.chId)){
    return {ok:false, reason:'El canal seleccionado no existe.'};
  }
  const price = finiteNumber(scenario.price);
  if(price === null || price <= 0) return {ok:false, reason:'Ingresa un precio final de PriceLabs mayor que cero.'};

  const lowQuote = quoteWithOffset(config, scenario, OFFSET_MIN);
  if(!lowQuote) return {ok:false, reason:'No se pudo cotizar el canal.'};
  if(lowQuote.payout >= target - 1e-9){
    return {ok:true, offsetPct:OFFSET_MIN, quote:lowQuote, alreadyCovered:true};
  }

  let high = OFFSET_START_MAX;
  let highQuote = quoteWithOffset(config, scenario, high);
  while(highQuote && highQuote.payout < target && high < 100000){
    high *= 2;
    highQuote = quoteWithOffset(config, scenario, high);
  }
  if(!highQuote || highQuote.payout < target){
    return {ok:false, reason:'Ese objetivo no puede alcanzarse con un Offset finito para este escenario.'};
  }

  let low = OFFSET_MIN;
  for(let step=0; step<80; step+=1){
    const middle = (low + high) / 2;
    const quote = quoteWithOffset(config, scenario, middle);
    if(quote.payout >= target) high = middle;
    else low = middle;
  }
  const quote = quoteWithOffset(config, scenario, high);
  return {ok:true, offsetPct:high, quote, alreadyCovered:false};
}

function appliedProposal(quote, discount){
  return quote.applied.some(item => item.name === discount.name);
}

function marginTarget(cost, marginPct){
  const margin = Math.min(Math.max(finiteNumber(marginPct, 0), 0), 99.999);
  return cost / (1 - margin / 100);
}

/**
 * Evalúa una promoción temporal. `finalPrice` representa exactamente el precio
 * FINAL que PriceLabs publica: no se vuelve a aplicar Last-Minute.
 */
export function analyzePromotionProposal(config, proposal){
  const proposals = Array.isArray(proposal?.promotions) && proposal.promotions.length
    ? proposal.promotions
    : [proposal];
  const proposalResult = configWithPromotionProposals(config, proposals);
  if(!proposalResult.ok) return proposalResult;
  const proposedConfig = proposalResult.config;
  const discounts = proposalResult.discounts;
  const discount = discounts[0]; /* compatibilidad: primer elemento para consumidores previos */
  const channel = proposedConfig.channels.find(item => item.id === proposalResult.channelId);
  const days = Math.max(0, finiteNumber(proposal.days, 0));
  const nights = Math.max(1, finiteNumber(proposal.nights, 1));
  const baselineModel = compute(config);
  const proposedModel = compute(proposedConfig);
  const finalPrice = finiteNumber(proposal.finalPrice, baselineModel.floor);
  if(finalPrice === null || finalPrice <= 0){
    return {ok:false, reason:'Ingresa un precio final de PriceLabs mayor que cero.', config:proposedConfig};
  }

  const scenario = {chId:proposalResult.channelId, days, nights, price:finalPrice, priceStage:'price_labs_final'};
  const baseline = quoteScenario(scenario, config);
  const proposed = quoteScenario(scenario, proposedConfig);
  const targetCost = proposed.cost;
  const targetMargin = marginTarget(targetCost, proposedConfig.margin);
  const offsetForCost = offsetForTargetPayout(proposedConfig, scenario, targetCost);
  const offsetForMargin = offsetForTargetPayout(proposedConfig, scenario, targetMargin);
  const currentOffset = finiteNumber(channel?.offsetPct, 0);
  const sampleNights = [...new Set((proposal.nightSamples || DEFAULT_NIGHT_SAMPLES)
    .map(value => Math.max(1, finiteNumber(value, 1))))].sort((a,b) => a-b);
  const durationRows = sampleNights.map(sample => {
    const sampleScenario = {...scenario, nights:sample};
    const quote = quoteScenario(sampleScenario, proposedConfig);
    const costOffset = offsetForTargetPayout(proposedConfig, sampleScenario, quote.cost);
    const requiredMargin = marginTarget(quote.cost, proposedConfig.margin);
    const marginOffset = offsetForTargetPayout(proposedConfig, sampleScenario, requiredMargin);
    return {
      nights:sample,
      promoApplies:discounts.some(item=>appliedProposal(quote,item)),
      proposalStatuses:discounts.map(item=>({
        discountId:item.id,
        name:item.name,
        applies:appliedProposal(quote,item),
        ignored:quote.ignored.find(ignored=>ignored.name===item.name)?.reason||null
      })),
      guest:quote.guestWithFees,
      payout:quote.payout,
      cost:quote.cost,
      margin:quote.margin,
      offsetForCost:costOffset.ok ? costOffset.offsetPct : null,
      offsetForMargin:marginOffset.ok ? marginOffset.offsetPct : null
    };
  });
  const channelComparison = proposedConfig.channels.map(compareChannel => {
    const compareScenario = {...scenario, chId:compareChannel.id};
    const before = quoteScenario(compareScenario, config);
    const after = quoteScenario(compareScenario, proposedConfig);
    return {chId:compareChannel.id, name:compareChannel.name, before, after};
  });

  const coversCost = proposed.payout >= targetCost - 1e-9;
  const reachesMargin = proposed.payout >= targetMargin - 1e-9;
  const proposalStatuses=discounts.map(item=>({
    discountId:item.id,
    name:item.name,
    applies:appliedProposal(proposed,item),
    ignored:proposed.ignored.find(ignored=>ignored.name===item.name)?.reason||null
  }));
  const appliedCount=proposalStatuses.filter(status=>status.applies).length;
  const recommendation = !appliedCount
    ? 'Ninguna de las promociones propuestas aplica en este escenario. Ajusta días o noches antes de decidir.'
    : reachesMargin
      ? 'Puedes activar la promoción con el Offset actual: este escenario conserva tu margen objetivo.'
      : coversCost
        ? 'La promoción cubre costo, pero no llega al margen objetivo. Usa el Offset sugerido de margen si quieres mantenerlo.'
        : 'No la actives con el Offset actual: baja de costo. Sube el Offset o el Min Price de PriceLabs antes de activarla.';

  return {
    ok:true,
    config:proposedConfig,
    discount,
    discounts,
    channel,
    scenario,
    finalPrice,
    baselineModel,
    proposedModel,
    baseline,
    proposed,
    promoApplies:appliedCount>0,
    proposalStatuses,
    targetCost,
    targetMargin,
    currentOffset,
    offsetForCost,
    offsetForMargin,
    coversCost,
    reachesMargin,
    recommendation,
    durationRows,
    channelComparison
  };
}
