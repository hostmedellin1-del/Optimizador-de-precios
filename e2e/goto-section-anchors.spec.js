/* Bug de UX corregido (revision externa): los botones "Ir a Last-Minute de
   PriceLabs →" / "Ir a Verificación de datos financieros →" (banners de
   bloqueo, Alertas, y el mensaje del Simulador bloqueado) solo llamaban a
   goToTab('resumen') — si el usuario YA estaba en la pestaña Resumen (que
   es larga, con varias secciones apiladas: Costos, Last-Minute,
   Verificación, Rentabilidad mensual...), visualmente no pasaba nada y
   nunca llegaba a la sección que necesitaba configurar.

   goToSection(tabId, anchorKey) (index.html) corrige esto: activa la
   pestaña (como siempre) y, si hay una sección conocida, hace scroll suave
   hasta ella, mueve el foco de teclado a su primer campo/encabezado, y la
   resalta brevemente (`.goto-highlight`) — sin tocar ninguna fórmula ni
   gate financiero (src/domain/*.js intacto). Este spec prueba en un
   navegador real que el destino es correcto y accesible, tanto si el click
   ocurre estando YA en Resumen (el bug original) como desde otra pestaña. */
import {test, expect} from '@playwright/test';

test('Ir a Last-Minute de PriceLabs: desde Resumen (el caso del bug — ya se está en esa pestaña), el select de modo LM queda visible y enfocado', async ({page}) => {
  await page.goto('/index.html');
  // Config por defecto: LM sin verificar -> el banner "LM SIN VERIFICAR" con
  // su botón debe estar visible de entrada, ya en la pestaña Resumen.
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  const btn = page.locator('#validationBanner button[data-goto="resumen:lm"]').first();
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('Ir a Last-Minute de PriceLabs →');

  await btn.click();

  // Sigue en Resumen (no cambia de pestaña porque ya estaba ahí) y el select
  // de modo LM (dentro de la sección Last-Minute) queda visible y enfocado.
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  await expect(page.locator('#lmModeSelect')).toBeFocused();
  await expect(page.locator('#lmSection')).toBeInViewport();
});

test('Ir a Verificación de datos financieros: desde Resumen, la sección de verificación queda visible y su encabezado enfocado', async ({page}) => {
  await page.goto('/index.html');
  // Config por defecto: datos de negocio pendientes (Genius+Mobile, VIP
  // Expedia, comisión bancaria) -> el banner "DATO FINANCIERO SIN VERIFICAR"
  // también aparece de entrada.
  const btn = page.locator('#validationBanner button[data-goto="resumen:verificacion"]').first();
  await expect(btn).toBeVisible();

  await btn.click();

  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  await expect(page.locator('#verificationSectionHeading')).toBeFocused();
  await expect(page.locator('#verificationSection')).toBeInViewport();
});

test('Ir a Last-Minute de PriceLabs: tras visitar otra pestaña (Airbnb) y volver a Resumen, el destino sigue siendo correcto (no queda "pegado" a un estado de scroll/foco viejo)', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await expect(page.locator('.tab-panel[data-tab="ch-airbnb"]')).toHaveClass(/active/);
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).not.toHaveClass(/active/);

  await page.locator('[data-tabbtn="resumen"]').click();
  const btn = page.locator('#validationBanner button[data-goto="resumen:lm"]').first();
  await btn.click();
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  await expect(page.locator('#lmModeSelect')).toBeFocused();
});

test('Ir a Verificación de datos financieros: desde la pestaña Simulador (botón real, sin pasar por Resumen primero), cambia de pestaña y enfoca la sección correcta', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="simulador"]').click();
  await expect(page.locator('.tab-panel[data-tab="simulador"]')).toHaveClass(/active/);
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).not.toHaveClass(/active/);

  // Base Price sigue bloqueado por defecto (LM sin verificar) y no se
  // escribió ningún precio a mano -> el mensaje bloqueado del Simulador,
  // con su botón hacia Verificación, debe estar visible AQUÍ MISMO, en la
  // pestaña Simulador — la prueba real de "funciona desde otra pestaña".
  const btn = page.locator('#simResult button[data-goto="resumen:verificacion"]');
  await expect(btn).toBeVisible();

  await btn.click();

  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  await expect(page.locator('.tab-panel[data-tab="simulador"]')).not.toHaveClass(/active/);
  await expect(page.locator('#verificationSectionHeading')).toBeFocused();
  await expect(page.locator('#verificationSection')).toBeInViewport();
});

test('Alertas (panel siempre visible arriba, fuera de la estructura de pestañas): sigue visible y usable al cambiar de pestaña, y el "Ver en Resumen →" sin sección específica (ej. tag INVIABLE) conserva el comportamiento de siempre (solo cambia de pestaña, sin inventar un destino que alerts.js no dio)', async ({page}) => {
  await page.goto('/index.html');
  // Config por defecto: el piso queda por encima de la base de mercado ->
  // alerts.js (dominio, sin tocar) emite el tag INVIABLE con tab:'resumen'
  // y SIN sección específica — index.html no le inventa una.
  const inviableBtn = page.locator('#alertsBox button', {hasText: 'Ver en Resumen →'});
  await expect(inviableBtn).toHaveAttribute('data-goto', 'resumen');

  // El panel de Alertas vive FUERA de la estructura de pestañas (antes del
  // tabbar en el HTML) — moverse a otra pestaña no debe ocultarlo.
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await expect(inviableBtn).toBeVisible();

  await inviableBtn.click();
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
});

test('la sección destino recibe el resaltado breve (.goto-highlight) al llegar', async ({page}) => {
  await page.goto('/index.html');
  const btn = page.locator('#validationBanner button[data-goto="resumen:lm"]').first();
  await btn.click();
  await expect(page.locator('#lmSection')).toHaveClass(/goto-highlight/);
  // Se quita solo despues de un momento — no queda pegado para siempre.
  await expect(page.locator('#lmSection')).not.toHaveClass(/goto-highlight/, {timeout: 3000});
});

test('caso "PRECIO FIJO ACTIVO — BASE NO APLICA" (LM en modo fixed_price cubriendo el día 45): su botón también apunta a la sección Last-Minute, donde ese modo se configura', async ({page}) => {
  await page.goto('/index.html');
  await page.selectOption('#lmModeSelect', 'fixed_price');
  await page.locator('[data-lmf="fixedPrice.on"]').check();
  const priceInput = page.locator('[data-lmf="fixedPrice.price"]');
  await priceInput.click(); await priceInput.fill('150'); await priceInput.dispatchEvent('change');
  const fromInput = page.locator('[data-lmf="fixedPrice.fromDay"]');
  await fromInput.click(); await fromInput.fill('40'); await fromInput.dispatchEvent('change');
  const toInput = page.locator('[data-lmf="fixedPrice.toDay"]');
  await toInput.click(); await toInput.fill('50'); await toInput.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();

  const btn = page.locator('#validationBanner button[data-goto="resumen:lm"]', {hasText: 'Ir a Last-Minute de PriceLabs →'}).first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#lmModeSelect')).toBeFocused();
});
