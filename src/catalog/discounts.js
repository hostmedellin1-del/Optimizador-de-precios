/* Catalogo de canales y descuentos. Extraido verbatim de index.html (Fase 1 de la
   auditoria tecnica, jul 2026) — cero cambio de logica, solo relocacion a modulo ES
   para poder importarlo desde tests reales y desde la UI sin duplicar el codigo.
   CHANNELS es una plantilla: quien lo use debe clonar (c=>({...c})) antes de mutar,
   igual que hacia el index.html original al construir `state.channels`. */
export const CHANNELS = [
  {id:'airbnb', name:'Airbnb', comm:15.5, offsetPct:0, bankFeePct:0, cleanFeeShort:0, cleanFeeLong:0},
  {id:'booking', name:'Booking.com', comm:18, offsetPct:0, bankFeePct:6},
  {id:'expedia', name:'Expedia', comm:25, offsetPct:0, bankFeePct:0},
  {id:'direct', name:'Directo', comm:3, offsetPct:0, bankFeePct:6}
];

/* Discount catalog. kind: constant | window (booking-window days) | los (min nights)
   group drives combination rules per channel. */
export function defaultDiscounts(){ return [
  /* AIRBNB — grupo 'promo': solo UNA aplica, por orden de prioridad fijo (prio menor = gana) */
  {id:'ab_new', ch:'airbnb', name:'Promo anuncio nuevo (20%)', kind:'constant', group:'promo', prio:1, pct:20, on:false, note:'primeras 3 reservas; máxima prioridad'},
  {id:'ab_cus', ch:'airbnb', name:'Promoción personalizada', kind:'window', group:'promo', prio:2, pct:0, from:0, to:9999, on:false, note:'fechas específicas'},
  {id:'ab_los1', ch:'airbnb', name:'Estadía media (≥3 noches)',  kind:'los', group:'promo', prio:3, pct:5,  minN:3,  on:false, note:'sugerido — noches completamente editables, ajusta o apaga'},
  {id:'ab_los2', ch:'airbnb', name:'Semanal (≥7 noches)',        kind:'los', group:'promo', prio:3, pct:10, minN:7,  on:false, lockN:true, note:'7 noches fijo — el nombre "Semanal" depende de ese número; % sí ajustable'},
  {id:'ab_los3', ch:'airbnb', name:'Quincenal (≥14 noches)',     kind:'los', group:'promo', prio:3, pct:15, minN:14, on:false, lockN:true, note:'14 noches fijo — el nombre "Quincenal" depende de ese número; % sí ajustable'},
  {id:'ab_los4', ch:'airbnb', name:'Larga estadía (≥28 noches)', kind:'los', group:'promo', prio:3, pct:25, minN:28, on:true,  lockN:true, note:'activo hoy: ≥28 noches → 25% (umbral real de "estadía larga" en Airbnb, fijo)'},
  {id:'ab_los5', ch:'airbnb', name:'Duración personalizada A', kind:'los', group:'promo', prio:3, pct:0, minN:5,  on:false, note:'noches y % completamente editables, ajusta o apaga'},
  {id:'ab_los6', ch:'airbnb', name:'Duración personalizada B', kind:'los', group:'promo', prio:3, pct:0, minN:10, on:false, note:'noches y % completamente editables, ajusta o apaga'},
  {id:'ab_los7', ch:'airbnb', name:'Duración personalizada C', kind:'los', group:'promo', prio:3, pct:0, minN:21, on:false, note:'noches y % completamente editables, ajusta o apaga'},
  {id:'ab_eb1',  ch:'airbnb', name:'Early-bird (1 mes / ≥30 días)', kind:'window', group:'promo', prio:4, pct:10, from:30, to:9999, on:false, lockN:true, note:'30 días fijo (1 mes) — % sí ajustable'},
  {id:'ab_eb2',  ch:'airbnb', name:'Early-bird (2 meses / ≥60 días)', kind:'window', group:'promo', prio:4, pct:15, from:60, to:9999, on:false, lockN:true, note:'60 días fijo (2 meses) — % sí ajustable'},
  {id:'ab_eb3',  ch:'airbnb', name:'Early-bird (3 meses / ≥90 días)', kind:'window', group:'promo', prio:4, pct:20, from:90, to:9999, on:false, lockN:true, note:'90 días fijo (3 meses) — % sí ajustable'},
  {id:'ab_lm1',  ch:'airbnb', name:'Last-minute 1', kind:'window', group:'promo', prio:5, pct:0,  from:0, to:1,  on:false, note:'ventana y % completamente variables — configúralos tú'},
  {id:'ab_lm2',  ch:'airbnb', name:'Last-minute 2', kind:'window', group:'promo', prio:5, pct:0,  from:0, to:3,  on:false, note:'ventana y % completamente variables — configúralos tú'},
  {id:'ab_lm3',  ch:'airbnb', name:'Last-minute 3', kind:'window', group:'promo', prio:5, pct:0,  from:0, to:7,  on:false, note:'ventana y % completamente variables — configúralos tú'},
  {id:'ab_rs',  ch:'airbnb', name:'Ajuste de rule set / temporada', kind:'constant', group:'stackable', prio:0, pct:0, on:false, note:'apila sobre la promo ganadora'},
  /* BOOKING — proactive stack; reactive exclusive; mobile conflicts w/ country & limited */
  {id:'bk_gen', ch:'booking', name:'Genius (constante)', kind:'constant', group:'proactive', pct:10, on:true, note:'lo funde el host; L1=10%'},
  {id:'bk_mob', ch:'booking', name:'Mobile Rate', kind:'constant', group:'proactive-mobile', pct:10, on:true, note:'apila con Genius; no con Country/Limited'},
  {id:'bk_cty', ch:'booking', name:'Country Rate', kind:'constant', group:'proactive-country', pct:0, on:false},
  {id:'bk_lmd', ch:'booking', name:'Last-Minute Deal', kind:'window', group:'reactive', pct:0, from:0, to:3, on:false},
  {id:'bk_ebd', ch:'booking', name:'Early Booker Deal', kind:'window', group:'reactive', pct:0, from:30, to:9999, on:false},
  {id:'bk_bas', ch:'booking', name:'Basic Deal', kind:'constant', group:'reactive', pct:0, on:false},
  {id:'bk_ltd', ch:'booking', name:'Limited-time Deal', kind:'constant', group:'reactive-limited', pct:0, on:false, note:'no combina con Mobile'},
  {id:'bk_los1', ch:'booking', name:'Duración de estadía A (≥7 noches)', kind:'los', group:'los', pct:0, minN:7, on:false, note:'es tu tarifa (Rates & Availability → Discounts → duración de estadía), no un "deal" — se apila con Genius/Mobile/deals; noches y % editables'},
  {id:'bk_los2', ch:'booking', name:'Duración de estadía B (≥14 noches)', kind:'los', group:'los', pct:0, minN:14, on:false, note:'noches y % editables, ajusta o apaga'},
  {id:'bk_los3', ch:'booking', name:'Duración de estadía C (≥28 noches)', kind:'los', group:'los', pct:0, minN:28, on:false, note:'noches y % editables, ajusta o apaga'},
  /* EXPEDIA — base promos exclusive (max); MOD stacks on top */
  {id:'ex_mod', ch:'expedia', name:'Oferta VIP miembros (negociada, no editable en Expedia)', kind:'constant', group:'mod', pct:20, on:true, note:'apila sobre la promo base; Expedia da Blue 10% / Silver 15% / Gold+Platino 20% según el nivel del viajero — se usa el peor caso (20%) para proteger el piso, igual que el resto del motor'},
  {id:'ex_mob', ch:'expedia', name:'Mobile-only', kind:'constant', group:'base', pct:0, on:false},
  {id:'ex_sd',  ch:'expedia', name:'Same-day / last-minute', kind:'window', group:'base', pct:0, from:0, to:1, on:false},
  {id:'ex_eb',  ch:'expedia', name:'Early booking', kind:'window', group:'base', pct:0, from:30, to:9999, on:false},
  {id:'ex_bas', ch:'expedia', name:'Basic promo', kind:'constant', group:'base', pct:0, on:false},
  {id:'ex_los1', ch:'expedia', name:'Duración de estadía A (≥7 noches)', kind:'los', group:'base', pct:0, minN:7, on:false, note:'noches y % completamente editables, ajusta o apaga'},
  {id:'ex_los2', ch:'expedia', name:'Duración de estadía B (≥14 noches)', kind:'los', group:'base', pct:0, minN:14, on:false, note:'noches y % completamente editables, ajusta o apaga'},
  {id:'ex_los3', ch:'expedia', name:'Duración de estadía C (≥28 noches)', kind:'los', group:'base', pct:0, minN:28, on:false, note:'noches y % completamente editables, ajusta o apaga'},
  /* DIRECT */
  {id:'di_lm',  ch:'direct', name:'Last-minute directo', kind:'window', group:'any', pct:0, from:0, to:3, on:false}
];}

export const WINDOWS = [
  {id:'w0', label:'0–1 día', lo:0, hi:1, ceil:35},
  {id:'w1', label:'2–3 días', lo:2, hi:3, ceil:28},
  {id:'w2', label:'4–7 días', lo:4, hi:7, ceil:18},
  {id:'w3', label:'8–14 días', lo:8, hi:14, ceil:8},
  {id:'w4', label:'15–29 días', lo:15, hi:29, ceil:0},
  {id:'w5', label:'30+ días', lo:30, hi:9999, ceil:15}
];

/* Calculadora opcional de costos por noche a partir de líneas reales — no reemplaza
   fixedCost/varCost, los calcula y escribe ahí (compute() sigue leyendo solo esos dos). */
export function defaultCostBreakdown(){ return {rent:0, admin:0, utilities:0, insurance:0, tech:0, occNights:22, cleaning:0, laundry:0, consumables:0, supplies:0}; }
