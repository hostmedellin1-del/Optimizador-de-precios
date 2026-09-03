/* HISTORIA — leer completo antes de tocar el denominador del Piso.

   Fase 2.1-fix (jul 2026) — se documentó como "CRITICO corregido": compute().floor
   y suggestedOffset() no incorporaban Last-Minute (lmConfig) en absoluto, y ese
   fix METIÓ el factor de LM en el denominador del Piso. Caso que se usó para
   justificarlo (ver tests/fase-lm-floor.test.js): canal Directo, costo 100,
   margen 0, sin descuentos OTA, LM flat 50% verificado en días 0-3 — el Piso
   viejo daba 109.89 y `valid:true`, pero "cotizar a ese precio en día 0 con el
   LM real aplicado netea 50, no 100".

   Fix de sep 2026 — esa premisa era EQUIVOCADA y aquí se corrige, sin borrar la
   historia. El razonamiento de jul 2026 asumía que el descuento de última hora
   de PriceLabs puede empujar el precio publicado por debajo del Min Price. NO
   puede, salvo en un caso puntual:

   - Base de conocimiento oficial de PriceLabs, textual: "only a Fixed Last-Minute
     Price can override the Minimum Price and push the final price below it.
     Percentage-based last-minute discounts will still respect the Minimum Price
     as a floor." Y además: "The Minimum Price is enforced before applying any
     percentage markups or uplifts like Pricing Offsets".
   - Precios diarios reales del listing 15195: del día 7 en adelante publica
     86-90 (Base=92); en los días 0-6 publica 65-83. El precio publicado YA trae
     el LM adentro — es decir, el número contra el que el Min hace tope.
   - Arquitectura confirmada por el dueño: PriceLabs entrega a Kunas (el PMS) el
     precio de la noche YA topado contra el Min; Kunas le suma después el % de
     cada OTA (Offset); recién ahí la OTA aplica sus descuentos nativos y su
     comisión.

   Cadena real, y el orden que este módulo modela:
     precio_publicado = max(Min, precio_con_LM)  ->  x (1+offset)  ->  x nativoOTA
     -> + aseo diluido  ->  x payoutFactor

   Consecuencia directa: el `floor` que calcula este módulo ES el Min Price de
   PriceLabs, y por definición es un piso sobre el precio DESPUÉS del descuento
   porcentual de última hora. Meter (1 - lmPct/100) en el denominador lo
   convertía en "el precio mínimo ANTES del LM", que no es lo que PriceLabs pide
   configurar: sobreestimaba el Min por exactamente 1/(1-LM_del_peor_día). En la
   unidad 902 daba 108.18 cuando el número correcto es 77.89 (108.18 x 0.72; ese
   28% es el LM gradual del día 0). La señal que destapó el bug: 108.18 quedaba
   POR ENCIMA del Base de PriceLabs (92) — un Min mayor que el Base es
   estructuralmente imposible.

   Lo que el fix de jul 2026 SÍ acertó y aquí se conserva intacto: el modo
   `fixed_price`. Un "Fixed Last-Minute Price" es el único que sí puede saltarse
   el Min Price, así que ningún Piso lo arregla — esos escenarios se siguen
   reportando aparte en `infeasible` (ver la rama de `priceOverride` más abajo).

   Este modulo enumera el peor escenario REAL — canal x día crítico x noche
   crítica x descuento OTA x offset — usando las MISMAS funciones fuente
   (combineChannel, priceLabsLm) que quoteScenario(), nunca reimplementando su
   lógica. También incluye la tarifa de aseo de Airbnb: es un ingreso fijo por
   reserva y, por tanto, se diluye según las noches del escenario. Cuando recibe
   `cost`, el peor caso se elige por el precio requerido real (no solo por el
   factor), porque ese ingreso aditivo rompe la equivalencia anterior. */
import {combineChannel, payoutFactor, cleanFeePerNight} from './engine.js';
import {pct, pct2} from './percent.js';
import {criticalDays, criticalNights} from './thresholds.js';
import {priceLabsLm, lmCriticalDays, LONG_STAY_NIGHTS} from './pricelabs-lm.js';

/* Para UN canal: el peor multiplicador combinado (offset x nativo OTA) sobre
   TODOS los días/noches críticos (unión de fronteras OTA y fronteras LM).

   El LM PORCENTUAL no está en ese multiplicador — a propósito, ver la historia
   del docblock de arriba: el resultado de este módulo es el Min Price de
   PriceLabs, y PriceLabs topa contra el Min el precio que YA trae el descuento
   porcentual de última hora aplicado. Las fronteras de día que introduce el LM
   (`lmCriticalDays`) se siguen enumerando igual, porque un `fixed_price` sí vive
   en esos bordes y hay que detectarlo (abajo).

   También detecta escenarios de precio-fijo LM matemáticamente inviables: si
   PriceLabs va a publicar un precio FIJO en cierto rango de días
   (lmConfig.mode==='fixed_price'), ningún Piso puede protegerlos — un Fixed
   Last-Minute Price es el ÚNICO caso en que PriceLabs publica por debajo del
   Min Price — así que se reportan aparte en `infeasible`, no participan en el
   cálculo de `worstFactor`.

   lmConfig=null/undefined => modo 'ceiling_auto' implícito (mismo default que
   priceLabsLm()) — usado para no romper compatibilidad con callers que todavía
   no pasan lmConfig explícito.

   `cost` acepta NUMERO (de siempre, costo constante para todas las duraciones —
   correcto para el modelo simple fixedCost+varCost) o FUNCION `(nights)=>number`
   (costo real de esa duración específica, ver costForNightFn() en costs.js). Caso
   real que motivó esto (unidad 902): 1 noche cuesta USD 71.50/noche (aseo+lavandería+
   insumos fijos por reserva, sin diluir), pero 27 noches cuesta solo USD 42.61/noche
   — pasar el número fijo de 1 noche a la búsqueda de 27 noches inflaba el Piso a
   ~138.69 (Airbnb) en vez de los ~108.18 (Expedia, 1 noche) que da con el costo real
   de cada duración. Ver tests/floor-cost-por-noche.test.js. */
export function worstScenarioFactor({chId, channels, discounts, windows, ceilings, lmConfig, cost}){
  const ch = channels.find(c=>c.id===chId);
  const off = pct2(ch.offsetPct)/100;
  const pf = payoutFactor(ch);
  const otaDays = criticalDays(discounts, windows);
  const lmDays = lmCriticalDays(lmConfig);
  const days = [...new Set([...otaDays, ...lmDays])].sort((a,b)=>a-b);
  const nights = criticalNights(discounts);
  const needsSharedCeiling = !lmConfig || lmConfig.mode==='ceiling_auto';
  const hasCost = typeof cost==='number' || typeof cost==='function';

  let worstFactor = Infinity;
  let worstFeePerNight = 0;
  let worstRequiredPrice = -Infinity;
  let worstDay = days[0], worstNight = nights[0];
  const infeasible = [];

  days.forEach(d=>{
    const w = windows.find(win=>d>=win.lo && d<=win.hi) || windows[windows.length-1];
    const ceil = pct((ceilings||{})[w.id]);
    nights.forEach(n=>{
      const feePerNight = cleanFeePerNight(ch, n);
      const costAtN = typeof cost==='function' ? cost(n) : cost;
      const nativeFactor = combineChannel(discounts, chId, d, n).factor;
      // ceiling_auto es una politica COMPARTIDA entre canales: el LM depende del
      // peor nativo entre TODOS los canales a este mismo (dia,noche), no solo el propio.
      // Se sigue calculando porque priceLabsLm() lo necesita para resolver el modo
      // ceiling_auto; su `lmPct` ya no entra en el denominador del Piso (ver docblock),
      // pero pasarle un nativo falso seria mentirle a la fuente unica de LM.
      let sharedNative = 0;
      if(needsSharedCeiling){
        channels.forEach(c2=>{
          const f2 = combineChannel(discounts, c2.id, d, n).factor;
          const p2 = (1-f2)*100;
          if(p2>sharedNative) sharedNative=p2;
        });
      }
      const lmResult = n>=LONG_STAY_NIGHTS
        ? {lmPct:0, priceOverride:null}
        : priceLabsLm(lmConfig, {day:d, ceilingPct:ceil, nativePct:sharedNative});
      if(lmResult.priceOverride!=null){
        const payoutAtOverride = (lmResult.priceOverride*(1+off)*nativeFactor + feePerNight)*pf;
        if(hasCost && payoutAtOverride < costAtN - 1e-9){
          infeasible.push({chId, day:d, night:n, overridePrice:lmResult.priceOverride, payoutAtOverride});
        }
        return; // el Piso no puede "arreglar" un precio fijo — no participa en worstFactor
      }
      /* SIN el factor de LM porcentual (fix sep 2026, ver docblock): el precio
         que este factor multiplica es el precio YA topado contra el Min, o sea
         el que PriceLabs publica DESPUES de aplicar su descuento porcentual de
         ultima hora. Meter (1-lmPct/100) aqui volvia a dividir por el LM y
         sobreestimaba el Min por 1/(1-LM). Los 4 modos porcentuales
         (ceiling_auto/flat/gradual/tiers) caen todos en esta rama; el unico
         modo que NO llega hasta aca es fixed_price, que sale antes por
         `priceOverride` (arriba) porque si puede saltarse el Min. */
      const combinedFactor = (1+off)*nativeFactor;
      if(hasCost){
        const costPerPf = costAtN/pf;
        const requiredPrice = combinedFactor>0
          ? Math.max(0, costPerPf-feePerNight)/combinedFactor
          : Infinity;
        if(requiredPrice > worstRequiredPrice){
          worstRequiredPrice=requiredPrice;
          worstFactor=combinedFactor;
          worstFeePerNight=feePerNight;
          worstDay=d;
          worstNight=n;
        }
      } else if(combinedFactor < worstFactor){
        worstFactor=combinedFactor;
        worstFeePerNight=feePerNight;
        worstDay=d;
        worstNight=n;
      }
    });
  });
  if(worstFactor===Infinity) worstFactor=0; // todo el dominio era precio-fijo inviable
  /* `worstRequiredPrice` (solo cuando se paso `cost`): el precio que ese peor
     escenario EXIGE, ya calculado arriba con el costo real de SU duracion. Se
     expone para que compute() (engine.js) no pueda volver a divergir de esta
     busqueda — el bug de sep 2026 fue exactamente eso: la seleccion usaba el
     costo por duracion y el valor final volvia a dividir el costo de 1 noche.
     tests/floor-cost-por-noche.test.js pinnea que compute().floor coincide con
     el maximo de este campo entre canales.
     `null` cuando no se paso `cost` (no hay precio que calcular) y tambien
     cuando TODO el dominio resulto ser precio-fijo inviable (worstRequiredPrice
     seguiria en -Infinity, un valor que no significa nada para un caller — ese
     caso ya se reporta por `infeasible` y engine.js lo trata como Infinity). */
  const hasRequiredPrice = hasCost && worstRequiredPrice > -Infinity;
  return {worstFactor, worstFeePerNight, worstDay, worstNight, worstRequiredPrice: hasRequiredPrice ? worstRequiredPrice : null, infeasible, pf};
}
