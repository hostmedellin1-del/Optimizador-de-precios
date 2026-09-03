/* Alertas.

   Fase 1: extraido verbatim de index.html, firma cambiada a parametros explicitos.
   Fase 2: el bloque TECHO/PISO por ventana ya NO reimplementa su propia formula —
   consume quoteScenario() (src/domain/quote.js), que SI incluye offset, comision
   bancaria y tarifa de aseo. Antes `netAtBase` solo restaba la comision OTA; podia
   dar falso negativo (neto real bajo costo, cero alerta) — caso confirmado:
   Booking 100/19%/18%/6%/costo 64 (neto real 61.56) no generaba alerta.

   Fase 2.1 (jul 2026): eliminado el punto medio `Math.min(w.lo+1,w.hi)` — una
   alerta que se presenta como "30+ dias" evaluaba SIEMPRE el dia 31, ignorando
   reglas activas desde el dia 60/90/lo que sea (ej. early-bird de 90 dias quedaba
   invisible dentro de su propia ventana). Ahora se enumeran TODOS los dias/noches
   criticos DENTRO de cada ventana (criticalDaysInWindow + criticalNights) y se usa
   el peor escenario real encontrado — el mensaje indica explicitamente el dia/noche
   exacto que determino la alerta. El bloque DURACIÓN tambien migro a quoteScenario()
   (antes reimplementaba offset+nativo+aseo+payoutFactor con totalPct redondeado).

   Fix (revision externa, jul 2026): la alerta REALIDAD tambien reimplementaba su
   propia formula (offset+nativo OTA+payoutFactor), omitiendo LM y tarifa de aseo
   por completo. Ahora usa worstScenarioFactor() (src/domain/worstcase.js, la misma
   enumeracion OTA+LM que protege el Piso) para encontrar el peor escenario real de
   cada canal, y quoteScenario() para cotizarlo. Ya NO queda ninguna formula
   financiera propia en este archivo — todo pasa por combineChannel()/
   worstScenarioFactor()/quoteScenario().

   config = {discounts, channels, ceilings, marketWindow, marketBase, windows, chTab,
   lmConfig?} */
import {pct} from './percent.js';
import {fP, f$, f$c} from './format.js';
import {combineChannel} from './engine.js';
import {quoteScenario} from './quote.js';
import {criticalDaysInWindow, criticalNights} from './thresholds.js';
import {lmCriticalDays, isLmBlocked} from './pricelabs-lm.js';
import {worstScenarioFactor} from './worstcase.js';

export function buildAlerts(rawConfig, model){
  /* Salvaguarda (sep 2026, descubierta al migrar PISO/DURACIÓN a `q.cost`):
     quoteScenario() deriva `q.cost` de los campos de costo del config
     (`fixedCost`/`varCost`/`costBreakdown`). index.html los pasa desde ago 2026,
     pero un caller que los omita obtendría `q.cost === 0` — y entonces TODA
     alerta de "vendes bajo costo" desaparecería en silencio, que es la peor
     falla posible en una herramienta de plata. Cuando el config no trae NINGÚN
     campo de costo, se completa con `model.cost`: sin desglose el costo es
     constante para cualquier duración, así que ese relleno no es una
     aproximación, es exactamente el mismo número que el modelo simple usa.
     Si el caller SÍ trae campos de costo, no se toca nada. */
  const hasCostInputs = 'fixedCost' in rawConfig || 'varCost' in rawConfig || !!rawConfig.costBreakdown;
  const config = hasCostInputs ? rawConfig : {...rawConfig, fixedCost: model.cost, varCost: 0};
  const {discounts, channels, ceilings, windows, chTab} = config;
  const A=[];
  const on = id=>{const d=discounts.find(x=>x.id===id);return d&&d.on&&pct(d.pct)>0;};
  /* TECHO/PISO por ventana: se enumeran TODOS los dias criticos de la ventana x
     TODAS las noches criticas x TODOS los canales — sin punto medio, sin promedio.
     TECHO es una politica compartida (un solo techo por ventana), asi que basta
     encontrar el (dia,noche,canal) que da el nativo mas profundo en toda la
     ventana. PISO es por canal (cada canal puede tener su propio peor dia/noche
     real dentro de la misma ventana), asi que se rastrea el peor caso POR canal.

     Fix sep 2026 — "el costo de 1 noche aplicado a cualquier duracion", misma
     raiz que el fix del VALOR del Piso en compute() (ver engine.js): la
     comparacion era `q.payout < model.cost`, con `model.cost` = costo de UNA
     noche, aunque `q` fuera un escenario de 27 o 34 noches, donde el costo real
     por noche de la 902 es ~42.6 y no 71.5. Resultado: 6 alertas PISO FALSAS en
     estadias largas con el backup real. Ahora se compara contra `q.cost` — el
     costo de ESE escenario, que quoteScenario() ya devuelve — igual que la
     alerta ESTADIA CORTA (mas abajo), que siempre lo hizo bien.

     Corolario del mismo fix: el peor caso por canal ya NO se elige por menor
     `payout` a secas, sino por menor MARGEN (`payout - cost`). Con el costo
     constante (modelo simple fixedCost+varCost) las dos reglas son identicas,
     asi que no hay regresion; con el desglose detallado activo NO lo son, y
     elegir por payout podia esconder un escenario corto que SI vende bajo costo
     detras de una estadia larga con payout menor pero margen positivo (falso
     NEGATIVO). El escenario reportado es entonces el de peor margen real. */
  const nightsGrid = criticalNights(discounts);
  /* Fase 4: si hay un LM configurable (flat/gradual/precio fijo/tramos), sus
     bordes de dia tambien son puntos donde el peor caso puede vivir — no solo
     los bordes de descuentos nativos OTA. */
  const lmDays = lmCriticalDays(config.lmConfig);
  windows.forEach(w=>{
    const daysGrid = [...new Set([...criticalDaysInWindow(discounts, w), ...lmDays.filter(d=>d>=w.lo&&d<=w.hi)])].sort((a,b)=>a-b);
    let worstTecho = null;
    const worstPisoByCh = new Map(channels.map(c=>[c.id, null]));
    daysGrid.forEach(d=>{
      nightsGrid.forEach(n=>{
        channels.forEach(c=>{
          const q = quoteScenario({chId:c.id, days:d, nights:n, price:model.effBase}, config, {excludeLmOnLongStay:true});
          if(!worstTecho || q.maxNAtScenario>worstTecho.q.maxNAtScenario) worstTecho={q,d,n};
          const cur = worstPisoByCh.get(c.id);
          if(!cur || (q.payout-q.cost)<(cur.q.payout-cur.q.cost)) worstPisoByCh.set(c.id, {q,d,n});
        });
      });
    });
    if(worstTecho && worstTecho.q.breach){
      const {q,d,n} = worstTecho;
      A.push({lvl:'bad',tag:'TECHO',tab:'comparacion',msg:`${w.label} (día ${d}, ${n} noche${n===1?'':'s'}): solo los nativos de ${q.ch.name} ya suman ${fP(q.maxNAtScenario)} y tu techo es ${fP(q.ceil)}. PriceLabs queda en 0% y aún así te pasas — baja el nativo o sube el techo.`});
    }
    worstPisoByCh.forEach(entry=>{
      if(!entry) return;
      const {q,d,n} = entry;
      /* Fix sep 2026 (Piso vs Min Price): quoteScenario() ya topa el precio contra
         `config.minPrice`, así que `q.payout` es el neto REAL que PriceLabs puede
         producir. Cuando ese tope actuó hay que decirlo — si no, el mensaje culpa
         a un LM que no llegó a aplicarse sobre el precio publicado. */
      const capNote = q.minPriceApplied ? ` (el Min Price de ${f$(q.minPrice, config.currency)} ya topó el precio, así que ese LM no se aplica al publicado)` : '';
      /* `q.cost`, NO `model.cost` — ver el comentario de arriba: el costo por
         noche de una reserva de 27 noches no es el de una de 1 noche. */
      if(model.base>0 && q.payout < q.cost-0.5)
        A.push({lvl:'bad',tag:'PISO',tab:'comparacion',msg:`${w.label} (día ${d}, ${n} noche${n===1?'':'s'}) · ${q.ch.name}: al precio de referencia (${f$(model.effBase, config.currency)}) con LM ${fP(q.lm)}${capNote} + nativos ${fP(q.nativoPct)} + comisión + bancaria + aseo, netearías ${f$c(q.payout, config.currency)} < el costo real de esa reserva de ${n} noche${n===1?'':'s'} (${f$c(q.cost, config.currency)} por noche).`});
    });
  });
  /* config contradictions */
  const ebActive = discounts.filter(d=>d.ch==='airbnb'&&d.kind==='window'&&d.on&&pct(d.pct)>0&&(d.from??0)>=14);
  ebActive.forEach(eb=>{
    if((eb.from??30)>(parseFloat(config.marketWindow)||16))
      A.push({lvl:'warn',tag:'CONFIG',tab:'ch-airbnb',msg:`${eb.name} arranca a ${eb.from} días pero tu mercado reserva a ~${config.marketWindow} días (mediana). Casi nunca se activa, y cuando lo hace regala margen en las pocas reservas anticipadas. Evalúa apagarlo o subir el umbral.`});
  });
  if(on('bk_mob')&&(on('bk_cty')||on('bk_ltd')))
    A.push({lvl:'warn',tag:'CONFLICTO',tab:'ch-booking',msg:'Booking: Mobile Rate no combina con Country Rate / Limited-time. El motor ya ignora Mobile en ese caso, pero tenlos claros en la extranet.'});
  const lmActive = discounts.filter(d=>d.ch==='airbnb' && d.id.startsWith('ab_lm') && d.on && pct(d.pct)>0);
  const abEbOverlap = ebActive.find(eb=>lmActive.some(lm=>(lm.to??3)>=(eb.from??30)));
  if(abEbOverlap)
    A.push({lvl:'warn',tag:'CONFIG',tab:'ch-airbnb',msg:`Airbnb: alguna ventana de Last-minute activa se solapa con ${abEbOverlap.name}. Airbnb solo aplicará una (gana duración/early-bird sobre last-minute si ambas califican), pero revisa los umbrales.`});
  const losOn = discounts.filter(d=>d.ch==='airbnb'&&d.kind==='los'&&d.on&&pct(d.pct)>0);
  if(losOn.length>1){
    const sorted=[...losOn].sort((a,b)=>a.minN-b.minN);
    for(let i=0;i<sorted.length-1;i++) if(pct(sorted[i].pct)>pct(sorted[i+1].pct))
      A.push({lvl:'warn',tag:'CONFIG',tab:'ch-airbnb',msg:`Airbnb: ${sorted[i].name} (${fP(pct(sorted[i].pct))}) da más descuento que ${sorted[i+1].name} (${fP(pct(sorted[i+1].pct))}) pese a exigir menos noches. Al huésped que califica para ambas gana el umbral más profundo (${sorted[i+1].name}), así que el de menos noches nunca se aplica realmente — revisa la escala.`});
  }
  const ebOn = ebActive;
  if(ebOn.length>1){
    const sorted=[...ebOn].sort((a,b)=>a.from-b.from);
    for(let i=0;i<sorted.length-1;i++) if(pct(sorted[i].pct)>pct(sorted[i+1].pct))
      A.push({lvl:'warn',tag:'CONFIG',tab:'ch-airbnb',msg:`Airbnb: ${sorted[i].name} (${fP(pct(sorted[i].pct))}) da más que ${sorted[i+1].name} (${fP(pct(sorted[i+1].pct))}) pese a activarse antes. Gana el umbral más profundo (${sorted[i+1].name}) cuando ambos aplican — revisa la escala para que suba con la anticipación.`});
  }
  const bkStack=(1-combineChannel(discounts,'booking',1,1).factor)*100; // exacto, no totalPct redondeado
  if(bkStack>=25) A.push({lvl:'warn',tag:'APILADO',tab:'ch-booking',msg:`Booking a 1 día vista: los nativos combinados suman ${fP(bkStack)} (Genius × Mobile × deal se multiplican). Verifica que ese total sea intencional.`});
  /* Descuentos por duración: no aparecen en la matriz (usa 1 noche). Se evalúan aquí,
     vía quoteScenario() — ya no reimplementa offset+nativo+aseo+payoutFactor aparte
     (esa formula paralela usaba totalPct redondeado y no incluia el techo/LM).

     Fix sep 2026 (misma raiz que el bloque PISO de arriba): el "bajo costo" se
     comparaba contra `model.cost` — el costo de UNA noche — en una alerta que
     por definicion evalua estadias LARGAS (`kind:'los'`, minN noches). Con la
     902 eso marcaba en rojo "Larga estadía (≥28 noches) netea 65 < costo 72"
     cuando el costo real de una reserva de 28 noches es ~42.6 por noche. Ahora
     se usa `q.cost`, el costo de ESA reserva.
     Lo que NO cambia: la comparacion contra el OBJETIVO sigue siendo
     `model.net` (el neto objetivo global de la unidad), igual que en la alerta
     ESTADIA CORTA. El objetivo es una politica del negocio, no una propiedad
     del escenario — reescalarlo por duracion seria una decision de negocio
     distinta, no este fix. */
  channels.forEach(c=>{
    discounts.filter(d=>d.ch===c.id && d.kind==='los' && d.on && pct(d.pct)>0).forEach(d=>{
      const q = quoteScenario({chId:c.id, days:45, nights:d.minN||1, price:model.effBase}, config);
      const netLos = q.payout;
      if(netLos < q.cost-0.5)
        A.push({lvl:'bad',tag:'DURACIÓN',tab:chTab[c.id],msg:`${c.name} · ${d.name}: una reserva de ${d.minN}+ noches netea ${f$c(netLos, config.currency)} por noche, bajo el costo real de esa reserva (${f$c(q.cost, config.currency)} por noche). Este descuento no aparece en el panel por ventana (ese usa 1 noche), pero sí te puede vender bajo costo.`});
      else if(netLos < model.net)
        A.push({lvl:'warn',tag:'DURACIÓN',tab:chTab[c.id],msg:`${c.name} · ${d.name}: una reserva de ${d.minN}+ noches netea ${f$(netLos, config.currency)}/noche — cubre costo pero queda bajo tu objetivo de ${f$(model.net, config.currency)}. Válido si priorizas ocupación larga; revísalo si no.`});
    });
  });
  /* Fase 3 de usabilidad (ago 2026) — alerta ESTADÍA CORTA. Caso real que la
     motivó: una reserva de 1 noche dejó un neto de USD 67 contra un costo
     real de USD 71.50 PARA ESA NOCHE (el aseo, la lavandería y los insumos
     se pagan enteros aunque sea una sola noche) — ese dato nunca estuvo en
     pantalla. El bloque DURACIÓN de arriba solo evalúa el caso opuesto
     (estadías LARGAS, descuentos `kind:'los'` activos); acá se cubre el
     caso donde Dani de verdad perdió plata.

     Se cotiza 1 y 2 noches (día 45, price:model.effBase — mismo punto de
     referencia que el bloque de al lado) y se compara el neto contra
     `q.cost` — el costo de ESE escenario concreto que quoteScenario() ya
     devuelve — nunca contra `model.cost` (que es el costo "genérico", no el
     de una reserva de 1/2 noches en particular; el punto de esta alerta es
     justamente que el costo por noche CAMBIA con la duración). */
  channels.forEach(c=>{
    const q1 = quoteScenario({chId:c.id, days:45, nights:1, price:model.effBase}, config);
    let oneNightBad = false;
    if(q1.payout < q1.cost-0.5){
      A.push({lvl:'bad', tag:'ESTADÍA CORTA', tab:chTab[c.id], msg:`${c.name}: una reserva de 1 noche netea ${f$c(q1.payout, config.currency)}, pero el costo real de esa noche es ${f$c(q1.cost, config.currency)} — el aseo, la lavandería y los insumos se pagan completos aunque el huésped se quede una sola noche. Estás perdiendo plata en reservas cortas de este canal.`});
      oneNightBad = true;
    } else if(q1.payout < model.net){
      A.push({lvl:'warn', tag:'ESTADÍA CORTA', tab:chTab[c.id], msg:`${c.name}: una reserva de 1 noche netea ${f$c(q1.payout, config.currency)} — cubre el costo de esa noche (${f$c(q1.cost, config.currency)}) pero queda bajo tu objetivo de ${f$(model.net, config.currency)}.`});
    }
    /* Si 1 noche ya dio "bad", no se agrega también la de 2 noches para el
       mismo canal — se reporta solo el peor caso, para no llenar la
       pantalla de avisos repetidos. */
    if(oneNightBad) return;
    const q2 = quoteScenario({chId:c.id, days:45, nights:2, price:model.effBase}, config);
    if(q2.payout < q2.cost-0.5){
      A.push({lvl:'bad', tag:'ESTADÍA CORTA', tab:chTab[c.id], msg:`${c.name}: una reserva de 2 noches netea ${f$c(q2.payout, config.currency)}, pero el costo real de esas 2 noches es ${f$c(q2.cost, config.currency)} — el aseo, la lavandería y los insumos se pagan completos sin importar que sean pocas noches. Estás perdiendo plata en reservas cortas de este canal.`});
    } else if(q2.payout < model.net){
      A.push({lvl:'warn', tag:'ESTADÍA CORTA', tab:chTab[c.id], msg:`${c.name}: una reserva de 2 noches netea ${f$c(q2.payout, config.currency)} — cubre el costo de esas 2 noches (${f$c(q2.cost, config.currency)}) pero queda bajo tu objetivo de ${f$(model.net, config.currency)}.`});
    }
  });
  if(model.floor>model.base&&model.base>0)
    A.push({lvl:'bad',tag:'MODELO',tab:'resumen',msg:`Tu piso (${f$(model.floor, config.currency)}) quedó por ENCIMA del Base (${f$(model.base, config.currency)}): con estos descuentos y margen, el modelo no cierra. Baja descuentos, baja margen objetivo o revisa costos.`});
  /* Chequeo de realidad contra el mercado */
  const mb=parseFloat(config.marketBase)||0;
  if(mb>0){
    if(model.floor>mb)
      A.push({lvl:'bad',tag:'INVIABLE',tab:'resumen',msg:`Tu piso (${f$(model.floor, config.currency)}) está POR ENCIMA de la base de mercado (${f$(mb, config.currency)}). A precio de mercado y con estos descuentos, esta unidad no cubre costo. No es un problema de pricing: es costos, descuentos o producto.`});
    else if(model.base>mb*1.05){
      /* Bloqueante MEDIO corregido (revision externa): esta alerta reimplementaba
         su propia formula (offset+nativo OTA+payoutFactor) — omitia el LM
         configurado y la tarifa de aseo, a diferencia de todo lo demas
         (Piso/Matriz/Simulador), que ya pasan por quoteScenario(). Ahora usa
         worstScenarioFactor() (la misma enumeracion OTA+LM que protege el Piso)
         para encontrar el peor escenario real de cada canal, y quoteScenario()
         para cotizarlo — cero formula financiera propia. */
      /* Fix sep 2026 (misma raiz que PISO/DURACION/Matriz): el margen alcanzable
         es `1 - costo/neto` con el costo de ESE escenario (`q.cost`), no con
         `model.cost` (el de 1 noche) — el escenario que devuelve
         worstScenarioFactor() puede ser una estadia larga, donde el costo por
         noche es mucho menor. Y el canal peor parado se elige por ese MARGEN,
         no por el menor neto: con costo constante son la misma eleccion, con
         desglose detallado no. */
      let peorMargen=Infinity, peorCh='';
      channels.forEach(c=>{
        const {worstDay, worstNight} = worstScenarioFactor({chId:c.id, channels, discounts, windows, ceilings: config.ceilings, lmConfig: config.lmConfig, cost: model.costForNight});
        const q = quoteScenario({chId:c.id, days:worstDay, nights:worstNight, price:mb}, config);
        const margen = q.payout>0 ? 100*(1-q.cost/q.payout) : -Infinity;
        if(margen<peorMargen){peorMargen=margen;peorCh=c.name;}
      });
      const achievable = isFinite(peorMargen) ? peorMargen : 0;
      A.push({lvl:'warn',tag:'REALIDAD',tab:'resumen',msg:`El Base que exige tu margen de ${fP(pct(config.margin))} es ${f$(model.base, config.currency)}, pero el mercado paga ~${f$(mb, config.currency)}. Ese margen no es alcanzable a precio de mercado. Margen realmente alcanzable en el peor caso real (${peorCh}, incluye LM y aseo): ~${fP(Math.max(0,achievable))}. Ajusta la expectativa o reduce descuentos/costos.`});
    }
  }
  /* Bloqueante CRITICO (revision externa, ronda 2): "sin conflictos" es, en
     espiritu, el mismo tipo de afirmacion confiada que "RENTABLE EN TODOS" en
     la matriz — si no salio ninguna alerta arriba pero el LM configurado no es
     verificable, ese "sin problemas" tambien depende de una proyeccion sin
     confirmar. No se agrega como advertencia sobre el mismo tag 'ok' (mismo
     error que se corrigio en la matriz): se reemplaza el tag/nivel entero. */
  if(!A.length){
    if(isLmBlocked(config.lmConfig)){
      A.push({lvl:'warn',tag:'LM SIN VERIFICAR',tab:'resumen',msg:'No se detectó ningún conflicto, pero este chequeo depende de Last-Minute que todavía no está verificado (modo automático, proyección no verificable matemáticamente, o un modo configurado sin marcar como confirmado) — confírmalo en Resumen → "Last-Minute de PriceLabs" antes de tratar esto como "sin problemas".'});
    } else if(model.costBlocked){
      /* BLOQUEANTE 2 (auditoria externa, ronda 4): mismo espiritu que LM sin
         verificar — "sin conflictos" tambien depende de que el costo contra
         el que se compara (model.cost) sea un dato real confirmado, no el
         ejemplo de fabrica ni un desglose detallado sin confirmar. */
      A.push({lvl:'warn',tag:'COSTOS SIN CONFIRMAR',tab:'resumen',msg:`No se detectó ningún conflicto, pero este chequeo depende de un costo (${f$(model.cost, config.currency)}) que todavía no está confirmado como un dato real de esta unidad — confírmalo en Resumen → "Costos por noche" antes de tratar esto como "sin problemas".`});
    } else {
      A.push({lvl:'ok',tag:'OK',msg:'Sin conflictos: techos respetados, piso cubierto en todas las ventanas y sin combinaciones contradictorias.'});
    }
  }
  return A;
}
