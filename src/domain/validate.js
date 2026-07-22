/* Fase 5 — validacion de valores invalidos + bloqueo de resultados financieros
   que no se pueden confiar. Filosofia: el motor (engine.js/quote.js) sigue
   calculando SIEMPRE (nunca lanza), pero ahora tambien devuelve una lista de
   `errors` — quien consume el resultado (index.html) debe mostrar un bloqueo
   claro en vez de renderizar un numero (NaN/Infinity/negativo) que parece
   confiable pero no lo es. Nunca oculta el problema convirtiendolo en 0
   silenciosamente. */

export function isBadNumber(n){
  return typeof n!=='number' || !Number.isFinite(n);
}

/* config = {fixedCost, varCost, margin, channels} — valida ANTES de calcular,
   para poder explicar la causa concreta si el resultado sale invalido. */
export function validateCostInputs({fixedCost, varCost, margin}={}){
  const errors=[];
  const fc=parseFloat(fixedCost), vc=parseFloat(varCost), m=parseFloat(margin);
  if(fixedCost!==undefined && fixedCost!=='' && Number.isNaN(fc)) errors.push({field:'fixedCost', level:'error', msg:'Costo fijo no es un numero valido.'});
  else if(fc<0) errors.push({field:'fixedCost', level:'error', msg:'Costo fijo no puede ser negativo.'});
  if(varCost!==undefined && varCost!=='' && Number.isNaN(vc)) errors.push({field:'varCost', level:'error', msg:'Costo variable no es un numero valido.'});
  else if(vc<0) errors.push({field:'varCost', level:'error', msg:'Costo variable no puede ser negativo.'});
  if(margin!==undefined && margin!=='' && Number.isNaN(m)) errors.push({field:'margin', level:'error', msg:'Margen objetivo no es un numero valido.'});
  else if(m>=100) errors.push({field:'margin', level:'error', msg:'Margen objetivo debe ser menor a 100% — a 100% el neto objetivo (costo/(1-margen)) se vuelve infinito.'});
  else if(m<0) errors.push({field:'margin', level:'error', msg:'Margen objetivo no puede ser negativo.'});
  else if(m>90) errors.push({field:'margin', level:'warning', msg:`Margen objetivo de ${m}% es extremo — el modelo lo recorta a 90% para el calculo, pero revisa si es intencional.`});
  if((fc||0)===0 && (vc||0)===0) errors.push({field:'fixedCost', level:'warning', msg:'Costo total es 0 — el Piso/Base no estan protegiendo nada real hasta que cargues tus costos.'});
  return errors;
}

export function validateChannelInputs(channels=[]){
  const errors=[];
  channels.forEach(c=>{
    const comm=parseFloat(c.comm), bank=parseFloat(c.bankFeePct)||0, off=parseFloat(c.offsetPct)||0;
    if(Number.isNaN(comm) || comm<0 || comm>=100) errors.push({field:`${c.id}.comm`, level:'error', msg:`Comision de ${c.name} debe estar entre 0% y 100% (excluyente) — hoy: ${c.comm}.`});
    if(bank<0 || bank>=100) errors.push({field:`${c.id}.bankFeePct`, level:'error', msg:`Comision bancaria de ${c.name} debe estar entre 0% y 100% (excluyente) — hoy: ${bank}.`});
    if(comm+bank>=100) errors.push({field:`${c.id}.comm`, level:'error', msg:`${c.name}: comision (${comm}%) + bancaria (${bank}%) suman ${comm+bank}% o mas — el payout nunca puede ser positivo (ver payoutFactor).`});
    if(off<=-100) errors.push({field:`${c.id}.offsetPct`, level:'error', msg:`Offset de ${c.name} es ${off}% — un offset de -100% o menos hace el precio publicado 0 o negativo.`});
  });
  return errors;
}

export function validateScenario({days, nights, price}={}){
  const errors=[];
  if(days!==undefined && (Number.isNaN(parseFloat(days)) || parseFloat(days)<0)) errors.push({field:'days', level:'error', msg:'Dias de anticipacion debe ser 0 o mas.'});
  if(nights!==undefined && (Number.isNaN(parseFloat(nights)) || parseFloat(nights)<1)) errors.push({field:'nights', level:'error', msg:'Noches debe ser 1 o mas.'});
  if(price!==undefined && (Number.isNaN(parseFloat(price)) || parseFloat(price)<0)) errors.push({field:'price', level:'error', msg:'Precio no puede ser negativo.'});
  return errors;
}

/* Revisa un resultado YA calculado (compute()/quoteScenario()) por campos que
   deberian ser numeros finitos y no lo son — la ultima linea de defensa antes
   de renderizar. */
export function validateResultFinite(result, fields){
  const errors=[];
  fields.forEach(f=>{
    if(isBadNumber(result[f])) errors.push({field:f, level:'error', msg:`El resultado de "${f}" no es un numero valido (${result[f]}) — no se puede mostrar como una recomendacion confiable.`});
  });
  return errors;
}
