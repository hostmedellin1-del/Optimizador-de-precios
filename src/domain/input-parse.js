/* Bloqueante MEDIO (revision externa, ronda 2) — fuente unica de validacion
   para ediciones MANUALES de campos numericos. `normalizeUnit()`
   (persistence.js) ya protege la importacion, pero index.html seguia usando
   `parseFloat(t.value)||0` en cada handler de `change` — un valor invalido
   (texto, vacio, NaN) se convertia SILENCIOSAMENTE en 0, indistinguible de que
   Dani escribio 0 a proposito. Esto se repetia identico en ~10 lugares
   distintos (descuentos, canales, techos, costos, LM, tramos) — una formula
   de validacion duplicada, ademas del problema de fondo.

   parseValue() NUNCA inventa un 0: si el input no es un numero finito dentro
   del rango esperado, devuelve `ok:false` con el motivo exacto — el caller
   (index.html) debe conservar el valor anterior en el campo y en `state`, y
   mostrar ese motivo, nunca escribir el resultado invalido. */
export function parseValue(raw, {min=-Infinity, max=Infinity, integer=false, allowEmpty=false, emptyValue=0, label='Este campo'} = {}){
  const trimmed = String(raw??'').trim();
  if(trimmed===''){
    if(allowEmpty) return {ok:true, value: emptyValue};
    return {ok:false, reason: `${label}: no puede quedar vacío.`};
  }
  const n = Number(trimmed);
  if(!Number.isFinite(n)){
    return {ok:false, reason: `${label}: "${raw}" no es un número válido.`};
  }
  if(integer && !Number.isInteger(n)){
    return {ok:false, reason: `${label}: debe ser un número entero (sin decimales) — escribiste ${n}.`};
  }
  if(n<min){
    return {ok:false, reason: `${label}: no puede ser menor que ${min} — escribiste ${n}.`};
  }
  if(n>max){
    return {ok:false, reason: `${label}: no puede ser mayor que ${max} — escribiste ${n}.`};
  }
  return {ok:true, value:n};
}

/* Porcentaje: por defecto [0,100) — un descuento/comision/techo de 100% o mas
   no tiene sentido de negocio y casi siempre es un error de tecleo. `allowNegative`
   lo usa el Offset por canal (puede bajar precio para competir). */
export function parsePct(raw, {label='Este porcentaje', max=99.999, allowNegative=false} = {}){
  return parseValue(raw, {min: allowNegative ? -99.999 : 0, max, label});
}

/* Rango invertido: "desde" no puede ser mayor que "hasta". Se llama DESPUES de
   parsear ambos lados por separado — esta funcion solo compara. */
export function validateRange(from, to, label='El rango'){
  if(from>to) return {ok:false, reason: `${label}: "desde" (${from}) no puede ser mayor que "hasta" (${to}).`};
  return {ok:true};
}
