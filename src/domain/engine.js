/* Motor de combinacion de descuentos y calculo financiero.
   Fase 1 de la auditoria tecnica (jul 2026): extraido verbatim de index.html, con UN
   solo tipo de cambio de firma (nunca de resultado): las funciones ya no leen `state`
   de un global implicito — reciben `discounts`/`channels`/config como parametros
   explicitos, para ser puras e importables desde tests.

   Fase 2 (jul 2026): worstNative() ya NO muestrea un unico punto medio por ventana
   — enumera exhaustivamente los puntos discretos donde combineChannel() puede
   cambiar (ver src/domain/thresholds.js). Es la UNICA correccion de comportamiento
   de esta Fase; combineChannel() en si (las reglas de negocio por canal) no se
   toca — eso sigue fuera de alcance hasta que confirmes cuentas reales (Fase 4).

   Fase 2.1 (jul 2026): purga de `totalPct` (redondeado a 1 decimal, solo para UI)
   de TODO calculo financiero. worstNative(), compute().base y suggestedOffset()
   ahora comparan/dividen sobre `factor` EXACTO. Caso real que esto corrige: Genius
   0.1% + Mobile 50% en Booking da 50.05% exacto, pero el redondeo de totalPct daba
   50.0% por ruido de punto flotante — un Piso dimensionado con ese 50.0% netea por
   debajo del costo real (ver tests/precision.test.js).

   Bug conocido que esta version TODAVIA tiene (fuera de alcance, no es un bug sino
   una eleccion de referencia — A21, hallazgo adicional, no critico):
   - compute().base evalua siempre a 45 dias / 1 noche como escenario de referencia
     "fuera de ventanas tacticas cortas" — es una decision de negocio documentada,
     no un error de muestreo; no se toca sin que Dani lo pida explicitamente.

   Bloqueante ALTO corregido (revision externa, ronda 2): compute().base SI
   incorpora ahora el Offset y el Last-Minute REALMENTE configurados de cada
   canal en ese mismo escenario de referencia (dia 45/1 noche) — antes los
   excluia por completo, asi que el texto "netea tu objetivo" solo era cierto
   si TODOS los offsets estaban en 0% y no habia LM, algo que dejaba de ser
   verdad en cuanto Dani configuraba un offset real (ej. Booking -15% para
   competir) o un LM verificado. Base sigue siendo un PUNTO DE REFERENCIA
   UNICO, no una busqueda exhaustiva de peor caso (esa sigue siendo tarea del
   Piso) — la diferencia es que ahora ese punto de referencia usa los valores
   REALES de offset/LM en vez de asumir cero. Ver tests/fase-base-property.test.js.
*/
import {pct, pct2} from './percent.js';
import {fP} from './format.js';
import {criticalDays, criticalNights} from './thresholds.js';
import {reservationCostBreakdown} from './costs.js';
import {validateCostInputs, validateChannelInputs, validateResultFinite, validateLmTiersOverlap} from './validate.js';
import {worstScenarioFactor} from './worstcase.js';
import {priceLabsLm, isLmBlocked} from './pricelabs-lm.js';
import {evaluateRecommendationReadiness, evaluateGlobalRecommendationReadiness} from './readiness.js';
import {evaluateUsdOnlyReadiness} from './usd-only.js';
import {evaluateCostReadiness} from './cost-mode.js';

export function windowApplies(d, daysOut){
  if(d.kind==='constant') return true;
  if(d.kind==='window') return daysOut>= (d.from??0) && daysOut<=(d.to??9999);
  return false; /* los handled separately */
}
export function losApplies(d, nights){ return d.kind==='los' && nights>=(d.minN||0); }

/* Returns {factor, totalPct, applied:[{name,pct,why}], ignored:[{name,reason}]} for one channel.
   `discounts` es el arreglo completo del catalogo (equivalente a state.discounts). */
export function combineChannel(discounts, chId, daysOut, nights){
  const ds = discounts.filter(d=>d.ch===chId && d.on && pct(d.pct)>0);
  const applied=[], ignored=[];
  let factor=1;
  const add=(d,why)=>{factor*=(1-pct(d.pct)/100); applied.push({name:d.name,pct:pct(d.pct),why});};

  if(chId==='airbnb'){
    /* Capa apilable (rule sets / ajuste estacional) se aplica primero y NO compite */
    ds.filter(d=>d.group==='stackable').forEach(d=>add(d,'rule set: apila sobre la promo ganadora'));
    /* Grupo promo: solo UNA aplica. 1º por prioridad de tipo (nuevo>personalizada>duración>early-bird>last-minute).
       2º, dentro del mismo tipo con varios escalones, gana el umbral MÁS PROFUNDO que se cumple
       (más noches para duración, más días de anticipación para early-bird) — no el % más alto. */
    const cands = ds.filter(d=> d.group==='promo' &&
      (d.kind==='constant' || windowApplies(d,daysOut) || losApplies(d,nights)));
    if(cands.length){
      const minPrio = Math.min(...cands.map(c=>c.prio??9));
      const top = cands.filter(c=>(c.prio??9)===minPrio);
      top.sort((a,b)=>{
        const av = a.kind==='los' ? (a.minN||0) : (a.from||0);
        const bv = b.kind==='los' ? (b.minN||0) : (b.from||0);
        return bv-av;
      });
      const win = top[0];
      const tieBreak = top.length>1 ? `, umbral más profundo dentro del mismo tipo (${win.kind==='los'?'≥'+win.minN+' noches':'≥'+win.from+' días'})` : '';
      add(win, `gana por prioridad Airbnb (nivel ${win.prio??'—'}: nuevo > personalizada > duración > early-bird > last-minute)${tieBreak}`);
      cands.filter(c=>c!==win).forEach(d=>ignored.push({name:d.name,reason: (d.prio??9)!==minPrio
        ? `Airbnb aplica solo una promo por noche; ganó ${win.name} por prioridad`
        : `mismo tipo que ${win.name}; ese umbral es más profundo y gana`}));
    }
    /* Fase 4 — descuento NO REEMBOLSABLE: capa apilable POST-promo, configurable
       por listing (ab_nonref, catalog). No compite dentro del grupo 'promo' (no es
       "otra promo más"): Airbnb lo aplica como un descuento aparte encima de
       cualquier promo que haya ganado arriba. Apagado y en 0% por defecto — Dani
       debe confirmar por listing si aplica y el % exacto (ver verification.js). */
    ds.filter(d=>d.group==='stackable-post').forEach(d=>add(d,'descuento no reembolsable del listing: se aplica DESPUÉS de la promo ganadora, no compite con ella'));
  }
  else if(chId==='booking'){
    const limited = ds.find(d=>d.group==='reactive-limited');
    const country = ds.find(d=>d.group==='proactive-country');
    const mobile = ds.find(d=>d.group==='proactive-mobile');
    const genius = ds.find(d=>d.group==='proactive');
    if(genius) add(genius,'Genius combina con todo (categoría propia)');
    if(country) add(country,'Country Rate activa');
    if(mobile){
      if(limited||country) ignored.push({name:mobile.name,reason:'Mobile no combina con '+(limited?'Limited-time':'Country Rate')});
      else add(mobile,'apila sobre Genius (categorías distintas)');
    }
    /* Descuento por duración de estadía: es tu tarifa (Rates & Availability → Discounts),
       no un "deal" que compite por categoría — se apila con Genius/Mobile/reactivos.
       Si varios umbrales califican a la vez, gana el más profundo (igual que Airbnb LOS). */
    const losCands = ds.filter(d=>d.group==='los' && losApplies(d,nights));
    if(losCands.length){
      losCands.sort((a,b)=>(b.minN||0)-(a.minN||0));
      const winLos=losCands[0];
      add(winLos,'tarifa por duración de estadía que configuraste — se apila con Genius/Mobile/deals');
      losCands.slice(1).forEach(d=>ignored.push({name:d.name,reason:'ya aplica un umbral de duración más profundo ('+winLos.name+')'}));
    }
    const reactives = ds.filter(d=>(d.group==='reactive'||d.group==='reactive-limited') && windowApplies(d,daysOut))
      .sort((a,b)=>pct(b.pct)-pct(a.pct));
    if(reactives.length){
      add(reactives[0],'único deal reactivo aplicado (misma categoría no combina)');
      reactives.slice(1).forEach(d=>ignored.push({name:d.name,reason:'solo un deal reactivo aplica; ganó '+reactives[0].name}));
    }
  }
  else if(chId==='expedia'){
    const bases = ds.filter(d=>d.group==='base' && (windowApplies(d,daysOut)||losApplies(d,nights))).sort((a,b)=>pct(b.pct)-pct(a.pct));
    if(bases.length){
      add(bases[0],'promo base mayor (Expedia no combina promos base)');
      bases.slice(1).forEach(d=>ignored.push({name:d.name,reason:'solo la promo base mayor aplica'}));
    }
    const mod = ds.find(d=>d.group==='mod');
    if(mod) add(mod,'Member Only apila sobre la promo base');
  }
  else { /* direct: stack all */
    ds.filter(d=>windowApplies(d,daysOut)||losApplies(d,nights)).forEach(d=>add(d,'canal directo: apila'));
  }
  /* redondeo a 1 decimal: (1-factor)*100 arrastra ruido de float (18.999… en vez de 19) */
  return {factor, totalPct: Math.round((1-factor)*1000)/10, applied, ignored};
}

/* Worst-case native per channel — FASE 2: enumeracion exhaustiva de dias y noches
   criticos (ver thresholds.js), no un muestreo por punto medio. `windows` se sigue
   aceptando por compatibilidad de firma y para incluir sus limites en la
   enumeracion (ver thresholds.js), aunque combineChannel() no dependa de WINDOWS
   directamente. `discounts` se pasa completo (no solo los del canal `chId`) por
   simplicidad: es un superconjunto seguro de puntos criticos — no puede hacer que
   se pierda un maximo real, solo evalua puntos de mas que son irrelevantes para
   ese canal. */
export function worstNative(discounts, chId, windows){
  /* Fase 2.1: la comparacion usa `factor` EXACTO (no `totalPct`, que viene redondeado
     a 1 decimal para presentacion). Ejemplo real que esto corrige: Genius 0.1% +
     Mobile 50% en Booking da factor=0.4995 (50.05% exacto), pero
     Math.round((1-0.4995)*1000)/10 da 50.0 por ruido de punto flotante (500.499999...
     redondea hacia abajo) — usar ese 50.0 para dimensionar el Piso lo deja corto
     (netea por debajo del costo). El valor devuelto tambien es el % EXACTO derivado
     del factor minimo, no un totalPct redondeado — worstNative() alimenta compute().floor
     y la alerta REALIDAD, ambos calculos financieros. */
  let worstFactor = 1;
  const days = criticalDays(discounts, windows);
  const nights = criticalNights(discounts);
  days.forEach(d=>{
    nights.forEach(n=>{
      const f = combineChannel(discounts, chId, d, n).factor;
      if(f<worstFactor) worstFactor=f;
    });
  });
  return (1-worstFactor)*100;
}

/* Factor de lo que realmente te queda: comisión OTA + comisión bancaria, AMBAS calculadas
   sobre el precio que paga el huésped (no se acumulan una sobre la otra, se restan las dos
   del mismo número — así es como se factura en la práctica, confirmado por Dani). */
export function payoutFactor(c){
  return Math.max(0, 1 - pct(c.comm)/100 - pct(c.bankFeePct)/100);
}

/* Tarifa de aseo fija por reserva (solo Airbnb), diluida por noche según la estadía dada.
   Devuelve 0 para canales sin aseo. Reusa la regla 1-2 noches / 3+ del catálogo. */
export function cleanFeePerNight(c, nights){
  if(c.id!=='airbnb') return 0;
  const n = Math.max(1, nights||1);
  const feeTotal = n<=2 ? (parseFloat(c.cleanFeeShort)||0) : (parseFloat(c.cleanFeeLong)||0);
  return feeTotal/n;
}

/* LM en el escenario de referencia (dia 45, "fuera de ventanas tacticas cortas")
   — Bloqueante ALTO corregido (revision externa, ronda 2): compute().base y
   suggestedOffset() reimplementaban la MISMA resolucion de LM a dia 45 cada
   uno por su cuenta (una formula financiera duplicada, lo que el encargo
   prohibe explicitamente). Se extrae aqui una unica vez. `nights` es la
   duracion que el CALLER esta usando en su propio escenario de referencia
   (Base usa 1 noche; suggestedOffset usa avgNights) — el "nativo compartido"
   del modo ceiling_auto debe evaluarse a esa MISMA duracion para no quedar
   inconsistente con el resto del calculo de ese caller. Si el LM en ese dia
   resulta ser un precio FIJO (modo fixed_price con dia 45 dentro de su rango,
   caso raro ya que esas ventanas suelen ser cercanas al check-in), no hay un
   "%" que aplicar sobre Base/Offset — se ignora (0), igual que ya hacia
   suggestedOffset() antes de esta extraccion.

   IMPORTANTE — sin `lmConfig`, cae al modo 'ceiling_auto' (igual que
   priceLabsLm()/quoteScenario(), ver pricelabs-lm.js: "Sin lmConfig, cae al
   modo automatico de siempre — cero regresion"), NUNCA a "sin LM". Esto es a
   proposito: la propiedad que este archivo debe garantizar es que
   `quoteScenario({days:45, nights, price:base}, config)` netee >= objetivo, y
   quoteScenario() SIEMPRE asume ceiling_auto cuando no hay lmConfig — si esta
   funcion asumiera 0% en ese mismo caso, Base quedaria corto exactamente en
   el escenario que se supone que garantiza. (compute().floor SI tiene una
   rama legacy aparte que ignora LM por completo sin lmConfig — es una
   compatibilidad explicita con callers de ANTES de que LM existiera como
   config; lmPctAtDay45() es codigo nuevo, no tiene ese contrato viejo que
   preservar.) En produccion `state.lmConfig` siempre esta presente
   (defaultLmConfig()), asi que esta rama solo importa para callers de test
   que omiten `windows` (ahi si se devuelve 0, no hay ventana de referencia
   que resolver) u omiten `lmConfig` a proposito.

   Bloqueante P1 (revision externa, ronda 3): esta funcion devolvia un numero
   plano y, si el modo era 'fixed_price' con el dia 45 dentro de su rango
   (priceOverride!=null), devolvia 0 EN SILENCIO — como si no hubiera LM. Eso
   hacia que compute().base y suggestedOffset() calcularan como si PriceLabs
   fuera a publicar el precio que ellos mismos resuelven, cuando en realidad
   PriceLabs publica el precio FIJO configurado, sin importar Base. Ahora
   devuelve `{lmPct, priceOverride}` explicito — el caller DEBE decidir que
   hacer con el override (Base: marcarse no aplicable; Offset: recalcular
   sobre el precio fijo real), nunca ignorarlo. */
export function lmPctAtDay45(lmConfig, {discounts, channels, windows, ceilings, nights}){
  if(!windows) return {lmPct:0, priceOverride:null};
  const cfg = lmConfig || {mode:'ceiling_auto'};
  const w45 = windows.find(win=>45>=win.lo && 45<=win.hi) || windows[windows.length-1];
  const ceil45 = pct((ceilings||{})[w45.id]);
  let sharedNative45 = 0;
  if(cfg.mode==='ceiling_auto'){
    channels.forEach(c2=>{
      const f2 = combineChannel(discounts, c2.id, 45, nights).factor;
      const p2 = (1-f2)*100;
      if(p2>sharedNative45) sharedNative45=p2;
    });
  }
  const lmResult = priceLabsLm(cfg, {day:45, ceilingPct:ceil45, nativePct:sharedNative45});
  return {lmPct: lmResult.priceOverride==null ? lmResult.lmPct : 0, priceOverride: lmResult.priceOverride};
}

/* config = {fixedCost, varCost, margin, marketBase, channels, discounts, windows,
   costBreakdown?} — costBreakdown es OPCIONAL (Fase 3): si esta presente, el costo
   ya no es el flat fixedCost+varCost, es el costo REAL de la reserva mas exigente
   posible: una de 1 noche, que es cuando el costo "por turno" (limpieza/lavanderia/
   insumos, fijo por reserva) pega mas fuerte por noche — el Piso debe protegerse
   contra ESE caso, no contra el promedio de avgNights (ver src/domain/costs.js).
   Sin costBreakdown, cae al modelo simple de siempre (compatibilidad). */
export function compute(config){
  const {channels, discounts, windows} = config;
  /* BLOQUEANTE 2 corregido (auditoria externa, ronda 4): un `costBreakdown`
     presente pero explicitamente NO confirmado (`config.costBreakdownConfirmed
     ===false`, lo que manda index.html en cuanto el usuario edita cualquier
     campo del desglose) NUNCA alimenta el costo real — cae al modelo simple
     (fixedCost/varCost), exactamente como si `costBreakdown` no existiera.
     `costBreakdownConfirmed` ausente/undefined (todos los callers de test
     existentes, que no participan de este contrato) preserva el
     comportamiento de siempre: costBreakdown se usa tal cual si esta
     presente. Ver src/domain/cost-mode.js. */
  const costGate = evaluateCostReadiness({
    costBreakdown: config.costBreakdown, costBreakdownConfirmed: config.costBreakdownConfirmed,
    usingExampleCosts: config.usingExampleCosts
  });
  const cost = costGate.useDetailed
    ? reservationCostBreakdown(config.costBreakdown, 1).perNight
    : (parseFloat(config.fixedCost)||0)+(parseFloat(config.varCost)||0);
  const m = Math.min(parseFloat(config.margin)||0,90);
  const net = cost/(1-m/100);
  /* floor: pushed price such that worst channel still nets >= cost.
     Incluye el offset del canal: en producción PriceLabs publica precio×(1+offset), así que
     el piso DEBE reflejarlo — si no, un offset negativo (bajar precio para competir) rompe
     la garantía de no vender bajo costo. Con offset positivo el piso baja para ese canal
     (el offset ya lo protege), pero el piso final es el máximo entre canales, así que solo
     baja de verdad si TODOS tienen offset positivo. */
  let floor=0, floorCh='', floorChId=null;
  const lmInfeasible = [];
  channels.forEach(c=>{
    const pf = payoutFactor(c), off = pct2(c.offsetPct)/100;
    if(config.lmConfig){
      /* CRITICO corregido (ver worstcase.js): el peor caso ahora incluye LM,
         no solo el descuento nativo OTA — un LM verificado que el Piso
         ignoraba podia netear por debajo del costo real aunque el modelo
         dijera valid:true. */
      const {worstFactor, worstDay, worstNight, infeasible} = worstScenarioFactor({
        chId: c.id, channels, discounts, windows, ceilings: config.ceilings, lmConfig: config.lmConfig, cost
      });
      lmInfeasible.push(...infeasible);
      const denom = worstFactor*pf;
      const p = denom>0 ? cost/denom : Infinity;
      if(p>floor){floor=p;floorChId=c.id;floorCh=c.name+' (peor escenario real: día '+worstDay+', '+worstNight+' noche'+(worstNight===1?'':'s')+', incluye LM'+(off!==0?' + offset '+fP(off*100):'')+')';}
    } else {
      /* Sin lmConfig (compatibilidad con callers que aun no lo pasan): formula
         de siempre, solo nativo OTA — no incluye LM. */
      const wn = worstNative(discounts, c.id, windows)/100;
      const denom = (1+off)*(1-wn)*pf;
      const p = denom>0 ? cost/denom : Infinity; /* offset ≤ −100% = imposible proteger */
      if(p>floor){floor=p;floorChId=c.id;floorCh=c.name+' (nativo '+fP(wn*100)+' + comisión '+fP(pct(c.comm))+(pct(c.bankFeePct)>0?' + bancaria '+fP(pct(c.bankFeePct)):'')+(off!==0?' + offset '+fP(off*100):'')+')';}
    }
  });
  /* base: pushed price that nets target on every channel using its CONSTANT natives
     (window natives are tactical), CON el offset y el LM que ese canal tenga
     REALMENTE configurados hoy (ver comentario arriba — Bloqueante ALTO ronda 2). */
  const day45Lm = lmPctAtDay45(config.lmConfig, {discounts, channels, windows, ceilings: config.ceilings, nights:1});
  let base=0, baseCh='', baseChId=null;
  channels.forEach(c=>{
    /* Fase 2.1: factor EXACTO, no totalPct/100 (redondeado, ver worstNative arriba). */
    const cn = 1-combineChannel(discounts, c.id, 45, 1).factor; /* 45 días: fuera de ventanas tácticas cortas */
    const pf = payoutFactor(c);
    const off = pct2(c.offsetPct)/100;
    /* Si hay un precio LM fijo activo en el dia 45 (day45Lm.priceOverride!=null),
       este `base` de respaldo se calcula IGNORANDO el override (lm45=0) — es
       intencional: sirve solo como ancla numerica de `effBase` para el resto de
       la app (Matriz/Alertas/Simulador evaluan sus propios dias y SI resuelven
       el override correctamente via quoteScenario). El KPI "Base Price" en si
       queda marcado `baseBlocked` mas abajo y la UI no debe mostrar este numero
       como recomendacion — ver bloqueante P1, ronda 3. */
    const lm45 = day45Lm.priceOverride!=null ? 0 : day45Lm.lmPct;
    const denom = (1+off)*(1-lm45/100)*(1-cn)*pf;
    const p = denom>0 ? net/denom : Infinity; /* offset <= -100% = imposible netear con un Base finito */
    if(p>base){base=p;baseChId=c.id;baseCh=c.name+(lm45!==0||off!==0?' (':'')+(lm45!==0?'LM '+fP(lm45):'')+(lm45!==0&&off!==0?' + ':'')+(off!==0?'offset '+fP(off*100):'')+(lm45!==0||off!==0?')':'');}
  });
  /* Bloqueante P1 (revision externa, ronda 3): un precio LM FIJO activo en el
     dia de referencia (45) hace que Base sea irrelevante para ese escenario —
     PriceLabs publica el precio fijo configurado sin importar que Base pongas.
     "netea tu objetivo" no puede afirmarse de un numero que no controla nada.
     Se calcula, por canal, el neto REAL con el precio fijo (offset aplicado
     DESPUES del precio fijo, mismo orden que quoteScenario) para explicar si
     ese precio fijo alcanza o no el objetivo — informativo, nunca una
     recomendacion inventada de Base. */
  let baseBlocked=false, baseBlockedReason=null;
  if(day45Lm.priceOverride!=null){
    let worstOverridePayout=Infinity, worstOverrideCh='';
    channels.forEach(c=>{
      const cn = 1-combineChannel(discounts, c.id, 45, 1).factor;
      const pf = payoutFactor(c);
      const off = pct2(c.offsetPct)/100;
      const feePN = cleanFeePerNight(c, 1);
      const guest = day45Lm.priceOverride*(1+off)*(1-cn);
      const payout = (guest+feePN)*pf;
      if(payout<worstOverridePayout){worstOverridePayout=payout; worstOverrideCh=c.name;}
    });
    baseBlocked = true;
    baseBlockedReason = `Last-Minute está en modo "Precio fijo" (${day45Lm.priceOverride}) y ese precio está ACTIVO en el día de referencia (45, el que usa Base) — PriceLabs publicaría ese precio fijo sin importar el Base que configures aquí. Base Price y el Offset sugerido no aplican como recomendación de "precio a publicar" en este rango de días (el Offset sí se recalcula sobre el precio fijo real, ver suggestedOffset()). Con ese precio fijo, el canal más ajustado (${worstOverrideCh}) netea ${worstOverridePayout.toFixed(2)}${worstOverridePayout<net ? ` — por debajo de tu objetivo (${net.toFixed(2)}); ningún Base puede arreglar esto, PriceLabs va a publicar ese precio tal cual` : `, que ya cubre tu objetivo (${net.toFixed(2)})`}.`;
  }
  const mb=parseFloat(config.marketBase)||0;
  const effBase = mb>0 ? mb : base;   /* evaluar contra el precio que realmente vas a poner */
  /* Fase 5: validar ANTES (inputs) y DESPUES (resultado) — el motor sigue
     calculando siempre (nunca lanza), pero deja explicito cuando un numero no
     se puede confiar, en vez de mostrar NaN/Infinity/negativo como si fuera una
     recomendacion valida. `valid` es false si hay al menos un error de nivel
     'error' (los 'warning' no bloquean, solo informan). */
  /* Un precio Last-Minute FIJO (lmConfig.mode='fixed_price') que ya neta bajo
     costo por si solo es un error BLOQUEANTE — ningun Piso lo arregla, porque
     PriceLabs va a publicar ese precio fijo sin importar el Min Price. */
  const errors = [
    ...validateCostInputs({fixedCost: config.fixedCost, varCost: config.varCost, margin: config.margin}),
    ...validateChannelInputs(channels),
    ...validateResultFinite({floor, base, net, cost}, ['floor','base','net','cost']),
    ...lmInfeasible.map(x=>({field:'lmConfig.fixedPrice', level:'error', msg:`Precio Last-Minute fijo (${x.overridePrice}) en día ${x.day} garantiza netear bajo costo (${x.payoutAtOverride.toFixed(2)} < ${cost}) sin importar el Min Price — PriceLabs publicaría ese precio tal cual. Sube el precio fijo o revisa el rango de días.`})),
    ...(config.lmConfig && config.lmConfig.mode==='tiers' ? validateLmTiersOverlap(config.lmConfig.tiers) : [])
  ];
  const valid = !errors.some(e=>e.level==='error');
  /* Bloqueante CRITICO (revision externa, ronda 2): quoteScenario() ya exponia
     lmBlocked por escenario, pero compute() seguia devolviendo valid:true y
     floor/base "usables" aunque el LM configurado (por defecto: automatico, sin
     verificar) fuera matematicamente no verificable. `valid` sigue significando
     "los inputs/el resultado numerico no estan rotos" (NaN/Infinity/negativo) —
     `lmBlocked` es un gate DISTINTO y ortogonal: "este resultado depende de un
     LM que Dani todavia no confirmo, no lo presentes como recomendacion".
     Se calcula SIEMPRE con isLmBlocked(config.lmConfig) — nunca condicionado a
     si config.lmConfig vino o no: `base` (ver lmPctAtDay45 arriba) usa el
     default ceiling_auto de priceLabsLm() incluso sin lmConfig explicito (para
     quedar consistente con quoteScenario(), que hace lo mismo), asi que ese
     caso SI depende de una proyeccion sin verificar y debe bloquearse igual
     que si Dani hubiera dejado el modo automatico puesto a proposito. Solo el
     floor tiene una rama legacy que de verdad ignora LM (arriba, "compatibilidad
     con callers que aun no lo pasan") — eso no cambia aqui. */
  const lmBlocked = isLmBlocked(config.lmConfig);
  const lmMode = (config.lmConfig && config.lmConfig.mode) || 'ceiling_auto';
  const lmBlockedReason = lmBlocked
    ? `Last-Minute está en modo "${lmMode==='ceiling_auto'?'Automático':lmMode}"${lmMode==='ceiling_auto'
        ? ' — PriceLabs decide la curva real, así que este número es siempre una PROYECCIÓN, nunca verificable matemáticamente sin el precio diario real de tu cuenta'
        : ' pero todavía no lo marcaste como verificado'}. Min Price, Base Price, Offset sugerido y el veredicto "Rentable" de la Matriz quedan bloqueados hasta que confirmes esto en Resumen → sección "Last-Minute de PriceLabs": elige el modo real que usa tu cuenta y marca la casilla "Confirmé este modo directamente en PriceLabs" (o, si el modo automático es el real, configúralo explícitamente como plano/gradual/precio fijo/tramos con los valores que sí puedes confirmar).`
    : null;
  /* Fase 5 (revision externa — "datos financieros verificados"):
     evaluateRecommendationReadiness() (src/domain/readiness.js) es la fuente
     UNICA que decide, por canal, si falta un dato financiero de NEGOCIO
     (comision bancaria real, si Hospy aisla el Offset por canal, mezcla VIP
     de Expedia, Genius+Mobile de Booking, no-reembolsable de Airbnb) para
     tratar Piso/Base como recomendacion confiable. Es ORTOGONAL a
     lmBlocked/baseBlocked (arriba): esos cubren Last-Minute; esto cubre
     datos de negocio que no tienen nada que ver con LM. Solo se activa si
     config.verification vino explicito — mismo patron ya establecido arriba
     para lmConfig/floor: callers de test que no pasan verification no ven un
     bloqueo nuevo que no pidieron. En produccion state.verification SIEMPRE
     esta presente (defaultVerification()), asi que este gate esta activo en
     la app real desde el primer render. */
  const readiness = config.verification
    ? evaluateRecommendationReadiness({channels, discounts, verification: config.verification})
    : null;
  /* Refactor de cierre (revision externa): `evaluateGlobalRecommendationReadiness()`
     (src/domain/readiness.js) es la UNICA fuente de verdad para "¿Min Price/
     Base Price GLOBALES son una recomendacion confiable?" — antes esta misma
     regla vivia duplicada (una version documentada-pero-sin-uso en readiness.js
     con tests propios, y otra inline aqui que recalculaba `unreadyChannels()` a
     mano), con riesgo real de desalinearse. `engine.js` NUNCA recalcula el
     filtro de canales pendientes ni arma los motivos por su cuenta: consume
     `floorReady`/`baseReady`/`floorReason`/`baseReason` tal cual. Nota
     importante del contrato (ver comentario de la funcion): `baseBlocked`
     (precio LM fijo en el dia 45) SOLO afecta a `baseReady`, nunca a
     `floorReady` — el Piso sigue protegiendo con el peor escenario real
     (LM incluido) aunque Base no aplique ese dia. */
  /* BLOQUEANTE 1 corregido (auditoria externa, ronda 4): antes este gate solo
     miraba `config.currencyNeedsReview` (un booleano ya resuelto por el
     caller a partir de `state.currency`) — un canal historico con
     `settlementCurrency` distinta de USD (dato de antes de la simplificacion
     a USD unico) pasaba completamente desapercibido aqui, aunque
     monthly-economics.js/audit.js SI lo detectaban. Ahora `evaluateUsdOnlyReadiness()`
     (src/domain/usd-only.js) es la UNICA fuente que decide esto — mira TANTO
     la moneda guardada de la unidad COMO la de cada canal, y es la MISMA
     funcion que usan reconciliation.js y monthly-economics.js: los tres no
     pueden desalinearse porque no reimplementan el chequeo por su cuenta.
     `config.currency` ausente (callers de test que no participan) nunca
     bloquea por si solo — regresion cero.

     BLOQUEANTE 3 (auditoria externa, ronda 5): `config.usdManualReviewPending`
     se reenvia tal cual a evaluateUsdOnlyReadiness() — ver el docblock de esa
     funcion en src/domain/usd-only.js para el hallazgo completo (copia USD de
     una unidad COP sin convertir ningun valor). Ausente/undefined (callers de
     test, unidades normales preexistentes) nunca bloquea por si solo.

     BLOQUEANTE ronda 6 ("bypass de copia COP→USD por importacion"):
     `config.usdManualReviewLog` TAMBIEN se reenvia tal cual — sin esto,
     un caller podia poner `usdManualReviewPending:false` a mano (ej. un
     JSON exportado y editado) y el gate confiaba ciegamente en ese booleano,
     aunque la bitacora siguiera mostrando una copia sin confirmar
     (`copy_created` sin `review_confirmed` despues). `evaluateUsdOnlyReadiness()`
     ya NUNCA confia en el booleano crudo — cruza ambos campos via
     `evaluateUsdManualReviewState()`, la MISMA funcion que usan
     normalizeUnit() (persistence.js) y el resto de los callers de este
     modulo, para que nadie pueda desalinearse reimplementando el cruce. */
  const usdGate = evaluateUsdOnlyReadiness({unitCurrency: config.currency, channels, usdManualReviewPending: config.usdManualReviewPending, usdManualReviewLog: config.usdManualReviewLog});
  const currencyBlocked = usdGate.blocked;
  const currencyBlockedReason = currencyBlocked
    ? `Esta unidad está marcada "requiere revisión manual" — ${usdGate.reason} Esta versión de la app solo admite USD (la multimoneda queda fuera de esta fase). Corrige el dato (moneda de la unidad o del canal), o elimínalo y créalo de nuevo directamente en USD, antes de usar cualquier recomendación.`
    : null;
  /* BLOQUEANTE 2 (ver arriba, `costGate`): mismo nivel que lmBlocked/
     currencyBlocked — bloquea Piso Y Base, nunca solo uno. */
  const costBlocked = costGate.blocked;
  const costBlockedReason = costGate.reason;
  const {floorReady, baseReady, floorReason, baseReason} = evaluateGlobalRecommendationReadiness({
    readiness, channels, lmBlocked, baseBlocked, currencyBlocked, costBlocked
  });
  const floorReadinessBlocked = !floorReady;
  const floorReadinessBlockedReason = floorReason;
  const baseReadinessBlocked = !baseReady;
  const baseReadinessBlockedReason = baseReason;
  return {
    cost, net, floor, floorCh, floorChId, base, baseCh, baseChId, effBase, errors, valid,
    lmBlocked, lmBlockedReason, baseBlocked, baseBlockedReason,
    currencyBlocked, currencyBlockedReason,
    costBlocked, costBlockedReason, costMode: costGate.mode,
    readiness, floorReadinessBlocked, floorReadinessBlockedReason, baseReadinessBlocked, baseReadinessBlockedReason
  };
}

/* Offset % que necesita un canal para netear el objetivo, dado un Base uniforme (effBase),
   evaluado sobre la ESTADÍA PROMEDIO: así el nativo incluye descuentos por duración que la
   reserva típica sí califica, y el aseo (fijo por reserva) se diluye correctamente por noche.
   Fase LM-fix: si config.lmConfig esta presente, el LM en ese MISMO dia de referencia
   (45) se incluye en la formula — antes se ignoraba por completo, asi que el offset
   sugerido no compensaba un LM real configurado en esa ventana.
   config = {chId, channels, discounts, avgNights, effBase, netObjetivo, lmConfig?, windows?, ceilings?} */
export function suggestedOffset(config){
  const {chId, channels, discounts, effBase, netObjetivo} = config;
  const c = channels.find(x=>x.id===chId);
  if(!c || effBase<=0) return 0;
  const avgN = Math.max(1, parseFloat(config.avgNights)||1);
  /* Fase 2.1: factor EXACTO, no totalPct/100 (redondeado). */
  const nat = 1-combineChannel(discounts, chId, 45, avgN).factor; /* nativo a estadía promedio, sin ventanas tácticas cortas */
  const pf = payoutFactor(c);
  const feePN = cleanFeePerNight(c, avgN);
  /* Bloqueante ALTO (revision externa, ronda 2): reusa lmPctAtDay45() — antes
     esta resolucion de LM a dia 45 estaba duplicada aqui Y en compute().base
     (formula financiera repetida, lo que el encargo prohibe). */
  const day45Lm = lmPctAtDay45(config.lmConfig, {discounts, channels, windows: config.windows, ceilings: config.ceilings, nights: avgN});
  /* Bloqueante P1 (revision externa, ronda 3): si hay un precio LM FIJO activo
     en el dia de referencia, el precio que de verdad publica PriceLabs ahi NO
     es `effBase*(1-lm/100)` (eso asumia, erroneamente, que no habia override)
     — es el precio fijo real. El Offset se sigue aplicando DESPUES de ese
     precio (mismo orden que quoteScenario: priceAfterOffset =
     priceAfterLm*(1+off)), asi que hay que resolver el offset SOBRE el precio
     fijo real para que "sugerido para netear el objetivo" siga siendo cierto. */
  const effPrice = day45Lm.priceOverride!=null ? day45Lm.priceOverride : effBase*(1-day45Lm.lmPct/100);
  const denom = effPrice*(1-nat);
  if(denom<=0 || pf<=0) return 0;
  /* net = [effPrice*(1+off)*(1-nat) + feePN]*pf = netObjetivo
     => off = (netObjetivo/pf - feePN)/(effPrice*(1-nat)) - 1 */
  return ((netObjetivo/pf - feePN)/denom - 1)*100;
}
