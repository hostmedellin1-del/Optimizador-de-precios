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

   config = {discounts, channels, ceilings, marketWindow, marketBase, windows, chTab} */
import {pct, pct2} from './percent.js';
import {fP, f$} from './format.js';
import {combineChannel, worstNative, payoutFactor, cleanFeePerNight} from './engine.js';
import {quoteScenario} from './quote.js';
import {criticalDaysInWindow, criticalNights} from './thresholds.js';

export function buildAlerts(config, model){
  const {discounts, channels, ceilings, windows, chTab} = config;
  const A=[];
  const on = id=>{const d=discounts.find(x=>x.id===id);return d&&d.on&&pct(d.pct)>0;};
  /* TECHO/PISO por ventana: se enumeran TODOS los dias criticos de la ventana x
     TODAS las noches criticas x TODOS los canales — sin punto medio, sin promedio.
     TECHO es una politica compartida (un solo techo por ventana), asi que basta
     encontrar el (dia,noche,canal) que da el nativo mas profundo en toda la
     ventana. PISO es por canal (cada canal puede tener su propio peor dia/noche
     real dentro de la misma ventana), asi que se rastrea el peor payout POR canal. */
  const nightsGrid = criticalNights(discounts);
  windows.forEach(w=>{
    const daysGrid = criticalDaysInWindow(discounts, w);
    let worstTecho = null;
    const worstPisoByCh = new Map(channels.map(c=>[c.id, null]));
    daysGrid.forEach(d=>{
      nightsGrid.forEach(n=>{
        channels.forEach(c=>{
          const q = quoteScenario({chId:c.id, days:d, nights:n, price:model.effBase}, config);
          if(!worstTecho || q.maxNAtScenario>worstTecho.q.maxNAtScenario) worstTecho={q,d,n};
          const cur = worstPisoByCh.get(c.id);
          if(!cur || q.payout<cur.q.payout) worstPisoByCh.set(c.id, {q,d,n});
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
      if(model.base>0 && q.payout < model.cost-0.5)
        A.push({lvl:'bad',tag:'PISO',tab:'comparacion',msg:`${w.label} (día ${d}, ${n} noche${n===1?'':'s'}) · ${q.ch.name}: al precio de referencia (${f$(model.effBase, config.currency)}) con LM ${fP(q.lm)} + nativos ${fP(q.nativoPct)} + comisión + bancaria + aseo, netearías ${f$(q.payout, config.currency)} < costo ${f$(model.cost, config.currency)}.`});
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
     (esa formula paralela usaba totalPct redondeado y no incluia el techo/LM). */
  channels.forEach(c=>{
    discounts.filter(d=>d.ch===c.id && d.kind==='los' && d.on && pct(d.pct)>0).forEach(d=>{
      const q = quoteScenario({chId:c.id, days:45, nights:d.minN||1, price:model.effBase}, config);
      const netLos = q.payout;
      if(netLos < model.cost-0.5)
        A.push({lvl:'bad',tag:'DURACIÓN',tab:chTab[c.id],msg:`${c.name} · ${d.name}: una reserva de ${d.minN}+ noches netea ${f$(netLos, config.currency)} por noche, bajo tu costo de ${f$(model.cost, config.currency)}. Este descuento no aparece en el panel por ventana (ese usa 1 noche), pero sí te puede vender bajo costo.`});
      else if(netLos < model.net)
        A.push({lvl:'warn',tag:'DURACIÓN',tab:chTab[c.id],msg:`${c.name} · ${d.name}: una reserva de ${d.minN}+ noches netea ${f$(netLos, config.currency)}/noche — cubre costo pero queda bajo tu objetivo de ${f$(model.net, config.currency)}. Válido si priorizas ocupación larga; revísalo si no.`});
    });
  });
  if(model.floor>model.base&&model.base>0)
    A.push({lvl:'bad',tag:'MODELO',tab:'resumen',msg:`Tu piso (${f$(model.floor, config.currency)}) quedó por ENCIMA del Base (${f$(model.base, config.currency)}): con estos descuentos y margen, el modelo no cierra. Baja descuentos, baja margen objetivo o revisa costos.`});
  /* Chequeo de realidad contra el mercado */
  const mb=parseFloat(config.marketBase)||0;
  if(mb>0){
    if(model.floor>mb)
      A.push({lvl:'bad',tag:'INVIABLE',tab:'resumen',msg:`Tu piso (${f$(model.floor, config.currency)}) está POR ENCIMA de la base de mercado (${f$(mb, config.currency)}). A precio de mercado y con estos descuentos, esta unidad no cubre costo. No es un problema de pricing: es costos, descuentos o producto.`});
    else if(model.base>mb*1.05){
      /* margen alcanzable al precio de mercado, en el canal que peor te deja */
      let peorNeto=Infinity, peorCh='';
      channels.forEach(c=>{
        const n = mb*(1+pct2(c.offsetPct)/100)*(1-worstNative(discounts, c.id, windows)/100)*payoutFactor(c);
        if(n<peorNeto){peorNeto=n;peorCh=c.name;}
      });
      const achievable = peorNeto>0 ? 100*(1-model.cost/peorNeto) : 0;
      A.push({lvl:'warn',tag:'REALIDAD',tab:'resumen',msg:`El Base que exige tu margen de ${fP(pct(config.margin))} es ${f$(model.base, config.currency)}, pero el mercado paga ~${f$(mb, config.currency)}. Ese margen no es alcanzable a precio de mercado. Margen realmente alcanzable en el peor caso (${peorCh}): ~${fP(Math.max(0,achievable))}. Ajusta la expectativa o reduce descuentos/costos.`});
    }
  }
  if(!A.length) A.push({lvl:'ok',tag:'OK',msg:'Sin conflictos: techos respetados, piso cubierto en todas las ventanas y sin combinaciones contradictorias.'});
  return A;
}
