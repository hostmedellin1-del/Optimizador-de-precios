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
*/
import {pct, pct2} from './percent.js';
import {fP} from './format.js';
import {criticalDays, criticalNights} from './thresholds.js';
import {reservationCostBreakdown} from './costs.js';

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

/* config = {fixedCost, varCost, margin, marketBase, channels, discounts, windows,
   costBreakdown?} — costBreakdown es OPCIONAL (Fase 3): si esta presente, el costo
   ya no es el flat fixedCost+varCost, es el costo REAL de la reserva mas exigente
   posible: una de 1 noche, que es cuando el costo "por turno" (limpieza/lavanderia/
   insumos, fijo por reserva) pega mas fuerte por noche — el Piso debe protegerse
   contra ESE caso, no contra el promedio de avgNights (ver src/domain/costs.js).
   Sin costBreakdown, cae al modelo simple de siempre (compatibilidad). */
export function compute(config){
  const {channels, discounts, windows} = config;
  const cost = config.costBreakdown
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
  let floor=0, floorCh='';
  channels.forEach(c=>{
    const wn = worstNative(discounts, c.id, windows)/100, pf = payoutFactor(c), off = pct2(c.offsetPct)/100;
    const denom = (1+off)*(1-wn)*pf;
    const p = denom>0 ? cost/denom : Infinity; /* offset ≤ −100% = imposible proteger */
    if(p>floor){floor=p;floorCh=c.name+' (nativo '+fP(wn*100)+' + comisión '+fP(pct(c.comm))+(pct(c.bankFeePct)>0?' + bancaria '+fP(pct(c.bankFeePct)):'')+(off!==0?' + offset '+fP(off*100):'')+')';}
  });
  /* base: pushed price that nets target on every channel using its CONSTANT natives (window natives are tactical) */
  let base=0, baseCh='';
  channels.forEach(c=>{
    /* Fase 2.1: factor EXACTO, no totalPct/100 (redondeado, ver worstNative arriba). */
    const cn = 1-combineChannel(discounts, c.id, 45, 1).factor; /* 45 días: fuera de ventanas tácticas cortas */
    const pf = payoutFactor(c);
    const p = net/((1-cn)*pf);
    if(p>base){base=p;baseCh=c.name;}
  });
  const mb=parseFloat(config.marketBase)||0;
  const effBase = mb>0 ? mb : base;   /* evaluar contra el precio que realmente vas a poner */
  return {cost, net, floor, floorCh, base, baseCh, effBase};
}

/* Offset % que necesita un canal para netear el objetivo, dado un Base uniforme (effBase),
   evaluado sobre la ESTADÍA PROMEDIO: así el nativo incluye descuentos por duración que la
   reserva típica sí califica, y el aseo (fijo por reserva) se diluye correctamente por noche.
   config = {chId, channels, discounts, avgNights, effBase, netObjetivo} */
export function suggestedOffset(config){
  const {chId, channels, discounts, effBase, netObjetivo} = config;
  const c = channels.find(x=>x.id===chId);
  if(!c || effBase<=0) return 0;
  const avgN = Math.max(1, parseFloat(config.avgNights)||1);
  /* Fase 2.1: factor EXACTO, no totalPct/100 (redondeado). */
  const nat = 1-combineChannel(discounts, chId, 45, avgN).factor; /* nativo a estadía promedio, sin ventanas tácticas cortas */
  const pf = payoutFactor(c);
  const feePN = cleanFeePerNight(c, avgN);
  const denom = effBase*(1-nat);
  if(denom<=0 || pf<=0) return 0;
  /* net = [effBase*(1+off)*(1-nat) + feePN]*pf = netObjetivo
     => off = (netObjetivo/pf - feePN)/(effBase*(1-nat)) - 1 */
  return ((netObjetivo/pf - feePN)/denom - 1)*100;
}
