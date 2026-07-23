/* Bloqueante P1 (revision externa, ronda 3) — Base Price y Offset no
   cumplian su contrato cuando Last-Minute esta en modo 'fixed_price' y el
   rango activo cubre el dia de referencia (45). Caso reproducible: Directo,
   costo 100/0, margen 50% (objetivo 200), LM verificado fixed_price=150 en
   dias 40-50 — antes: Base≈219.78 y Offset sugerido 0%, pero
   quoteScenario({days:45,price:base}) daba payout=136.50, muy por debajo del
   objetivo. Este spec reproduce el caso en un navegador real.

   Nota de infraestructura de test (no es un bug de la app): `renderLmConfig()`
   reconstruye por completo los campos del modo LM en cada `change` — si se
   llama `.fill()` sin un `.click()` explícito primero justo después de un
   re-render, Playwright puede tipear sobre el foco anterior en vez del campo
   nuevo (reproducido de forma determinística: 5/5 corridas). Por eso cada
   interacción aquí hace `.click()` antes de `.fill()`. */
import {test, expect} from '@playwright/test';

async function fillField(page, selector, value){
  const loc = page.locator(selector);
  await loc.click();
  await loc.fill(value);
  await loc.dispatchEvent('change');
}

async function setupFixedPriceScenario(page){
  await page.goto('/index.html');
  await fillField(page, '[data-k="fixedCost"]', '100');
  await fillField(page, '[data-k="varCost"]', '0');
  await fillField(page, '[data-k="margin"]', '50');
  // apagar todos los descuentos activos por defecto (aisla el efecto del LM fijo)
  await page.evaluate(async () => {
    let guard = 0;
    while(guard++ < 50){
      const cb = document.querySelector('[data-did][data-f="on"]:checked');
      if(!cb) break;
      cb.checked = false;
      cb.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  await page.selectOption('[data-lm="mode"]', 'fixed_price');
  await fillField(page, '[data-lmf="fixedPrice.price"]', '150');
  // "hasta" primero: el default de fromDay/toDay es 0/3 — fijar "desde"=40
  // antes de subir "hasta" chocaria con la validacion de rango invertido
  // (bloqueante MEDIO, ronda 2), que es exactamente lo que se quiere evitar aqui.
  await fillField(page, '[data-lmf="fixedPrice.toDay"]', '50');
  await fillField(page, '[data-lmf="fixedPrice.fromDay"]', '40');
  await page.locator('[data-lmf="fixedPrice.on"]').check();
  await page.locator('[data-lm="verified"]').check();
}

test('caso obligatorio: LM fixed_price en 40-50 (cubre día 45) bloquea Base Price con explicación clara, aunque el LM esté VERIFICADO', async ({page}) => {
  await setupFixedPriceScenario(page);
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kBaseWhy')).toContainText('Precio LM fijo activo');

  const banner = page.locator('#validationBanner');
  await expect(banner).toContainText('PRECIO FIJO ACTIVO — BASE NO APLICA');
  await expect(banner).toContainText('150');
  await expect(banner).toContainText('por debajo de tu objetivo');
});

test('el Offset sugerido SÍ se recalcula sobre el precio fijo real (no se bloquea, no queda en 0%)', async ({page}) => {
  await setupFixedPriceScenario(page);
  await page.locator('[data-tabbtn="ch-direct"]').click();
  const hint = page.locator('.tab-panel[data-tab="ch-direct"] .offset-hint');
  await expect(hint).toContainText('Base Price no aplica aquí');
  await expect(hint).toContainText('se recalculó sobre ese precio fijo real');
  const text = await hint.innerText();
  const match = text.match(/([+-]?\d+\.\d)%/);
  expect(match, `debe mostrar un % numérico real, no "0.0%": ${text}`).not.toBeNull();
  const suggestedOffsetValue = parseFloat(match[1]);
  expect(suggestedOffsetValue, 'el offset corregido debe ser sustancialmente positivo para compensar el precio fijo bajo, no 0%').toBeGreaterThan(30);
});

test('justo fuera del rango del precio fijo (día 45 no cubierto), Base Price vuelve a mostrarse normal', async ({page}) => {
  await setupFixedPriceScenario(page);
  // Mismo escenario base (costos/descuentos aislados) que ya prueba que el
  // precio fijo de 150 SI alcanza el objetivo — solo se mueve el rango para
  // que el día 45 (referencia de Base) quede FUERA de él.
  await fillField(page, '[data-lmf="fixedPrice.fromDay"]', '46');
  await fillField(page, '[data-lmf="fixedPrice.toDay"]', '60');

  await expect(page.locator('#validationBanner')).not.toContainText('PRECIO FIJO ACTIVO — BASE NO APLICA');
  await expect(page.locator('#kBase')).not.toHaveText('—');
});
