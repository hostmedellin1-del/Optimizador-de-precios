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
export const SCHEMA_VERSION = 3;

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
