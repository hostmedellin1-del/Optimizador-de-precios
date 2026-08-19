import {test, expect} from '@playwright/test';

async function setNumber(page, selector, value){
  const input=page.locator(selector);
  await input.click();
  await input.fill(String(value));
  await input.dispatchEvent('change');
}

test('Booking Preferred Partner eleva el Piso y aparece como comisión separada en el Simulador', async ({page})=>{
  await page.goto('/index.html');

  // Sacar la unidad de los valores de ejemplo y hacer verificable el LM.
  await setNumber(page, '[data-k="fixedCost"]', 40);
  await setNumber(page, '[data-k="varCost"]', 25);
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lm="verified"]').check();
  await expect(page.locator('#kFloor')).not.toHaveText('—');

  const floorBefore=Number((await page.locator('#kFloor').innerText()).replace(/[^0-9.-]/g,''));
  await page.locator('[data-tabbtn="ch-booking"]').click();
  const preferred=page.locator('[data-chid="booking"][data-chf="preferredPct"]');
  await expect(preferred).toHaveValue('0');
  await setNumber(page, '[data-chid="booking"][data-chf="preferredPct"]', 5);
  const floorAfter=Number((await page.locator('#kFloor').innerText()).replace(/[^0-9.-]/g,''));
  expect(floorAfter).toBeGreaterThan(floorBefore);

  await page.locator('[data-tabbtn="simulador"]').click();
  await setNumber(page, '#simPrice', 200);
  await page.locator('#simChannel').selectOption('booking');
  await expect(page.locator('#simResult')).toContainText('Alojamientos preferentes');
  await expect(page.locator('#simResult')).toContainText('comisión adicional');
});
