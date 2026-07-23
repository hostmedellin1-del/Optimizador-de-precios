/* Fase 5 (revision externa — "datos financieros verificados"): el codigo ya
   reconocia que ciertos datos (comision bancaria real, si Hospy aisla el
   Offset por canal, mezcla VIP de Expedia, Genius+Mobile de Booking,
   no-reembolsable de Airbnb) estaban "no verificados", pero ninguna vista lo
   usaba para bloquear nada — era una etiqueta, no una regla financiera. Este
   spec prueba en un navegador real que:
   1. El catalogo de fabrica (Genius+Mobile activos, VIP de Expedia activo,
      comision bancaria en Booking/Directo) bloquea Min Price/Base Price y el
      Offset sugerido de esos canales SOLO por estos datos, aunque LM ya este
      verificado — y que Airbnb (sin ninguno de estos activos) sigue usable.
   2. Confirmar un solo dato desbloquea solo lo que ese dato afecta.
   3. La Matriz nunca dice "RENTABLE EN TODOS" con un dato pendiente.
   4. El Simulador etiqueta la simulacion manual como no confiable mientras
      haya un supuesto sin confirmar, pero NUNCA bloquea la simulacion manual.
   5. El bypass del boton "Ver el paso a paso" tambien respeta este gate.
   6. Exportar/Importar conserva status/fuente/fecha/nota; un archivo
      malformado nunca marca nada como verificado ni rompe la app. */
import {test, expect} from '@playwright/test';

async function verifyLm(page){
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  const pct = page.locator('[data-lmf="flat.pct"]');
  await pct.click(); await pct.fill('20'); await pct.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();
}

test('catálogo de fábrica: con LM ya verificado, Min Price/Base Price siguen bloqueados por datos financieros pendientes (Genius+Mobile, VIP Expedia, comisión bancaria)', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);

  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('dato financiero sin verificar');
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kBaseWhy')).toContainText('dato financiero sin verificar');

  const banner = page.locator('#validationBanner');
  await expect(banner).toContainText('DATO FINANCIERO SIN VERIFICAR');
  await expect(banner.locator('button', {hasText: 'Ir a Verificación de datos financieros'}).first()).toBeVisible();
});

test('Booking: el Offset sugerido de su propia pestaña queda etiquetado no confiable por Genius+Mobile/comisión bancaria sin confirmar', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  await page.locator('[data-tabbtn="ch-booking"]').click();
  const hint = page.locator('.tab-panel[data-tab="ch-booking"] .offset-hint');
  await expect(hint).toContainText('NO son una recomendación confiable');
  await expect(hint).toContainText('Verificación de datos financieros');
});

test('confirmar SOLO un dato desbloquea solo lo que ese dato afecta — el resto sigue pendiente', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  // Confirma unicamente la mezcla VIP de Expedia.
  await page.selectOption('select[data-verif-status="expediaVipTierMix"]', 'verificado');

  await page.locator('[data-tabbtn="ch-expedia"]').click();
  await expect(page.locator('.tab-panel[data-tab="ch-expedia"] .offset-hint')).not.toContainText('NO son una recomendación confiable');

  // Booking sigue bloqueado — nunca se toco su propio dato pendiente.
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await expect(page.locator('.tab-panel[data-tab="ch-booking"] .offset-hint')).toContainText('NO son una recomendación confiable');
});

test('Matriz: ninguna fila dice "RENTABLE EN TODOS" mientras falte un dato financiero relevante, aunque LM ya esté verificado', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  await page.locator('[data-tabbtn="comparacion"]').click();
  const tags = await page.locator('#matrixBody .v-tag').allInnerTexts();
  expect(tags.length).toBeGreaterThan(0);
  for(const tag of tags){
    expect(tag.trim()).not.toBe('RENTABLE EN TODOS');
  }
});

test('Simulador: la simulación manual NUNCA se bloquea, pero se etiqueta "SIMULACIÓN NO CONFIABLE" mientras el canal elegido dependa de un dato sin confirmar', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  await page.locator('[data-tabbtn="simulador"]').click();
  await page.selectOption('#simChannel', 'booking'); // canal con datos pendientes (Genius+Mobile, comision bancaria)
  const simPrice = page.locator('#simPrice');
  await simPrice.click();
  await simPrice.fill('200');
  await simPrice.dispatchEvent('change');

  const text = await page.locator('#simResult').innerText();
  expect(text).toContain('SIMULACIÓN NO CONFIABLE');
  expect(text).toContain('no uses este resultado como recomendación automática');
  // La simulacion SI corre (no se bloquea) — el waterfall completo se muestra igual.
  expect(text).toMatch(/De USD 200 que puso PriceLabs/);
});

test('Simulador: Airbnb (sin datos pendientes en el catálogo de fábrica) NO muestra la etiqueta de no confiable una vez el LM está verificado', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  await page.locator('[data-tabbtn="simulador"]').click();
  await page.selectOption('#simChannel', 'airbnb');
  const simPrice = page.locator('#simPrice');
  await simPrice.click();
  await simPrice.fill('200');
  await simPrice.dispatchEvent('change');
  const text = await page.locator('#simResult').innerText();
  expect(text).not.toContain('SIMULACIÓN NO CONFIABLE');
});

test('bypass del botón "Ver el paso a paso": con LM verificado pero datos financieros pendientes, tampoco precarga Base Price', async ({page}) => {
  await page.goto('/index.html');
  await verifyLm(page);
  await expect(page.locator('#kBase')).toHaveText('—'); // confirma que sigue bloqueado (por datos, no por LM)

  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('');
  await expect(page.locator('#inputErrorToast')).toContainText('Base Price está bloqueado');
  await expect(page.locator('#inputErrorToast')).toContainText('dato financiero');
});

test('exportar/importar conserva status, fuente, fecha y nota de verificación exactamente', async ({page}) => {
  await page.goto('/index.html');
  await page.selectOption('select[data-verif-status="hospyOffsetIsolated"]', 'verificado');
  const sourceInput = page.locator('input[data-verif-source="hospyOffsetIsolated"]');
  await sourceInput.click(); await sourceInput.fill('chat de soporte Hospy #4521'); await sourceInput.dispatchEvent('change');
  const dateInput = page.locator('input[data-verif-date="hospyOffsetIsolated"]');
  await dateInput.fill('2026-07-15'); await dateInput.dispatchEvent('change');
  const noteInput = page.locator('input[data-verif-note="hospyOffsetIsolated"]');
  await noteInput.click(); await noteInput.fill('confirmado por escrito'); await noteInput.dispatchEvent('change');

  const name = 'E2E Verification Test ' + Date.now();
  await page.locator('#unitName').fill(name);
  await page.locator('#saveUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('Guardado', {timeout: 5000});

  await page.reload();
  await page.selectOption('#unitList', {label: name});
  await expect(page.locator('#unitName')).toHaveValue(name, {timeout: 5000});
  await expect(page.locator('select[data-verif-status="hospyOffsetIsolated"]')).toHaveValue('verificado');
  await expect(page.locator('input[data-verif-source="hospyOffsetIsolated"]')).toHaveValue('chat de soporte Hospy #4521');
  await expect(page.locator('input[data-verif-date="hospyOffsetIsolated"]')).toHaveValue('2026-07-15');
  await expect(page.locator('input[data-verif-note="hospyOffsetIsolated"]')).toHaveValue('confirmado por escrito');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('importar un archivo con verification malformado (status inventado, canal con string suelto) nunca marca nada como verificado ni rompe la app', async ({page}) => {
  await page.goto('/index.html');
  let dialogFired = false;
  page.once('dialog', async dialog => {
    dialogFired = true;
    await dialog.accept();
  });

  const payload = {
    exportedAt: new Date().toISOString(), schemaVersion: 3,
    units: [{key: 'v3:e2e-malformed-verification', value: JSON.stringify({
      name: 'Malformada',
      verification: {
        hospyOffsetIsolated: {status: 'CONFIA_EN_MI_TOTALMENTE', source: 123, date: 'no-es-fecha', note: {a:1}},
        bankFeePctByChannel: {booking: 'no soy un objeto', airbnb: null}
      }
    })}]
  };
  const buffer = Buffer.from(JSON.stringify(payload));
  await page.setInputFiles('#importUnitsFile', {name: 'malformed.json', mimeType: 'application/json', buffer});
  await page.waitForTimeout(500);
  expect(dialogFired).toBe(true);

  await page.reload();
  await page.selectOption('#unitList', {label: 'Malformada'});
  await expect(page.locator('#unitName')).toHaveValue('Malformada', {timeout: 5000});
  await expect(page.locator('select[data-verif-status="hospyOffsetIsolated"]')).toHaveValue('no_verificado');
  await expect(page.locator('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="booking"]')).toHaveValue('no_verificado');
  await expect(page.locator('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="airbnb"]')).toHaveValue('no_verificado');
  // La app sigue funcional (no se rompio con el import malformado) — el KPI renderiza algo, no explota.
  await expect(page.locator('#kCost')).toBeVisible();

  // limpieza
  const evilValue = await page.locator('#unitList option', {hasText: 'Malformada'}).getAttribute('value');
  await page.selectOption('#unitList', evilValue);
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});
