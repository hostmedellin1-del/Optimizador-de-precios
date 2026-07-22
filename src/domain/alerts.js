/* Alertas.

   Fase 1: extraido verbatim de index.html, firma cambiada a parametros explicitos.
   Fase 2: el bloque TECHO/PISO por ventana ya NO reimplementa su propia formula —
   consume quoteScenario() (src/domain/quote.js), que SI incluye offset, comision
   bancaria y tarifa de aseo. Antes `netAtBase` solo restaba la comision OTA; podia
   dar falso negativo (neto real bajo costo, cero alerta) — caso confirmado:
   Booking 100/19%/18%/6%/costo 64 (neto real 61.56) no generaba alerta.

   PENDIENTE (fuera de alcance de esta fase, documentado para no ocultarlo): el
   bloque de alertas DURACIÓN (mas abajo) TODAVIA reimplementa una formula propia
   (offset+nativo+aseo+payoutFactor) en vez de usar quoteScenario — no se toco en
   esta pasada para mantener acotado el cambio a lo pedido (worstNative + formula
   unica de PISO/Simulador); es la siguiente duplicacion a eliminar.

   config = {discounts, channels, ceilings, marketWindow, marketBase, windows, chTab} */
import {pct, pct2} from './percent.js';
import {fP, f$} from './format.js';
import {combineChannel, worstNative, payoutFactor, cleanFeePerNight} from './engine.js';
import {quoteScenario} from './quote.js';

export function buildAlerts(config, model){
  const {discounts, channels, ceilings, windows, chTab} = config;
  const A=[];
  const on = id=>{const d=discounts.find(x=>x.id===id);return d&&d.on&&pct(d.pct)>0;};
  /* ceiling breaches & floor breaches per window — misma granularidad de siempre
     (un dia representativo `mid` por ventana, ya que el techo ES una politica por
     ventana), pero cotizado con quoteScenario() en vez de una formula aparte. */
  windows.forEach(w=>{
    const mid=Math.min(w.lo+1,w.hi);
    const quotes = channels.map(c=>quoteScenario({chId:c.id, days:mid, nights:1, price:model.effBase}, config));
    const worst = quotes.reduce((a,b)=>b.maxNAtScenario>a.maxNAtScenario?b:a, quotes[0]);
    if(worst && worst.breach) A.push({lvl:'bad',tag:'TECHO',tab:'comparacion',msg:`${w.label}: solo los nativos de ${worst.ch.name} ya suman ${fP(worst.maxNAtScenario)} y tu techo es ${fP(worst.ceil)}. PriceLabs queda en 0% y aún así te pasas — baja el nativo o sube el techo.`});
    quotes.forEach(q=>{
      if(model.base>0 && q.payout < model.cost-0.5)
        A.push({lvl:'bad',tag:'PISO',tab:'comparacion',msg:`${w.label} · ${q.ch.name}: al precio de referencia (${f$(model.effBase, config.currency)}) con LM ${fP(q.lm)} + nativos ${fP(q.nativoPct)} + comisión + bancaria + aseo, netearías ${f$(q.payout, config.currency)} < costo ${f$(model.cost, config.currency)}.`});
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
