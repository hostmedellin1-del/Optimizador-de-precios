/* Fase 1 de usabilidad (ago 2026) — "casi no la uso porque no la entiendo".
   Causa verificada: una unidad nueva queda bloqueada por dos gates a la vez
   (Last-Minute sin verificar + costos de ejemplo 32/22), Piso/Base muestran
   "—" y la unica explicacion era un parrafo largo lleno de jerga que nunca
   decia "hace estas dos cosas". Este spec prueba en un navegador real que la
   lista concreta de pasos (pendingSetupSteps(), src/domain/readiness.js)
   aparece, sus botones llevan a la seccion correcta, y que completar ambos
   pasos hace aparecer el Piso. */
import {test, expect} from '@playwright/test';

test('unidad nueva: se ven los 2 pasos pendientes con sus botones; completarlos hace aparecer el Piso', async ({page}) => {
  await page.goto('/index.html');

  const card = page.locator('#setupStepsCard');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Faltan 2 cosas para que pueda darte un precio');
  await expect(page.locator('#kFloor')).toHaveText('—');

  const costosBtn = card.locator('button[data-goto="resumen:costos"]');
  const lmBtn = card.locator('button[data-goto="resumen:lm"]');
  await expect(costosBtn).toBeVisible();
  await expect(lmBtn).toBeVisible();

  // El click en "Escribí los costos reales..." lleva a la sección de costos
  // (mismo goToSection() que ya usan el resto de los botones "Ir a...").
  await costosBtn.click();
  await expect(page.locator('#costsSection')).toHaveClass(/goto-highlight/);
  await expect(page.locator('#f-fixedCost')).toBeFocused();

  // Completar el paso de costos con datos reales (no el ejemplo de fábrica).
  const fc = page.locator('[data-k="fixedCost"]');
  await fc.click(); await fc.fill('40'); await fc.dispatchEvent('change');
  const vc = page.locator('[data-k="varCost"]');
  await vc.click(); await vc.fill('20'); await vc.dispatchEvent('change');

  await expect(card).toContainText('Falta 1 cosa para que pueda darte un precio');
  await expect(card).toContainText('Escribí los costos reales de este apartamento');

  // El paso de costos ahora aparece resuelto (✓, sin botón); el de LM sigue pendiente.
  const resolvedRow = card.locator('.alert.ok', {hasText: 'Escribí los costos reales de este apartamento'});
  await expect(resolvedRow).toBeVisible();
  await expect(resolvedRow.locator('button')).toHaveCount(0);

  // Completar el paso de Last-Minute: modo configurable + verificado.
  await page.selectOption('#lmModeSelect', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  const flat = page.locator('[data-lmf="flat.pct"]');
  await flat.click(); await flat.fill('10'); await flat.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();

  // Con ambos pasos resueltos, la tarjeta de pasos desaparece y el Piso se muestra.
  await expect(page.locator('#setupStepsCard')).toHaveCount(0);
  await expect(page.locator('#kFloor')).not.toHaveText('—');
});
