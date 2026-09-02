/* Fase 2 de usabilidad (ago 2026) — vista de portafolio. Dani pidió
   explícitamente "una lista de todas [sus unidades]" — hoy la app trabaja de
   a una a la vez y él opera ~36. Este spec prueba en un navegador real que
   la pestaña "Mis apartamentos" lista lo guardado y que el click en una fila
   carga esa unidad. */
import {test, expect} from '@playwright/test';

test('pestaña "Mis apartamentos": estado vacío explicativo, lista lo guardado, y el click en una fila la carga', async ({page}) => {
  await page.goto('/index.html');

  await page.locator('[data-tabbtn="portafolio"]').click();
  await expect(page.locator('.tab-panel[data-tab="portafolio"]')).toHaveClass(/active/);
  // Estado vacío: sin unidades guardadas todavía, mensaje claro, no una tabla vacía.
  await expect(page.locator('#portfolioMount')).toContainText('Todavía no guardaste ningún apartamento');
  await expect(page.locator('#portfolioMount table')).toHaveCount(0);

  // Guardar una unidad real desde Resumen.
  await page.locator('[data-tabbtn="resumen"]').click();
  await page.locator('#unitName').fill('Depto Portafolio E2E');
  await page.locator('#saveUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('Guardado');

  await page.locator('[data-tabbtn="portafolio"]').click();
  const row = page.locator('.portfolio-row', {hasText: 'Depto Portafolio E2E'});
  await expect(row).toBeVisible();
  // Chip de estado visible (costos de ejemplo + LM sin verificar por defecto).
  await expect(row).toContainText('Faltan costos');

  await row.click();
  await expect(page.locator('.tab-panel[data-tab="resumen"]')).toHaveClass(/active/);
  await expect(page.locator('#unitName')).toHaveValue('Depto Portafolio E2E');
});
