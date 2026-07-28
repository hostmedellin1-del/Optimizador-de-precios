import {test, expect} from '@playwright/test';

test('uso personal: los valores cargados calculan Min Price y precargan el simulador sin casillas de verificación', async ({page}) => {
  await page.goto('/index.html');

  await expect(page.locator('#kFloor')).toHaveText('USD 90');
  await expect(page.locator('#kFloorWhy')).toContainText('lo fija');
  await expect(page.locator('[data-floor-contract-confirmed]')).toHaveCount(0);
  await expect(page.locator('[data-lm="verified"]')).toHaveCount(0);
  await expect(page.locator('select[data-verif-status]')).toHaveCount(0);

  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('90');
  await expect(page.locator('#simResult')).toContainText('De los USD 90 finales que muestra PriceLabs');
});

test('costos detallados: elegir usarlos es una opción de cálculo, no un bloqueo de recomendación', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('summary', {hasText:'Calcular a partir de costos detallados'}).click();

  await expect(page.locator('#costBreakdownConfirmedChk')).toHaveAccessibleName('Usar estos costos detallados para calcular.');
  await expect(page.locator('#dataProvenanceBanner')).toBeEmpty();
  await expect(page.locator('#kFloor')).not.toHaveText('—');
});

test('guardar una unidad conserva el Min Price calculado sin pedir confirmaciones adicionales', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#unitName').fill('Prueba flujo directo');
  await page.locator('#saveUnit').click();

  await expect(page.locator('#unitList option', {hasText:'Prueba flujo directo'})).toHaveCount(1);
  await expect(page.locator('#kFloor')).toHaveText('USD 90');
  await expect(page.locator('#validationBanner')).toBeEmpty();
});
