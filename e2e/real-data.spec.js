/* Preparación para uso operativo con datos reales (revisión externa):
   reconciliación de reservas reales, contrato de moneda, y auditoría de
   datos reales. Prueba en un navegador real que:
   1. Reconciliar una reserva real igual al estimado muestra diferencia cero.
   2. Una comisión real distinta muestra la diferencia y la causa.
   3. Un payout real menor al estimado muestra una alerta clara.
   4. Monedas distintas sin FX verificado bloquean la conciliación.
   5. Un tipo de cambio verificado permite la conciliación.
   6. Guardar/borrar una conciliación funciona y nunca cambia comisiones.
   7. El checklist de auditoría refleja el estado real de la unidad.
   8. Los bloqueos previos de Piso/Base/LM/fixed_price/readiness siguen
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

test('reconciliación: moneda distinta a la de la unidad SIN tipo de cambio verificado bloquea la comparación', async ({page}) => {
  await page.goto('/index.html');
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  await fillField(page, '#recPayoutReceived', '400000');
  await page.selectOption('#recCurrency', 'COP');
  const result = page.locator('#reconcileResult');
  await expect(result).toContainText('MONEDA SIN CONVERSIÓN — BLOQUEADO');
  await expect(result).toContainText('VERIFICADO');
});

test('moneda: configurar un tipo de cambio verificado permite la conciliación en otra moneda', async ({page}) => {
  await page.goto('/index.html');
  // Airbnb liquida en COP (distinto a la unidad, USD por defecto)
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await page.selectOption('select[data-ch-currency="airbnb"]', 'COP');

  await page.locator('[data-tabbtn="resumen"]').click();
  await expect(page.locator('#fxRatesList')).toContainText('COP');

  const rateInput = page.locator('input[data-fx-rate="COP"]');
  await rateInput.click(); await rateInput.fill('0.00025'); await rateInput.dispatchEvent('change');
  await page.selectOption('select[data-fx-status="COP"]', 'verificado');

  await page.selectOption('#recChId', 'airbnb');
  await fillField(page, '#recPrice', '150');
  await fillField(page, '#recNights', '3');
  await fillField(page, '#recDays', '20');
  await page.selectOption('#recCurrency', 'COP');
  await fillField(page, '#recPayoutReceived', '400000');

  const result = page.locator('#reconcileResult');
  await expect(result).not.toContainText('BLOQUEADO');
  await expect(result).toContainText('REFERENCIA');
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
