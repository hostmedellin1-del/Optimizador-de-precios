/* Alertas. Extraido verbatim de index.html (Fase 1), con la firma cambiada a
   parametros explicitos en vez de `state`/`model` globales.

   BUG CONOCIDO (P3 de la auditoria, sin corregir todavia en esta Fase 1): la alerta
   PISO calcula `netAtBase = effBase*(1-lm)*(1-nat)*(1-comision)` — NO resta
   `bankFeePct`, NO aplica `offsetPct`, y no suma la tarifa de aseo. Puede dar falso
   negativo (neto real bajo costo, cero alerta). Se corrige en Fase 2 haciendo que
   esta funcion consuma `quoteScenario()` en vez de reimplementar la formula. Aqui
   solo se relocaliza el codigo tal cual estaba, para poder escribirle un test rojo.

   config = {discounts, channels, ceilings, marketWindow, marketBase, windows, chTab} */
import {pct, pct2} from './percent.js';
import {fP, f$} from './format.js';
import {combineChannel, worstNative, payoutFactor, cleanFeePerNight} from './engine.js';

export function buildAlerts(config, model){
  const {discounts, channels, ceilings, windows, chTab} = config;
  const A=[];
  const on = id=>{const d=discounts.find(x=>x.id===id);return d&&d.on&&pct(d.pct)>0;};
  /* ceiling breaches & floor breaches per window */
  windows.forEach(w=>{
    const ceil=pct(ceilings[w.id]);
    const mid=Math.min(w.lo+1,w.hi);
    let maxN=0,maxCh='';
    channels.forEach(c=>{const t=combineChannel(discounts,c.id,mid,1).totalPct;if(t>maxN){maxN=t;maxCh=c.name;}});
    if(maxN>ceil+0.5) A.push({lvl:'bad',tag:'TECHO',tab:'comparacion',msg:`${w.label}: solo los nativos de ${maxCh} ya suman ${fP(maxN)} y tu techo es ${fP(ceil)}. PriceLabs queda en 0% y aún así te pasas — baja el nativo o sube el techo.`});
    const lm = maxN>ceil?0:Math.max(0,100*(1-(1-ceil/100)/(1-maxN/100)));
    channels.forEach(c=>{
      const nat=combineChannel(discounts,c.id,mid,1).totalPct/100, cm=pct(c.comm)/100;
      const netAtBase = model.effBase*(1-lm/100)*(1-nat)*(1-cm);
      if(model.base>0 && netAtBase < model.cost-0.5)
        A.push({lvl:'bad',tag:'PISO',tab:'comparacion',msg:`${w.label} · ${c.name}: al precio de referencia (${f$(model.effBase, config.currency)}) con LM ${fP(lm)} + nativos ${fP(nat*100)} + comisión, netearías ${f$(netAtBase, config.currency)} < costo ${f$(model.cost, config.currency)}.`});
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
  const bkStack=combineChannel(discounts,'booking',1,1).totalPct;
  if(bkStack>=25) A.push({lvl:'warn',tag:'APILADO',tab:'ch-booking',msg:`Booking a 1 día vista: los nativos combinados suman ${fP(bkStack)} (Genius × Mobile × deal se multiplican). Verifica que ese total sea intencional.`});
  /* Descuentos por duración: no aparecen en la matriz (usa 1 noche). Se evalúan aquí. */
  channels.forEach(c=>{
    discounts.filter(d=>d.ch===c.id && d.kind==='los' && d.on && pct(d.pct)>0).forEach(d=>{
      const r = combineChannel(discounts, c.id, 45, d.minN||1);
      const netLos = (model.effBase*(1+pct2(c.offsetPct)/100)*(1-r.totalPct/100) + cleanFeePerNight(c, d.minN||1))*payoutFactor(c);
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
