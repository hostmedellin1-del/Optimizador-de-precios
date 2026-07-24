/* Preparación para uso operativo con datos reales (revisión externa):
   reconciliación de reservas reales, y auditoría de datos reales. Simplificado
   a USD único (revisión externa posterior) — esta versión NO ofrece multimoneda:
   prueba en un navegador real que:
   1. Reconciliar una reserva real igual al estimado muestra diferencia cero.
   2. Una comisión real distinta muestra la diferencia y la causa.
   3. Un payout real menor al estimado muestra una alerta clara.
   4. No existe NINGÚN selector de moneda/FX visible en la UI.
   5. Una unidad vieja importada con moneda != USD queda "requiere revisión
      manual" y no muestra recomendaciones globales (Piso/Base/Matriz/Alertas).
   6. Una conciliación vieja importada con moneda != USD se muestra bloqueada,
      nunca como un resultado numérico falso.
   7. Guardar/borrar una conciliación funciona y nunca cambia comisiones.
   8. El checklist de auditoría refleja el estado real de la unidad.
   9. Los bloqueos previos de Piso/Base/LM/fixed_price/readiness siguen
      funcionando exactamente igual con las secciones nuevas presentes. */
import {test, expect} from '@playwright/test';

async function fillField(page, selector, value){
  const loc = page.locator(selector);
  await loc.click();
  await loc.fill(value);
  await loc.dispatchEvent('change');
}

test('reconciliación: reserva real IGUAL al estimado muestra diferencia cero y "CONFIABLE"', async ({page}) => {
  await page.goto('/index.html');
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  // reconcileReservation() exige payoutReceived antes de mostrar el estimado —
  // se llena un valor cualquiera primero solo para leer "Estimado USD X" del
  // resultado, y luego se usa ESE mismo número como el "real" para forzar
  // diferencia cero (equivalente a copiar el payout real de una liquidación
  // que coincide exacto con el motor).
  const result = page.locator('#reconcileResult');
  await fillField(page, '#recPayoutReceived', '1');
  const text0 = await result.innerText();
  const match = text0.match(/Estimado\s+USD\s+([\d.,]+)/);
  expect(match, `debe mostrar un estimado numérico: ${text0}`).not.toBeNull();
  const estimado = match[1].replace(/,/g, '');
  await fillField(page, '#recPayoutReceived', estimado);
  await expect(result).toContainText('CONFIABLE');
  await expect(result).toContainText('Diferencia USD 0');
});

test('reconciliación: comisión OTA real distinta de la configurada aparece en el desglose y como causa', async ({page}) => {
  await page.goto('/index.html');
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  await fillField(page, '#recPayoutReceived', '50'); // muy por debajo, fuerza una diferencia grande
  await fillField(page, '#recOtaCommissionPct', '20');
  const result = page.locator('#reconcileResult');
  await expect(result).toContainText('Comisión OTA');
  await expect(result).toContainText('Posibles causas');
});

test('reconciliación: payout real MENOR al estimado (más de 10%) muestra una alerta clara (bad)', async ({page}) => {
  await page.goto('/index.html');
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  await fillField(page, '#recPayoutReceived', '10'); // muy bajo, garantiza >10% de diferencia negativa
  const result = page.locator('#reconcileResult');
  await expect(result.locator('.alert.bad')).toBeVisible();
});

test('Simplificación a USD único: no existe NINGÚN selector de moneda/FX/liquidación en la UI', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('[data-k="currency"]')).toHaveCount(0);
  await expect(page.locator('#recCurrency')).toHaveCount(0);
  await expect(page.locator('#fxRatesList')).toHaveCount(0);
  await expect(page.locator('[data-fx-rate]')).toHaveCount(0);
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await expect(page.locator('[data-ch-currency]')).toHaveCount(0);
  await page.locator('[data-tabbtn="resumen"]').click();
  await expect(page.locator('#currencyDisplay')).toHaveText('USD');
  await expect(page.locator('#usdOnlyNotice')).toContainText('Todos los valores deben ingresarse en USD');
});

/* Simplificación a USD único: una unidad VIEJA (de antes de esta ronda) puede
   tener quedado guardada en localStorage con currency='COP' — se importa vía
   el mecanismo real de la app (Exportar/Importar) para probar el camino
   realista, no inyectando `state` directamente. */
test('unidad vieja importada con moneda COP: banner "requiere revisión manual", Min Price/Base Price/Matriz/Alertas bloqueados', async ({page}) => {
  await page.goto('/index.html');
  let dialogFired = false;
  page.once('dialog', async dialog => { dialogFired = true; await dialog.accept(); });
  const payload = {
    exportedAt: new Date().toISOString(), schemaVersion: 3,
    units: [{key: 'v3:e2e-old-cop-unit', value: JSON.stringify({name: 'Unidad vieja COP', currency: 'COP'})}]
  };
  const buffer = Buffer.from(JSON.stringify(payload));
  await page.setInputFiles('#importUnitsFile', {name: 'old-cop.json', mimeType: 'application/json', buffer});
  await page.waitForTimeout(500);
  expect(dialogFired).toBe(true);

  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad vieja COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad vieja COP', {timeout: 5000});

  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#currencyReviewBanner')).toContainText('COP');
  await expect(page.locator('#currencyDisplay')).toContainText('COP');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('requiere revisión manual');

  await page.locator('[data-tabbtn="comparacion"]').click();
  await expect(page.locator('#matrixIntro')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#matrixBody tr')).toHaveCount(0);

  await page.locator('[data-tabbtn="resumen"]').click();
  const alertsText = await page.locator('.alerts').innerText().catch(()=>'');
  expect(alertsText.includes('RENTABLE') || alertsText.includes('OK')).toBe(false);

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('conciliación vieja importada con moneda != USD: se muestra bloqueada explícitamente, nunca un resultado numérico falso', async ({page}) => {
  await page.goto('/index.html');
  let dialogFired = false;
  page.once('dialog', async dialog => { dialogFired = true; await dialog.accept(); });
  const payload = {
    exportedAt: new Date().toISOString(), schemaVersion: 3,
    units: [{key: 'v3:e2e-old-cop-recon', value: JSON.stringify({
      name: 'Unidad con conciliación vieja en COP',
      reconciliations: [{chId:'airbnb', price:150, nights:3, days:20, payoutReceived:600000, currency:'COP', reference:'HM-OLD-001'}]
    })}]
  };
  const buffer = Buffer.from(JSON.stringify(payload));
  await page.setInputFiles('#importUnitsFile', {name: 'old-cop-recon.json', mimeType: 'application/json', buffer});
  await page.waitForTimeout(500);
  expect(dialogFired).toBe(true);

  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad con conciliación vieja en COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad con conciliación vieja en COP', {timeout: 5000});

  const list = page.locator('#reconciliationsList');
  await expect(list).toContainText('HM-OLD-001');
  await expect(list).toContainText('bloqueada por moneda');
  await expect(list).not.toContainText('diferencia'); // nunca muestra un % de diferencia falso para esta fila

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('reconciliación: guardar y borrar una conciliación funciona, y nunca cambia comisiones/descuentos configurados', async ({page}) => {
  await page.goto('/index.html');
  const commBefore = await page.locator('[data-chid][data-chf="comm"]').first().inputValue().catch(()=>null);
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  const commInput = page.locator('input[data-chid="airbnb"][data-chf="comm"]');
  const commBeforeVal = await commInput.inputValue();

  await page.locator('[data-tabbtn="resumen"]').click();
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  await fillField(page, '#recPayoutReceived', '100');
  await fillField(page, '#recOtaCommissionPct', '99'); // deliberadamente distinto — no debe tocar la config real
  await fillField(page, '#recReference', 'HM-TEST-001');
  await page.locator('#recSaveBtn').click();

  await expect(page.locator('#reconciliationsList')).toContainText('HM-TEST-001');

  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await expect(page.locator('input[data-chid="airbnb"][data-chf="comm"]')).toHaveValue(commBeforeVal);

  await page.locator('[data-tabbtn="resumen"]').click();
  page.on('dialog', d=>d.accept()); // por si acaso; el borrado de reconciliaciones no pide confirm hoy
  await page.locator('[data-rec-del]').first().click();
  await expect(page.locator('#reconciliationsList')).not.toContainText('HM-TEST-001');
});

test('auditoría: unidad nueva (costos de ejemplo) muestra estado SIMULACION', async ({page}) => {
  await page.goto('/index.html');
  const box = page.locator('#auditChecklist');
  await expect(box).toContainText('SIMULACION');
});

test('auditoría: con costos reales cargados pero nada más confirmado, el estado pasa a DATOS PARCIALES', async ({page}) => {
  await page.goto('/index.html');
  await fillField(page, '[data-k="fixedCost"]', '75');
  await fillField(page, '[data-k="varCost"]', '30');
  const box = page.locator('#auditChecklist');
  await expect(box).toContainText('DATOS PARCIALES');
});

test('regresión: las secciones nuevas no rompen los bloqueos existentes de Min Price/Base Price (LM sin verificar por defecto)', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('LM sin verificar');
});
