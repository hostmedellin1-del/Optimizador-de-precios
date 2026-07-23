/* Bloqueante P2 (revision externa, ronda 3) — bypass al bloqueo de LM desde
   el botón "Ver el paso a paso de una reserva" (goSimBtn). Aunque
   `model.lmBlocked`/`model.baseBlocked` ocultan Base Price en Resumen/Matriz,
   el handler de este botón hacía
   `simPrice.value = Math.round(model.base || model.effBase || 0)` sin
   condición — precargaba y usaba el número BLOQUEADO como si fuera una
   recomendación válida, revelándolo por la puerta de atrás. Corregido: con
   el modelo bloqueado, el botón NO precarga ningún precio, muestra una
   explicación (toast + mensaje en el propio Simulador) y deja la simulación
   manual disponible (escribiendo un precio a mano) claramente separada de
   cualquier recomendación automática.

   Fase 5 (revision externa — "datos financieros verificados"): Base Price
   ahora tiene un segundo gate ortogonal a LM (ver src/domain/readiness.js) —
   resolveAllFinancialFacts() aisla el comportamiento de LM/bypass bajo
   prueba dejando esos otros datos ya resueltos. */
import {test, expect} from '@playwright/test';

async function resolveAllFinancialFacts(page){
  await page.locator('[data-tabbtn="resumen"]').click();
  await page.selectOption('select[data-verif-status="hospyOffsetIsolated"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="bookingGeniusMobileBoth"]', 'verificado');
  await page.selectOption('select[data-verif-status="expediaVipTierMix"]', 'verificado');
  await page.selectOption('select[data-verif-status="airbnbNonRefundable"]', 'no_aplica');
  for(const chId of ['airbnb','booking','expedia','direct']){
    await page.selectOption(`select[data-verif-status="bankFeePctByChannel"][data-verif-ch="${chId}"]`, 'no_aplica');
  }
}

test('config por defecto (LM sin verificar): el botón del Simulador NO precarga Base Price bloqueado', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#kBase')).toHaveText('—'); // confirma que arranca bloqueado

  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(page.locator('#inputErrorToast')).toContainText('Base Price está bloqueado');

  const simText = await page.locator('#simResult').innerText();
  expect(simText).toContain('No hay un precio para simular todavía');
  expect(simText).not.toMatch(/De USD [\d.,]+ que puso PriceLabs/, 'no debe renderizar un waterfall con un precio inventado');
});

test('con LM fixed_price activo en el día de referencia (baseBlocked), el botón tampoco precarga nada', async ({page}) => {
  await page.goto('/index.html');
  const fc = page.locator('[data-k="fixedCost"]');
  await fc.click(); await fc.fill('100'); await fc.dispatchEvent('change');
  await page.selectOption('[data-lm="mode"]', 'fixed_price');
  const price = page.locator('[data-lmf="fixedPrice.price"]');
  await price.click(); await price.fill('150'); await price.dispatchEvent('change');
  const toDay = page.locator('[data-lmf="fixedPrice.toDay"]');
  await toDay.click(); await toDay.fill('50'); await toDay.dispatchEvent('change');
  const fromDay = page.locator('[data-lmf="fixedPrice.fromDay"]');
  await fromDay.click(); await fromDay.fill('40'); await fromDay.dispatchEvent('change');
  await page.locator('[data-lmf="fixedPrice.on"]').check();
  await page.locator('[data-lm="verified"]').check();
  await expect(page.locator('#kBase')).toHaveText('—');

  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('');
  await expect(page.locator('#inputErrorToast')).toContainText('precio LM fijo de PriceLabs activo');
  const simText = await page.locator('#simResult').innerText();
  expect(simText).toContain('No hay un precio para simular todavía');
});

test('una vez el LM está verificado (no bloqueado), el botón SÍ precarga Base Price normalmente', async ({page}) => {
  await page.goto('/index.html');
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  const pct = page.locator('[data-lmf="flat.pct"]');
  await pct.click(); await pct.fill('20'); await pct.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();
  await resolveAllFinancialFacts(page);
  await expect(page.locator('#kBase')).not.toHaveText('—');

  await page.locator('#goSimBtn').click();
  const simPriceValue = await page.locator('#simPrice').inputValue();
  expect(simPriceValue).not.toBe('');
  expect(Number(simPriceValue)).toBeGreaterThan(0);
  const simText = await page.locator('#simResult').innerText();
  expect(simText).toMatch(/De USD [\d.,]+ que puso PriceLabs/);
});

test('simulación manual sigue disponible incluso bloqueado: escribir un precio a mano SÍ calcula el waterfall', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('');

  const simPrice = page.locator('#simPrice');
  await simPrice.click();
  await simPrice.fill('250');
  await simPrice.dispatchEvent('change');

  const simText = await page.locator('#simResult').innerText();
  expect(simText).toMatch(/De USD 250 que puso PriceLabs/);
  expect(simText).not.toContain('No hay un precio para simular todavía');
});
