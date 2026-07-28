/* Bloqueante — bypass al bloqueo de recomendaciones desde el botón
   "Ver el paso a paso de una reserva" (goSimBtn). Antes el handler usaba
   `model.base || model.effBase` sin condición y podía revelar un número
   bloqueado como si fuera una recomendación válida. Ahora el único valor
   automático permitido es el Min Price final ya listo para usarse; si no lo
   está, no se precarga nada.
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
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await page.selectOption('select[data-verif-status="bookingGeniusMobileBoth"]', 'verificado');
  await page.selectOption('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="booking"]', 'no_aplica');
  await page.locator('[data-tabbtn="ch-expedia"]').click();
  await page.selectOption('select[data-verif-status="expediaVipTierMix"]', 'verificado');
  await page.selectOption('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="expedia"]', 'no_aplica');
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await page.selectOption('select[data-verif-status="airbnbNonRefundable"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="airbnb"]', 'no_aplica');
  await page.locator('[data-tabbtn="ch-direct"]').click();
  await page.selectOption('select[data-verif-status="bankFeePctByChannel"][data-verif-ch="direct"]', 'no_aplica');
}

test('config por defecto: el botón del Simulador NO precarga un Min Price bloqueado', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#kBase')).toHaveText('—'); // confirma que arranca bloqueado

  await page.locator('#goSimBtn').click();
  await expect(page.locator('#simPrice')).toHaveValue('');
  await expect(page.locator('#inputErrorToast')).toBeVisible();
  await expect(page.locator('#inputErrorToast')).toContainText('Min Price está bloqueado');

  const simText = await page.locator('#simResult').innerText();
  expect(simText).toContain('No hay un precio para simular todavía');
  expect(simText).not.toMatch(/De los USD [\d.,]+ finales que muestra PriceLabs/, 'no debe renderizar un waterfall con un precio inventado');
});

test('con un precio fijo LM, el botón tampoco precarga nada mientras falte confirmar el Min Price final', async ({page}) => {
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
  await expect(page.locator('#inputErrorToast')).toContainText('Min Price está bloqueado');
  const simText = await page.locator('#simResult').innerText();
  expect(simText).toContain('No hay un precio para simular todavía');
});

test('cuando el Min Price final está listo, el botón SÍ lo precarga normalmente', async ({page}) => {
  await page.goto('/index.html');
  /* BLOQUEANTE 2 (auditoria externa, ronda 4): costos reales (no el ejemplo
     de fábrica 32/22) — este test aísla el mecanismo de LM, no el de costos. */
  const fc = page.locator('[data-k="fixedCost"]');
  await fc.click(); await fc.fill('40'); await fc.dispatchEvent('change');
  const vc = page.locator('[data-k="varCost"]');
  await vc.click(); await vc.fill('25'); await vc.dispatchEvent('change');
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  const pct = page.locator('[data-lmf="flat.pct"]');
  await pct.click(); await pct.fill('20'); await pct.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();
  await page.locator('[data-floor-contract-confirmed]').check();
  await resolveAllFinancialFacts(page);
  await expect(page.locator('#kFloor')).not.toHaveText('—');

  await page.locator('#goSimBtn').click();
  const simPriceValue = await page.locator('#simPrice').inputValue();
  expect(simPriceValue).not.toBe('');
  expect(Number(simPriceValue)).toBeGreaterThan(0);
  const simText = await page.locator('#simResult').innerText();
  expect(simText).toMatch(/De los USD [\d.,]+ finales que muestra PriceLabs/);
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
  expect(simText).toMatch(/De los USD 250 finales que muestra PriceLabs/);
  expect(simText).not.toContain('No hay un precio para simular todavía');
});
