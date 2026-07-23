/* Fase 6 — persistencia robusta: identidad estable por UUID (en vez de solo el
   slug del nombre, que colisiona si dos unidades comparten nombre o si Dani
   renombra una unidad), y validacion de forma para archivos de importacion
   antes de escribirlos a storage. NO borra `v2:*` — la migracion v2->v3 solo
   AGREGA registros nuevos, nunca toca ni elimina los viejos (ver index.html,
   boton "Migrar unidades v2 -> v3").

   Formato de storage:
     v2:<slug-del-nombre>  — formato legado (Fase 1-5), se sigue leyendo y
                              escribiendo tal cual, nunca se borra automatico.
     v3:<uuid>             — formato nuevo: mismo contenido de unidad + {id,
                              schemaVersion, savedAt, migratedFromV2Key?}. */
import {CHANNELS, defaultDiscounts, WINDOWS, defaultCostBreakdown, defaultLmConfig} from '../catalog/discounts.js';
import {VERIFICATION_KEYS, defaultVerification} from './verification.js';
import {defaultMonthlyIncomeScenario, defaultMonthlyDistribution} from './monthly-economics.js';

const VERIFICATION_STATUSES = ['no_verificado', 'verificado', 'no_aplica'];

export const SCHEMA_VERSION = 3;

/* --- helpers de coercion ESTRICTA (Bloqueante 6: nunca `parseFloat(x)||0`
   silencioso para datos ingresados/importados — un valor invalido se
   DESCARTA a favor del default y se REPORTA, nunca se convierte en 0 sin
   decirlo). --- */
function safeNum(v, fallback){
  if(typeof v==='number' && Number.isFinite(v)) return v;
  if(typeof v==='string' && v.trim()!==''){
    const n = Number(v);
    if(Number.isFinite(n)) return n;
  }
  return {invalid:true, fallback};
}
function numField(raw, key, fallback, warnings, path){
  if(!(key in raw)) return fallback;
  const r = safeNum(raw[key], fallback);
  if(r && r.invalid){ warnings.push(`${path}.${key}: valor no numerico ("${String(raw[key]).slice(0,60)}") — se uso el default (${fallback}).`); return fallback; }
  return r;
}
/* P2 (revision externa) — para campos donde `null` es un estado VALIDO de
   "todavia no configurado" (ej. monthlyIncomeScenario.manualNetPerNight),
   distinto de un valor invalido. Si `raw[key]` es null explicito, se preserva
   tal cual, sin warning — un warning ahi seria un falso positivo cada vez que
   se exporta/reimporta una unidad que nunca configuro este campo. */
function nullableNumField(raw, key, fallback, warnings, path){
  if(!(key in raw)) return fallback;
  if(raw[key]===null) return null;
  const r = safeNum(raw[key], fallback);
  if(r && r.invalid){ warnings.push(`${path}.${key}: valor no numerico ("${String(raw[key]).slice(0,60)}") — se uso el default (${fallback}).`); return fallback; }
  return r;
}
function pctField(raw, key, fallback, warnings, path, {min=0, max=100}={}){
  let v = numField(raw, key, fallback, warnings, path);
  if(v<min || v>max){
    warnings.push(`${path}.${key}: ${v} fuera de rango [${min},${max}] — se uso el default (${fallback}).`);
    v = fallback;
  }
  return v;
}
/* Bloqueante 6 (revision externa): NUNCA `Math.max(0, valor)` para "limpiar"
   un negativo — eso lo convierte en 0 en silencio, indistinguible de un 0
   real que Dani si quiso escribir. Un valor negativo donde no tiene sentido
   (costos, dias, noches, occNights) se RECHAZA explicitamente a favor del
   default, con warning — igual que cualquier otro valor invalido. */
function nonNegField(raw, key, fallback, warnings, path, {min=1}={}){
  let v = numField(raw, key, fallback, warnings, path);
  if(v<min){
    warnings.push(`${path}.${key}: ${v} no puede ser menor que ${min} — se uso el default (${fallback}).`);
    v = fallback;
  }
  return v;
}
function strField(raw, key, fallback, warnings, path, maxLen=200){
  if(!(key in raw)) return fallback;
  if(typeof raw[key]!=='string'){ warnings.push(`${path}.${key}: no es texto — se uso el default.`); return fallback; }
  return raw[key].slice(0, maxLen);
}
function boolField(raw, key, fallback){
  return typeof raw[key]==='boolean' ? raw[key] : fallback;
}

function normalizeDiscount(raw, def, warnings){
  if(!raw || typeof raw!=='object') return {...def};
  const out = {...def};
  out.on = boolField(raw, 'on', def.on);
  out.pct = pctField(raw, 'pct', def.pct, warnings, `discounts.${def.id}`, {min:0, max:100});
  if(def.kind==='window' && !def.lockN){
    out.from = Math.round(nonNegField(raw, 'from', def.from, warnings, `discounts.${def.id}`, {min:0}));
    let to = Math.round(numField(raw, 'to', def.to, warnings, `discounts.${def.id}`));
    if(to<out.from){ warnings.push(`discounts.${def.id}: "to" (${to}) menor que "from" (${out.from}) — se trato como ventana abierta.`); to = 9999; }
    out.to = to;
  }
  if(def.kind==='los' && !def.lockN){
    out.minN = Math.round(nonNegField(raw, 'minN', def.minN, warnings, `discounts.${def.id}`, {min:1}));
  }
  if('verified' in raw) out.verified = boolField(raw, 'verified', def.verified);
  return out;
}

function normalizeChannel(raw, def, warnings){
  const out = {...def};
  out.comm = pctField(raw||{}, 'comm', def.comm, warnings, `channels.${def.id}`, {min:0, max:100});
  out.bankFeePct = pctField(raw||{}, 'bankFeePct', def.bankFeePct||0, warnings, `channels.${def.id}`, {min:0, max:100});
  out.offsetPct = numField(raw||{}, 'offsetPct', def.offsetPct||0, warnings, `channels.${def.id}`);
  if(out.offsetPct<=-100){ warnings.push(`channels.${def.id}.offsetPct: ${out.offsetPct} <= -100 no es viable — se uso 0.`); out.offsetPct=0; }
  if(def.id==='airbnb'){
    out.cleanFeeShort = nonNegField(raw||{}, 'cleanFeeShort', def.cleanFeeShort||0, warnings, `channels.${def.id}`, {min:0});
    out.cleanFeeLong = nonNegField(raw||{}, 'cleanFeeLong', def.cleanFeeLong||0, warnings, `channels.${def.id}`, {min:0});
  }
  return out;
}

function normalizeLmRange(raw, defaults, warnings, path){
  const out = {...defaults};
  if(!raw || typeof raw!=='object') return out;
  out.on = boolField(raw, 'on', defaults.on);
  if('pct' in defaults) out.pct = pctField(raw, 'pct', defaults.pct, warnings, path, {min:0, max:100});
  if('maxPct' in defaults) out.maxPct = pctField(raw, 'maxPct', defaults.maxPct, warnings, path, {min:0, max:100});
  if('price' in defaults) out.price = nonNegField(raw, 'price', defaults.price, warnings, path, {min:0});
  if('days' in defaults) out.days = Math.round(nonNegField(raw, 'days', defaults.days, warnings, path, {min:1}));
  if('fromDay' in defaults) out.fromDay = Math.round(nonNegField(raw, 'fromDay', defaults.fromDay, warnings, path, {min:0}));
  if('toDay' in defaults){
    let to = Math.round(numField(raw, 'toDay', defaults.toDay, warnings, path));
    if(to<out.fromDay){ warnings.push(`${path}: toDay (${to}) < fromDay (${out.fromDay}) — se ajusto a fromDay.`); to = out.fromDay; }
    out.toDay = to;
  }
  return out;
}

const MAX_TIERS = 50; // limite defensivo — un import malicioso no puede forzar un arreglo gigante

function normalizeTiers(raw, warnings){
  if(!Array.isArray(raw)) { if(raw!==undefined) warnings.push('lmConfig.tiers: no es un arreglo — se descarto.'); return []; }
  const out = [];
  raw.slice(0, MAX_TIERS).forEach((t, i)=>{
    if(!t || typeof t!=='object'){ warnings.push(`lmConfig.tiers[${i}]: no es un objeto — descartado.`); return; }
    const fromDay = Math.round(nonNegField(t, 'fromDay', 0, warnings, `lmConfig.tiers[${i}]`, {min:0}));
    let toDay = Math.round(numField(t, 'toDay', fromDay, warnings, `lmConfig.tiers[${i}]`));
    if(toDay<fromDay){ warnings.push(`lmConfig.tiers[${i}]: toDay < fromDay — ajustado.`); toDay = fromDay; }
    out.push({
      id: strField(t, 'id', 't'+i, warnings, `lmConfig.tiers[${i}]`, 60),
      label: strField(t, 'label', 'Tramo '+(i+1), warnings, `lmConfig.tiers[${i}]`, 80),
      fromDay, toDay,
      pct: pctField(t, 'pct', 0, warnings, `lmConfig.tiers[${i}]`, {min:0, max:100}),
      on: boolField(t, 'on', false)
    });
  });
  if(Array.isArray(raw) && raw.length>MAX_TIERS) warnings.push(`lmConfig.tiers: ${raw.length} tramos excede el limite (${MAX_TIERS}) — se recortaron los primeros ${MAX_TIERS}.`);
  return out;
}

const LM_MODES = ['ceiling_auto','flat','gradual','fixed_price','tiers'];

function normalizeLmConfig(raw, warnings){
  const def = defaultLmConfig();
  if(!raw || typeof raw!=='object') return def;
  const mode = LM_MODES.includes(raw.mode) ? raw.mode : 'ceiling_auto';
  if(raw.mode!==undefined && mode!==raw.mode) warnings.push(`lmConfig.mode: "${String(raw.mode).slice(0,40)}" no es un modo reconocido — se uso 'ceiling_auto'.`);
  return {
    mode,
    verified: boolField(raw, 'verified', false),
    flat: normalizeLmRange(raw.flat, def.flat, warnings, 'lmConfig.flat'),
    gradual: normalizeLmRange(raw.gradual, def.gradual, warnings, 'lmConfig.gradual'),
    fixedPrice: normalizeLmRange(raw.fixedPrice, def.fixedPrice, warnings, 'lmConfig.fixedPrice'),
    tiers: normalizeTiers(raw.tiers, warnings)
  };
}

/* Fase 5 (revision externa — "datos financieros verificados"): un registro de
   verificacion ahora guarda status/fuente/fecha/nota (antes solo status/nota),
   y las claves de alcance 'channel' (hoy solo bankFeePctByChannel) guardan UN
   registro POR CANAL, no uno solo plano. La regla de seguridad de siempre se
   mantiene y se REFUERZA: cualquier campo con forma o tipo invalido se
   DESCARTA a favor de 'no_verificado' — un import malformado (o el formato
   viejo, plano, de antes de esta fase) JAMAS puede terminar marcando algo como
   'verificado' por accidente. Si `raw[key]` viene en el formato viejo (un
   objeto plano {status,note} en vez de {canalId: {...}}), sus sub-claves de
   canal (raw[key][chId]) simplemente no existen — cada canal cae al default
   'no_verificado', que es exactamente la migracion segura que se pidio. */
function normalizeVerificationEntry(raw, warnings, path){
  const def = {status:'no_verificado', source:'', date:'', note:''};
  if(!raw || typeof raw!=='object') return def;
  let status = 'no_verificado';
  if(VERIFICATION_STATUSES.includes(raw.status)) status = raw.status;
  else if(raw.status!==undefined) warnings.push(`${path}.status: valor desconocido ("${String(raw.status).slice(0,40)}") — se uso 'no_verificado'.`);
  const date = (typeof raw.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) ? raw.date : '';
  if(raw.date!==undefined && raw.date!=='' && !date) warnings.push(`${path}.date: "${String(raw.date).slice(0,40)}" no tiene forma AAAA-MM-DD — se descarto.`);
  return {
    status,
    source: strField(raw, 'source', '', warnings, path, 300),
    date,
    note: strField(raw, 'note', '', warnings, path, 800)
  };
}

function normalizeVerification(raw, warnings){
  const def = defaultVerification();
  if(!raw || typeof raw!=='object') return def;
  const out = {};
  Object.keys(VERIFICATION_KEYS).forEach(key=>{
    const meta = VERIFICATION_KEYS[key];
    if(meta.scope==='channel'){
      const rawVal = raw[key] && typeof raw[key]==='object' ? raw[key] : {};
      out[key] = {};
      CHANNELS.forEach(c=>{
        out[key][c.id] = normalizeVerificationEntry(rawVal[c.id], warnings, `verification.${key}.${c.id}`);
      });
    } else {
      out[key] = normalizeVerificationEntry(raw[key], warnings, `verification.${key}`);
    }
  });
  return out;
}

const MONTHLY_INCOME_TYPES = ['manual', 'channel', 'mix'];
const CHANNEL_IDS = CHANNELS.map(c => c.id);

function normalizeMonthlyChannelScenario(raw, def, warnings, path){
  const out = {...def};
  if(!raw || typeof raw!=='object') return out;
  if(CHANNEL_IDS.includes(raw.chId)) out.chId = raw.chId;
  else if(raw.chId!==undefined) warnings.push(`${path}.chId: "${String(raw.chId).slice(0,40)}" no es un canal conocido — se uso "${def.chId}".`);
  out.days = Math.round(nonNegField(raw, 'days', def.days, warnings, path, {min:0}));
  out.nights = Math.round(nonNegField(raw, 'nights', def.nights, warnings, path, {min:1}));
  out.price = nonNegField(raw, 'price', def.price, warnings, path, {min:0});
  return out;
}

/* Fase "planificación mensual" — igual disciplina que discounts/channels
   arriba: solo canales CONOCIDOS (whitelist contra CHANNEL_IDS), nunca se
   inventa una fila de mezcla nueva desde un import; un `type` desconocido cae
   a 'manual' (el mas seguro — nunca calcula sin que Dani escriba un numero
   el mismo), nunca se ejecuta ni preserva el valor crudo. */
function normalizeMonthlyIncomeScenario(raw, warnings){
  const def = defaultMonthlyIncomeScenario(CHANNEL_IDS);
  if(!raw || typeof raw!=='object') return def;
  const type = MONTHLY_INCOME_TYPES.includes(raw.type) ? raw.type : 'manual';
  if(raw.type!==undefined && type!==raw.type) warnings.push(`monthlyIncomeScenario.type: "${String(raw.type).slice(0,40)}" no es un tipo reconocido — se uso 'manual'.`);
  const manualNetPerNight = nullableNumField(raw, 'manualNetPerNight', def.manualNetPerNight, warnings, 'monthlyIncomeScenario');
  const channel = normalizeMonthlyChannelScenario(raw.channel, def.channel, warnings, 'monthlyIncomeScenario.channel');
  const rawMixById = Object.fromEntries((Array.isArray(raw.mix) ? raw.mix : []).filter(m => m && CHANNEL_IDS.includes(m.chId)).map(m => [m.chId, m]));
  if(!Array.isArray(raw.mix) && raw.mix!==undefined) warnings.push('monthlyIncomeScenario.mix: no es un arreglo — se uso el default (todos apagados).');
  const mix = def.mix.map(defRow => {
    const rawRow = rawMixById[defRow.chId];
    if(!rawRow || typeof rawRow!=='object') return {...defRow};
    const path = `monthlyIncomeScenario.mix.${defRow.chId}`;
    return {
      chId: defRow.chId,
      on: boolField(rawRow, 'on', defRow.on),
      weightPct: pctField(rawRow, 'weightPct', defRow.weightPct, warnings, path, {min:0, max:100}),
      days: Math.round(nonNegField(rawRow, 'days', defRow.days, warnings, path, {min:0})),
      nights: Math.round(nonNegField(rawRow, 'nights', defRow.nights, warnings, path, {min:1})),
      price: nonNegField(rawRow, 'price', defRow.price, warnings, path, {min:0})
    };
  });
  return {type, manualNetPerNight, channel, mix};
}

/* reservePct/taxReservePct/ownerTargetPct/managerTargetPct: 0-100 estricto —
   un valor fuera de rango se descarta a favor de 0 (nunca inventa un reparto).
   `configured` migra a `false` para cualquier unidad que no lo tenga — jamas
   `true` por defecto (ver CLAUDE.md: nunca repartir el margin viejo solo). */
function normalizeMonthlyDistribution(raw, warnings){
  const def = defaultMonthlyDistribution();
  if(!raw || typeof raw!=='object') return def;
  return {
    configured: boolField(raw, 'configured', def.configured),
    ownerTargetPct: pctField(raw, 'ownerTargetPct', def.ownerTargetPct, warnings, 'monthlyDistribution', {min:0, max:100}),
    managerTargetPct: pctField(raw, 'managerTargetPct', def.managerTargetPct, warnings, 'monthlyDistribution', {min:0, max:100}),
    reservePct: pctField(raw, 'reservePct', def.reservePct, warnings, 'monthlyDistribution', {min:0, max:100}),
    taxReservePct: pctField(raw, 'taxReservePct', def.taxReservePct, warnings, 'monthlyDistribution', {min:0, max:100})
  };
}

function normalizeCostBreakdown(raw, warnings){
  const def = defaultCostBreakdown();
  const out = {...def};
  if(!raw || typeof raw!=='object') return out;
  Object.keys(def).forEach(key=>{
    // occNights es un DIVISOR en costs.js/costs-legacy.js — 0 o negativo no es
    // "cero costo", es un dato invalido (division por cero corriente abajo).
    out[key] = nonNegField(raw, key, def[key], warnings, 'costBreakdown', {min: key==='occNights' ? 1 : 0});
  });
  return out;
}

/* BLOQUEANTE ALTO/MEDIO corregido (revision externa) — funcion UNICA de
   normalizacion para CUALQUIER registro v2/v3 (guardado, cargado o
   importado). Nunca confia en la forma ni el tipo de un campo:
   - Solo preserva canales/descuentos/ventanas/claves de verificacion
     CONOCIDOS (whitelist contra el catalogo) — un id desconocido se descarta,
     nunca se inventa un descuento/canal nuevo desde un import.
   - Todo campo numerico pasa por coercion ESTRICTA (numField/pctField): un
     valor no numerico, fuera de rango, o con from>to, se DESCARTA a favor del
     default y se reporta en `warnings` — nunca se convierte en 0 en silencio
     (Bloqueante 6) ni queda como string capaz de romper un atributo HTML
     (Bloqueante 4 — un `number` de JS jamas puede contener comillas/`<`).
   - Deep merge de lmConfig (mode/flat/gradual/fixedPrice/tiers) y de
     verification — una unidad vieja sin estas claves recibe los defaults
     completos, nunca queda con un objeto a medias que rompa `.gradual.on` etc.
   - Devuelve SIEMPRE un estado completo y renderizable, mas la lista de
     `warnings` (que se descarto y por que) para que Dani pueda revisarla. */
export function normalizeUnit(raw){
  const warnings = [];
  if(!raw || typeof raw!=='object'){
    return {state: null, warnings: ['El registro no es un objeto — no se pudo normalizar.']};
  }
  const name = strField(raw, 'name', '', warnings, 'unidad', 200);
  if(!name) warnings.push('unidad.name: falta o esta vacio.');

  const defaultDiscountsById = Object.fromEntries(defaultDiscounts().map(d=>[d.id, d]));
  const rawDiscountsById = Object.fromEntries((Array.isArray(raw.discounts)?raw.discounts:[]).filter(d=>d&&typeof d.id==='string').map(d=>[d.id, d]));
  if(!Array.isArray(raw.discounts) && raw.discounts!==undefined) warnings.push('discounts: no es un arreglo — se uso el catalogo completo por defecto.');
  const discounts = Object.values(defaultDiscountsById).map(def=>normalizeDiscount(rawDiscountsById[def.id], def, warnings));
  const knownDiscountIds = new Set(discounts.map(d=>d.id));
  (Array.isArray(raw.discounts)?raw.discounts:[]).forEach(d=>{
    if(d && typeof d.id==='string' && !knownDiscountIds.has(d.id)) warnings.push(`discounts: id desconocido "${d.id.slice(0,40)}" descartado.`);
  });

  const rawChannelsById = Object.fromEntries((Array.isArray(raw.channels)?raw.channels:[]).filter(c=>c&&typeof c.id==='string').map(c=>[c.id, c]));
  if(!Array.isArray(raw.channels) && raw.channels!==undefined) warnings.push('channels: no es un arreglo — se uso el catalogo completo por defecto.');
  const channels = CHANNELS.map(def=>normalizeChannel(rawChannelsById[def.id], def, warnings));

  const ceilings = {};
  WINDOWS.forEach(w=>{
    const rawCeil = raw.ceilings && typeof raw.ceilings==='object' ? raw.ceilings[w.id] : undefined;
    ceilings[w.id] = rawCeil===undefined ? w.ceil : pctField({v:rawCeil}, 'v', w.ceil, warnings, `ceilings.${w.id}`, {min:0, max:100});
  });

  const costBreakdown = normalizeCostBreakdown(raw.costBreakdown, warnings);
  const lmConfig = normalizeLmConfig(raw.lmConfig, warnings);
  const verification = normalizeVerification(raw.verification, warnings);
  const monthlyIncomeScenario = normalizeMonthlyIncomeScenario(raw.monthlyIncomeScenario, warnings);
  const monthlyDistribution = normalizeMonthlyDistribution(raw.monthlyDistribution, warnings);

  const state = {
    name,
    currency: (raw.currency==='COP') ? 'COP' : 'USD',
    fixedCost: nonNegField(raw, 'fixedCost', 32, warnings, 'unidad', {min:0}),
    varCost: nonNegField(raw, 'varCost', 22, warnings, 'unidad', {min:0}),
    margin: pctField(raw, 'margin', 45, warnings, 'unidad', {min:0, max:95}),
    marketWindow: nonNegField(raw, 'marketWindow', 16, warnings, 'unidad', {min:0}),
    marketBase: nonNegField(raw, 'marketBase', 100, warnings, 'unidad', {min:0}),
    avgNights: nonNegField(raw, 'avgNights', 3, warnings, 'unidad', {min:1}),
    matrixNights: nonNegField(raw, 'matrixNights', 1, warnings, 'unidad', {min:1}),
    costBreakdown, channels, discounts, ceilings, lmConfig, verification,
    monthlyIncomeScenario, monthlyDistribution,
    id: (typeof raw.id==='string' && raw.id) ? raw.id : undefined
  };
  return {state, warnings};
}

export function newUnitId(){
  if(typeof crypto!=='undefined' && typeof crypto.randomUUID==='function') return crypto.randomUUID();
  // Fallback (entornos sin crypto.randomUUID) — no criptografico, solo necesita
  // ser unico en la practica para esta app de un solo usuario/navegador.
  return 'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2, 10);
}

export function v3Key(id){ return 'v3:'+id; }

/* Envuelve el estado de una unidad para guardar bajo v3 — agrega metadatos de
   identidad/version SIN tocar ningun campo de negocio del estado. */
export function buildV3Record(state, {id, migratedFromV2Key} = {}){
  return {
    ...state,
    id: id || state.id || newUnitId(),
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    ...(migratedFromV2Key ? {migratedFromV2Key} : {})
  };
}

/* Valida la FORMA de un archivo de respaldo antes de escribirlo a storage —
   nunca confia ciegamente en JSON.parse(archivo). Solo verifica estructura
   (arreglo `units` de {key,value} con value siendo JSON de una unidad valida
   con `name`), no valida el contenido de negocio en detalle (eso lo hace
   validate.js al renderizar). Devuelve unicamente los items con forma correcta;
   los invalidos se reportan en `errors` y se descartan, no se escriben. */
export function validateImportFile(data){
  const errors = [];
  if(!data || typeof data!=='object'){
    return {valid:false, errors:['El archivo no es un JSON valido de respaldo.'], items:[]};
  }
  const rawItems = Array.isArray(data.units) ? data.units : null;
  if(!rawItems){
    return {valid:false, errors:['El archivo no tiene un arreglo "units" — no parece un respaldo generado por Exportar.'], items:[]};
  }
  const items = [];
  rawItems.forEach((it, i) => {
    if(!it || typeof it.key!=='string' || typeof it.value!=='string'){
      errors.push(`Elemento ${i}: falta "key" o "value" de tipo texto.`); return;
    }
    if(!it.key.startsWith('v2:') && !it.key.startsWith('v3:')){
      errors.push(`Elemento ${i}: la clave "${it.key}" no tiene un prefijo reconocido (v2:/v3:).`); return;
    }
    let parsed;
    try{ parsed = JSON.parse(it.value); }
    catch(e){ errors.push(`Elemento ${i} (${it.key}): "value" no es JSON valido.`); return; }
    if(!parsed || typeof parsed!=='object' || typeof parsed.name!=='string'){
      errors.push(`Elemento ${i} (${it.key}): no tiene la forma de una unidad guardada (falta "name").`); return;
    }
    items.push({key: it.key, value: it.value});
  });
  return {valid: items.length>0, errors, items};
}
