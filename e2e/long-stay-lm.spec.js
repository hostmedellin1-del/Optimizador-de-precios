/* La exclusión de LM es exclusiva del peor caso. El Simulador cotiza la
   reserva que el usuario escribe y debe conservar el Last-Minute real aunque
   sean 28+ noches. */
import {test, expect} from '@playwright/test';

test('Simulador: día 0 y 34 noches conserva LM gradual configurado', async ({page}) => {
  await page.goto('/index.html');

  await page.selectOption('[data-lm="mode"]', 'gradual');
  await page.locator('[data-lmf="gradual.on"]').check();
  const maxPct = page.locator('[data-lmf="gradual.maxPct"]');
  await maxPct.click(); await maxPct.fill('28'); await maxPct.dispatchEvent('change');
  const days = page.locator('[data-lmf="gradual.days"]');
  await days.click(); await days.fill('6'); await days.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();

  await page.locator('[data-tabbtn="simulador"]').click();
  const price = page.locator('#simPrice');
  await price.click(); await price.fill('200'); await price.dispatchEvent('change');
  const simDays = page.locator('#simDays');
  await simDays.click(); await simDays.fill('0'); await simDays.dispatchEvent('change');
  const simNights = page.locator('#simNights');
  await simNights.click(); await simNights.fill('34'); await simNights.dispatchEvent('change');

  await expect(page.locator('#simResult')).toContainText('LM PriceLabs 28%');
  await expect(simDays).toHaveValue('0');
  await expect(simNights).toHaveValue('34');
});
