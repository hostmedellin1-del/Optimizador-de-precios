# Changelog

Todo el trabajo de este changelog vive en la rama `fix/motor-financiero-auditoria`
(no mergeado a `main`, sin push, pendiente de tu revisión). Formato: fase de la
auditoría técnica → qué cambió → por qué.

## [0.2.0] — Auditoría técnica (Fases 1-7)

### Fase 1 — Modularización
Extracción de `index.html` (un solo archivo) a módulos ES (`src/domain/*`,
`src/catalog/*`), sin build step. `package.json` nuevo solo para `type:module`
y scripts de test/lint. Cero cambio de comportamiento (verificado antes/después
en navegador). `node --test` reemplaza los `node -e` ad hoc.

### Fase 2 — Corrección del motor (P1/P3/P4)
- `worstNative()` pasó de muestrear un punto medio por ventana a enumerar
  exhaustivamente los días/noches críticos (`thresholds.js`) — antes podía no
  detectar un early-bird de 90 días o una promo de día 0.
- `quoteScenario()` (nuevo, `quote.js`): fuente única de verdad para cotizar un
  escenario — la usan el Piso (evidencia), las alertas PISO/TECHO y el Simulador.
- El Simulador dejó de usar un punto medio sintético para el LM; usa los
  días/noches reales que Dani escribe.

### Fase 2.1 — Precisión y cobertura de ventana
- Eliminado el uso de `totalPct` (redondeado a 1 decimal) en cualquier cálculo
  financiero — todo pasa a `factor` exacto. Caso real: Genius 0.1% + Mobile 50%
  da 50.05% exacto; el redondeo daba 50.0% y dejaba el Piso corto.
- Eliminado el punto medio (`Math.min(w.lo+1,w.hi)`) en alertas y en la matriz —
  ahora enumeran los días críticos reales dentro de cada ventana.
- Matriz y "neto estimado" por canal migrados a `quoteScenario()` — cero
  fórmula financiera duplicada fuera de la fuente única.

### Fase 3 — Costo por reserva, margen vs. markup
- `reservationCost()` implementado: limpieza/lavandería/insumos se cargan UNA
  VEZ por reserva (según las noches reales), no diluidos por una estadía
  promedio fija — bug P5/P13 corregido y documentado explícitamente contra el
  modelo legado (`tests/reservation-cost-legacy.test.js`).
- `quoteScenario()`/`compute()` usan el costo real por reserva cuando la
  calculadora de costos detallada está llena; si no, caen al modelo simple de
  siempre (compatibilidad).
- Nuevo `markupPct` (ganancia sobre costo) además de `marginPct` (ganancia
  sobre venta) — son números distintos, mostrados por separado en el Simulador.

### Fase 4 — Reglas OTA configurables + verificación
- Descuento no reembolsable de Airbnb: capa apilable POST-promo, apagada/0%/no
  verificada por defecto.
- PriceLabs Last-Minute configurable por unidad, 5 modos (automático, plano,
  gradual, precio fijo, tramos con política de solape explícita) —
  `src/domain/pricelabs-lm.js`.
- Registro de Verificado/No-verificado por unidad (`verification.js`) para los
  hechos que no se pueden confirmar sin revisar la cuenta real.

### Fase 5 — Validación y bloqueo
- `validate.js`: costos/comisiones/offsets inválidos se detectan y explican;
  `compute()` devuelve `valid`/`errors` — un resultado no confiable (NaN,
  Infinity, negativo) se BLOQUEA en la UI en vez de mostrarse como si fuera
  una recomendación real.
- Aviso explícito cuando los costos siguen en el valor de ejemplo (webinar),
  no en datos reales de la unidad.

### Fase 6 — Persistencia robusta
- Identidad estable por UUID (`v3:<uuid>`) en vez de solo el slug del nombre —
  ya no colisiona si dos unidades comparten nombre o si se renombra una.
- Migración v2→v3 explícita (botón "Migrar unidades antiguas"), nunca
  automática — y nunca borra ni toca los registros `v2:*` originales.
- Importación validada por forma antes de escribir a storage
  (`persistence.js`); confirmación explícita antes de eliminar o de sobrescribir
  una unidad con el mismo nombre (antes, Eliminar no pedía confirmación).
- Escape de HTML (`sanitize.js`) en todo el renderizado que usa nombres/notas
  de descuentos, canales o unidades — corrige una vulnerabilidad XSS real vía
  datos guardados/importados.

### Fase 7 — CI, documentación, accesibilidad
- CI en GitHub Actions (`npm test` + `npm run lint`), Node 20, no afecta el
  despliegue de Pages.
- `aria-label` en los controles nuevos sin texto visible (editor de tramos).
- `RUNBOOK.md` (checklist de QA manual, rollback, despliegue).

## [0.1.0] — Estado previo a la auditoría
App de una sola página (`index.html`), sin tests automatizados, sin CI.
