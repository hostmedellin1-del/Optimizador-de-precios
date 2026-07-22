/* Fase 2 de la auditoria: enumeracion EXHAUSTIVA de los puntos discretos donde
   combineChannel() puede cambiar de valor, para reemplazar el muestreo por punto
   medio de worstNative() (P1).

   Por que esto es matematicamente suficiente (sin epsilon continuo): dias y
   noches son SIEMPRE enteros en este dominio (reservas no se miden en fracciones
   de dia). combineChannel() es una funcion escalonada (piecewise constante) en
   `daysOut`/`nights`: el conjunto de descuentos "aplicables" (windowApplies/
   losApplies) solo cambia exactamente en los limites `from`/`to` de cada
   descuento tipo 'window' y en cada `minN` de tipo 'los' — es una simple
   pertenencia a intervalo cerrado [from,to] / [minN,+inf). Entre dos puntos
   criticos consecutivos, el conjunto aplicable NO cambia, asi que el resultado
   tampoco. Por lo tanto, el maximo global de combineChannel() sobre todo el
   dominio SIEMPRE se alcanza en uno de estos puntos discretos — no hace falta
   epsilon, ni muestrear "cerca" de una frontera: la frontera MISMA ya es el punto
   a evaluar (from incluye, to incluye; from-1 y to+1 capturan el valor justo
   antes/despues de que el descuento entre o salga). */

const FAR_DAY = 9999;    // mismo valor que usa el catalogo como `to` por defecto de ventanas abiertas
const FAR_NIGHTS = 400;  // > un anio; ninguna estadia real de Airbnb/Booking/Expedia lo supera

export function criticalDays(discounts, windows = []){
  const days = new Set([0, FAR_DAY]);
  discounts.forEach(d=>{
    if(d.kind==='window'){
      const from = d.from ?? 0;
      const to = d.to ?? FAR_DAY;
      days.add(from);
      if(from>0) days.add(from-1);
      days.add(to);
      if(to<FAR_DAY) days.add(to+1);
    }
  });
  // Limites de ventana (techo/UI), incluidos por completitud aunque combineChannel()
  // no dependa directamente de WINDOWS — no aportan maximos nuevos matematicamente
  // (ver docstring), pero cuestan cero y eliminan cualquier duda de cobertura.
  windows.forEach(w=>{
    days.add(w.lo);
    if(w.lo>0) days.add(w.lo-1);
    if(w.hi<FAR_DAY) { days.add(w.hi); days.add(w.hi+1); }
  });
  return [...days].filter(d=>d>=0).sort((a,b)=>a-b);
}

export function criticalNights(discounts){
  const nights = new Set([1, FAR_NIGHTS]);
  discounts.forEach(d=>{
    if(d.kind==='los'){
      const minN = d.minN ?? 1;
      nights.add(minN);
      if(minN>1) nights.add(minN-1);
    }
  });
  return [...nights].filter(n=>n>=1).sort((a,b)=>a-b);
}
