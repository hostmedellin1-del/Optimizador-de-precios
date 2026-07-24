/* Bloqueante MEDIO (revision externa, ronda 2) — la edicion MANUAL (no solo la
   importacion) seguia usando `parseFloat(t.value)||0`: un valor invalido se
   convertia en 0 en silencio. src/domain/input-parse.js + los handlers de
   index.html (ver tests/fase-input-validation.test.js para la parte pura)
   cierran esto. Este spec prueba la integracion real con el input del
   navegador: el valor invalido NUNCA se escribe, el campo vuelve a mostrar el
   ultimo valor valido, y aparece un aviso visible con el motivo exacto — en
   cualquier pestaña, no solo en Resumen. */
import {test, expect} from '@playwright/test';

test('descuento: % fuera de rango (150) se rechaza, conserva el valor anterior, muestra aviso', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  const pctInput = page.locator('[data-did="ab_los4"][data-f="pct"]');
  const before = await pctInput.inputValue();
  await pctInput.fill('150');
  await pctInput.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(page.locator('#inputErrorToast')).toContainText('no puede ser mayor');
  await expect(pctInput).toHaveValue(before);
});

test('descuento: rango de días invertido ("desde" > "hasta") se rechaza con motivo explícito', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  // "Promoción personalizada" está apagada por defecto -> vive en el catálogo colapsado.
  await page.locator('.tab-panel[data-tab="ch-airbnb"] .discounts-more summary').click();
  // "Promoción personalizada": kind window, SIN lockN — desde/hasta son inputs reales.
  const fromInput = page.locator('[data-did="ab_cus"][data-f="from"]');
  const toInput = page.locator('[data-did="ab_cus"][data-f="to"]');
  await expect(fromInput).toBeVisible({timeout: 5000});
  const beforeFrom = await fromInput.inputValue();
  await toInput.fill('3');
  await toInput.dispatchEvent('change');
  await fromInput.fill('10');
  await fromInput.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toContainText('no puede ser mayor');
  await expect(fromInput).toHaveValue(beforeFrom);
});

test('canal: offset negativo extremo (-500) se rechaza — el input nunca deja escribir un offset que rompería el precio', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-booking"]').click();
  const off = page.locator('[data-chid="booking"][data-chf="offsetPct"]');
  const before = await off.inputValue();
  await off.fill('-500');
  await off.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(off).toHaveValue(before);
  // Un offset negativo RAZONABLE (dentro de rango) sí debe aceptarse — el Offset
  // permite negativos a propósito (bajar precio para competir en un canal).
  await off.fill('-15');
  await off.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeHidden();
  await expect(off).toHaveValue('-15');
  // limpieza
  await off.fill(before || '0');
  await off.dispatchEvent('change');
});

test('LM tramos: "desde día" mayor que "hasta día" se rechaza con motivo explícito', async ({page}) => {
  await page.goto('/index.html');
  await page.selectOption('[data-lm="mode"]', 'tiers');
  await page.locator('#addTierBtn').click();
  const fromDay = page.locator('[data-tier="fromDay"][data-tier-idx="0"]');
  const toDay = page.locator('[data-tier="toDay"][data-tier-idx="0"]');
  await expect(fromDay).toBeVisible();
  await toDay.fill('3');
  await toDay.dispatchEvent('change');
  await fromDay.fill('10');
  await fromDay.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(page.locator('#inputErrorToast')).toContainText('no puede ser mayor');
  await expect(fromDay).toHaveValue('0');
});

test('costo: texto no numérico en Costo fijo se rechaza, no se convierte en 0 silenciosamente', async ({page}) => {
  await page.goto('/index.html');
  const fixedCost = page.locator('[data-k="fixedCost"]');
  const before = await fixedCost.inputValue();
  expect(before).not.toBe('0');
  // Un <input type="number"> real bloquea letras al escribir — para simular un
  // valor imposible que SI puede llegar via teclado (borrar todo el campo),
  // probamos el caso vacío: debe rechazarse, no volverse 0.
  await fixedCost.fill('');
  await fixedCost.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(page.locator('#inputErrorToast')).toContainText('no puede quedar vacío');
  await expect(fixedCost).toHaveValue(before);
  await expect(page.locator('#kCost')).not.toHaveText('USD 0');
});

test('un valor VÁLIDO limpia el aviso anterior', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-booking"]').click();
  const comm = page.locator('[data-chid="booking"][data-chf="comm"]');
  await comm.fill('150');
  await comm.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await comm.fill('18');
  await comm.dispatchEvent('change');
  await expect(page.locator('#inputErrorToast')).toBeHidden();
});
