import {test, expect} from '@playwright/test';

async function openPromotionLab(page){
  await page.locator('#promotionLabSection > summary').click();
  await page.locator('#promotionLab .promo-editor > summary').click();
}

test('Simulador de descuento máximo: muestra el peor grupo posible por OTA sin sumar promociones imposibles', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#promotionLabSection > summary').click();

  await expect(page.locator('#promotionLab')).toContainText('El peor descuento posible para cada OTA');
  await expect(page.locator('#promotionLab')).toContainText('Booking.com');
  await expect(page.locator('#promotionLab')).toContainText('Genius (constante) + Mobile Rate');
  await expect(page.locator('#promotionLab')).toContainText('Offset de compensación en Kunas');
  await expect(page.locator('#promotionLab')).toContainText('+57.8%');
  await expect(page.locator('#promotionLab')).toContainText('Airbnb aplica una sola promoción principal por noche');
  await expect(page.locator('#promotionLab .promo-editor')).not.toHaveAttribute('open', '');
});

test('Probador de promociones: probar no modifica la unidad; Aplicar sí guarda la promo y el Offset elegido', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);

  const offset = page.locator('input[data-chid="airbnb"][data-chf="offsetPct"]');
  await expect(offset).toHaveValue('0');
  await expect(page.locator('#promotionLabSection')).toContainText('Prueba una idea antes de aplicarla');

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
  await expect(page.locator('#promotionLab')).toContainText('Last-minute 2');
});

test('Probador de promociones: la tabla muestra que una promoción puede aplicar distinto según las noches', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);
  await page.locator('#promoLabDiscount').selectOption('ab_los1');
  await page.locator('#promoLabPct').fill('15');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoLabMinN').fill('3');
  await page.locator('#promoLabMinN').press('Tab');

  await page.locator('#promotionLab .promo-detail summary').click();
  const rows = page.locator('#promotionLab .promo-detail tbody').locator('tr');
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('No');
  await expect(rows.nth(2).locator('td').nth(1)).toHaveText('Sí');
});

test('Probador de promociones: explica qué descuentos se suman y cuáles compiten', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);
  await page.locator('#promoLabChannel').selectOption('booking');
  await page.locator('#promoLabDiscount').selectOption('bk_lmd');
  await page.locator('#promoLabPct').fill('15');
  await page.locator('#promoLabPct').press('Tab');

  await expect(page.locator('#promotionLab')).toContainText('PROMOS APLICADAS');
  await expect(page.locator('#promotionLab')).toContainText('Genius (constante)');
  await expect(page.locator('#promotionLab')).toContainText('Mobile Rate');
  await expect(page.locator('#promotionLab')).toContainText('Last-Minute Deal');
});

test('Probador de promociones: permite agregar una segunda promoción a la misma prueba', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);
  await page.locator('#promoLabChannel').selectOption('booking');
  await page.locator('#promoLabDiscount').selectOption('bk_lmd');
  await page.locator('#promoLabPct').fill('15');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoAddBtn').click();
  await expect(page.locator('#promoLabDiscount-1')).toBeVisible();
  await page.locator('#promoLabDiscount-1').selectOption('bk_los1');
  await page.locator('#promoLabPct-1').fill('10');
  await page.locator('#promoLabPct-1').press('Tab');
  await page.locator('#promoLabMinN-1').fill('3');
  await page.locator('#promoLabMinN-1').press('Tab');

  await expect(page.locator('#promotionLab')).toContainText('Duración de estadía A (≥7 noches)');
  await expect(page.locator('#promotionLab')).toContainText('Last-Minute Deal');
});

test('Probador de promociones: un mismo precio de PriceLabs entrega Offsets de Kunas separados por OTA', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);
  await page.locator('#promoLabPct').fill('20');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoAddBtn').click();
  await page.locator('#promoLabChannel-1').selectOption('booking');
  await page.locator('#promoLabDiscount-1').selectOption('bk_lmd');
  await page.locator('#promoLabPct-1').fill('15');
  await page.locator('#promoLabPct-1').press('Tab');

  await expect(page.locator('#promotionLab')).toContainText('Offsets de Kunas sugeridos con este precio común de PriceLabs');
  const table=page.locator('#promotionLab .promo-table').first();
  await expect(table).toContainText('Airbnb');
  await expect(table).toContainText('Booking.com');
  await expect(table).toContainText('Offset no perder');
});

test('Probador de promociones: al aplicar, guarda cada promoción y cada Offset de Kunas en su OTA', async ({page}) => {
  await page.goto('/index.html');
  await openPromotionLab(page);
  const airbnbOffset=page.locator('input[data-chid="airbnb"][data-chf="offsetPct"]');
  const bookingOffset=page.locator('input[data-chid="booking"][data-chf="offsetPct"]');
  await expect(airbnbOffset).toHaveValue('0');
  await expect(bookingOffset).toHaveValue('0');

  await page.locator('#promoLabPct').fill('20');
  await page.locator('#promoLabPct').press('Tab');
  await page.locator('#promoAddBtn').click();
  await page.locator('#promoLabChannel-1').selectOption('booking');
  await page.locator('#promoLabDiscount-1').selectOption('bk_lmd');
  await page.locator('#promoLabPct-1').fill('15');
  await page.locator('#promoLabPct-1').press('Tab');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-promo-apply="cost"]').click();

  await expect(page.locator('input[data-did="ab_lm2"][data-f="on"]')).toBeChecked();
  await expect(page.locator('input[data-did="bk_lmd"][data-f="on"]')).toBeChecked();
  await expect(airbnbOffset).not.toHaveValue('0');
  await expect(bookingOffset).not.toHaveValue('0');
});
