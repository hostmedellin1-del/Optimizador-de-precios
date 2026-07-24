/* Fase 6 — escape de HTML para cualquier texto que venga del catalogo/estado
   (nombre de descuento, nota, nombre de canal, nombre de unidad) y termine
   interpolado dentro de un innerHTML. Ese texto puede venir de un archivo de
   respaldo IMPORTADO (ver persistence.js) — no es codigo de la app, es dato,
   y debe tratarse como no confiable en cuanto se renderiza como HTML. */
export function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}
