/* Fase 4 — PriceLabs Last-Minute configurable por unidad/listing. 5 modos, pedidos
   explicitamente por Dani. NINGUNO inventa un % real de negocio: todos arrancan
   apagados/en 0 (ver defaultLmConfig(), src/catalog/discounts.js) hasta que Dani
   los configure con el dato real de su cuenta de PriceLabs.

   Se aplica DENTRO de quoteScenario(), ANTES del Offset por canal y ANTES de los
   descuentos nativos de la OTA (mismo orden que el LM de techo/ventana de
   siempre) — ver quote.js. Devuelve siempre la MISMA forma:
     {lmPct, priceOverride, verified, blocked, note}
   - lmPct: % a aplicar sobre el precio (0 si el modo usa priceOverride en su lugar).
   - priceOverride: si no es null, quoteScenario debe usar ESTE precio en vez de
     price*(1-lmPct/100) — solo lo usa el modo 'fixed_price'.
   - verified: viene de lmConfig.verified (Dani confirma que este es el modo real).
   - blocked: true si el motor NO puede calcular esto matematicamente sin un dato
     que falta (modo 'ceiling_auto' sin precio diario real de PriceLabs) — quien
     consuma esto debe evitar recomendaciones categoricas cuando blocked=true.
   - note: texto para el array `assumptions` de quoteScenario. */

/* Modo 1 — automatico/PriceLabs-determinado: mismo comportamiento de siempre
   (techo de ventana menos nativo). Matematicamente NO verificable sin el precio
   diario real que PriceLabs calcularia — se marca `blocked` para que quien
   consuma esto no lo trate como un numero categorico y confiable. */
function ceilingAuto(ceilingPct, nativePct){
  const breach = nativePct > ceilingPct;
  const lmPct = breach ? 0 : Math.max(0, 100*(1-(1-ceilingPct/100)/(1-nativePct/100)));
  return {
    lmPct, priceOverride: null, blocked: true,
    note: 'LM en modo automatico (PriceLabs decide la curva real): este % es una PROYECCION basada en el techo de la ventana, no el numero real que PriceLabs aplicaria dia a dia — no verificable matematicamente sin el precio diario real de la cuenta. No uses esto como recomendacion categorica de Min Price/Base/Offset sin confirmar contra PriceLabs.'
  };
}

/* Modo 2 — descuento plano configurable: % fijo entre fromDay y toDay. */
function flat(cfg, day){
  const on = cfg && cfg.on && (parseFloat(cfg.pct)||0)>0;
  const inRange = on && day>=(cfg.fromDay??0) && day<=(cfg.toDay??0);
  return {lmPct: inRange ? (parseFloat(cfg.pct)||0) : 0, priceOverride: null, blocked: false, note: null};
}

/* Modo 3 — descuento gradual: `maxPct` en el dia 0, decae LINEALMENTE hasta 0 en
   `days`. day>=days => 0. NO aplica maxPct plano a todos los dias (ese es
   justamente el bug que Dani pidio evitar) — calcula el % real de CADA dia. */
function gradualPctAtDay(cfg, day){
  const on = cfg && cfg.on && (parseFloat(cfg.maxPct)||0)>0 && (parseFloat(cfg.days)||0)>0;
  if(!on) return 0;
  const days = parseFloat(cfg.days)||1;
  if(day>=days || day<0) return 0;
  const maxPct = parseFloat(cfg.maxPct)||0;
  return maxPct * (1 - day/days);
}
function gradual(cfg, day){
  return {lmPct: gradualPctAtDay(cfg, day), priceOverride: null, blocked: false, note: null};
}
/* Tabla dia-a-dia (para mostrar la curva completa en la UI, no solo el punto que
   se esta cotizando ahora mismo). */
export function gradualCurve(cfg){
  if(!cfg || !cfg.on) return [];
  const days = Math.max(1, parseFloat(cfg.days)||1);
  const out = [];
  for(let d=0; d<days; d++) out.push({day:d, pct: gradualPctAtDay(cfg, d)});
  out.push({day:days, pct:0});
  return out;
}

/* Modo 4 — precio Last-Minute FIJO: reemplaza el precio de PriceLabs por un valor
   fijo dentro del rango de dias. Advierte si ese precio fijo podria caer bajo el
   Piso (floor) — el caller decide que hacer con ese warning (assumptions). */
function fixedPrice(cfg, day, floor){
  const on = cfg && cfg.on && (parseFloat(cfg.price)||0)>0;
  const inRange = on && day>=(cfg.fromDay??0) && day<=(cfg.toDay??0);
  if(!inRange) return {lmPct:0, priceOverride:null, blocked:false, note:null};
  const price = parseFloat(cfg.price)||0;
  const belowFloor = typeof floor==='number' && floor>0 && price<floor;
  return {
    lmPct: 0, priceOverride: price, blocked: false,
    note: belowFloor ? `Precio Last-Minute fijo (${price}) esta POR DEBAJO del Piso (${floor.toFixed(2)}) en este rango de dias — revisa si esto es intencional, podria vender bajo costo.` : null
  };
}

/* Modo 5 — tramos personalizados: varios tramos con dia-desde/dia-hasta/%, cada
   uno activable/desactivable y ORDENABLE. Politica de solape EXPLICITA (pedida
   por Dani, para no sumar tramos por accidente): el PRIMER tramo activo (en el
   orden del arreglo) cuyo rango incluya `day` es el que aplica — no se suman
   ni se promedian. Si Dani confirma que PriceLabs realmente combina tramos
   distinto, esta politica se ajusta aqui, en un solo lugar. */
function tiers(tiersArr, day){
  const list = tiersArr||[];
  const hit = list.find(t=>t.on && day>=(t.fromDay??0) && day<=(t.toDay??0));
  if(!hit) return {lmPct:0, priceOverride:null, blocked:false, note:null};
  return {lmPct: parseFloat(hit.pct)||0, priceOverride:null, blocked:false, note:`Tramo aplicado: ${hit.label||hit.id} (dia ${hit.fromDay}-${hit.toDay})`};
}

/* Dispatcher — unico punto de entrada que usa quoteScenario(). */
export function priceLabsLm(lmConfig, {day, ceilingPct, nativePct, floor} = {}){
  const cfg = lmConfig || {mode:'ceiling_auto'};
  let result;
  switch(cfg.mode){
    case 'flat': result = flat(cfg.flat, day); break;
    case 'gradual': result = gradual(cfg.gradual, day); break;
    case 'fixed_price': result = fixedPrice(cfg.fixedPrice, day, floor); break;
    case 'tiers': result = tiers(cfg.tiers, day); break;
    case 'ceiling_auto':
    default: result = ceilingAuto(ceilingPct, nativePct); break;
  }
  return {...result, mode: cfg.mode||'ceiling_auto', verified: !!cfg.verified};
}

/* Bloqueante CRITICO (revision externa, ronda 2): si el LM no es matematicamente
   verificable, NINGUNA vista puede presentar un resultado derivado de el (Min
   Price, Base Price, Offset, veredicto "Rentable" de la matriz) como una
   recomendacion confiable. `blocked`/`verified` ya se calculaban por escenario
   dentro de priceLabsLm(), pero son en realidad una propiedad PURA de la config
   de LM (mode/verified) — no dependen del dia/canal que se este cotizando (ver
   ceilingAuto(), que siempre bloquea, y las demas funciones de modo, que nunca
   bloquean por si solas). Se expone aqui como funcion pura de un solo lugar para
   que compute()/quoteScenario()/alerts.js/matrix.js NUNCA calculen esto cada
   uno por su cuenta (fuente unica, igual que el resto del motor). */
export function isLmBlocked(lmConfig){
  const cfg = lmConfig || {mode:'ceiling_auto', verified:false};
  const mode = cfg.mode||'ceiling_auto';
  if(mode==='ceiling_auto') return true; // proyeccion, nunca verificable matematicamente
  return !cfg.verified;
}

/* Fase 4 — peor caso: dias criticos adicionales que introduce la config de LM
   (bordes de tramos/flat/gradual/precio fijo), para que la enumeracion de
   worstNative()/alertas/matriz tambien evalue esos bordes exactos y no solo los
   de descuentos nativos OTA. */
export function lmCriticalDays(lmConfig){
  const days = new Set();
  const cfg = lmConfig;
  if(!cfg) return [];
  const addRange = (from,to)=>{
    days.add(Math.max(0,from)); days.add(Math.max(0,from-1)); days.add(to); days.add(to+1);
  };
  if(cfg.mode==='flat' && cfg.flat && cfg.flat.on) addRange(cfg.flat.fromDay??0, cfg.flat.toDay??0);
  if(cfg.mode==='gradual' && cfg.gradual && cfg.gradual.on){ days.add(0); const d=cfg.gradual.days??0; days.add(d); days.add(Math.max(0,d-1)); days.add(d+1); }
  if(cfg.mode==='fixed_price' && cfg.fixedPrice && cfg.fixedPrice.on) addRange(cfg.fixedPrice.fromDay??0, cfg.fixedPrice.toDay??0);
  if(cfg.mode==='tiers') (cfg.tiers||[]).forEach(t=>{ if(t.on) addRange(t.fromDay??0, t.toDay??0); });
  return [...days].filter(d=>d>=0).sort((a,b)=>a-b);
}
