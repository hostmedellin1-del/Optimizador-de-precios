import {test, expect} from '@playwright/test';

test('Probador de promociones: probar no modifica la unidad; Aplicar sí guarda la promo y el Offset elegido', async ({page}) => {
  await page.goto('/index.html');

  const offset = page.locator('input[data-chid="airbnb"][data-chf="offsetPct"]');
  await expect(offset).toHaveValue('0');
  await expect(page.locator('#promotionLabSection')).toContainText('prueba una idea sin cambiar tu configuración guardada');

  /* Forzar un escenario donde el descuento sí exige compensación: no basta con
     pintar un resultado, comprobamos que el borrador no altere state todavía. */
  await page.locator('#promoLabPct').fill('30');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoLabPrice').fill('60');
  await page.locator('#promoLabPrice').press('Tab');

  await expect(page.locator('#promotionLab')).toContainText('Offset para no perder');
  await expect(offset).toHaveValue('0');
  await expect(page.locator('input[data-did="ab_lm2"][data-f="on"]')).not.toBeChecked();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-promo-apply="cost"]').click();

  await expect(page.locator('input[data-did="ab_lm2"][data-f="on"]')).toBeChecked();
  await expect(offset).not.toHaveValue('0');
  await expect(page.locator('#promotionLab')).toContainText('30.0%');
});

test('Probador de promociones: la tabla muestra que una promoción puede aplicar distinto según las noches', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#promoLabDiscount').selectOption('ab_los1');
  await page.locator('#promoLabPct').fill('15');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoLabMinN').fill('3');
  await page.locator('#promoLabMinN').press('Tab');

  const rows = page.locator('#promotionLab tbody').first().locator('tr');
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('No');
  await expect(rows.nth(2).locator('td').nth(1)).toHaveText('Sí');
});
