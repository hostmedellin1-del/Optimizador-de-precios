/* Helpers de porcentaje. Extraidos verbatim de index.html (Fase 1). Sin cambios de
   comportamiento: `pct` sigue recortando 0-95 silenciosamente y `pct2` sigue sin
   recortar (permite offsets negativos). Esa "correccion silenciosa" es exactamente
   uno de los hallazgos de la auditoria (P12/A29/A30) — se corrige en la Fase 5
   (validacion central), no aqui. Aqui solo se relocaliza el codigo tal cual estaba. */
export const pct = v => Math.min(Math.max(parseFloat(v) || 0, 0), 95);
export const pct2 = v => parseFloat(v) || 0;
