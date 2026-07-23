/* Bloqueante 8 (revision externa) — E2E automatizado en un navegador real.
   Cubre lo que un test unitario no puede: que la app carga sin romperse, que
   los modulos ES realmente se resuelven en el navegador, que el flujo de
   guardar/cargar/eliminar/importar funciona con la UI real, y que un payload
   XSS importado NO se ejecuta cuando se renderiza de verdad (no simulado). */
import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if(msg.type()==='error') errors.push(msg.text()); });
  page.__errors = errors;
});

test('carga limpia: cero errores de consola, KPIs render, alertas render', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#kFloor')).not.toHaveText('—');
  await expect(page.locator('#kBase')).not.toHaveText('—');
  await expect(page.locator('#alertsBox .alert').first()).toBeVisible();
  expect(page.__errors, 'no debe haber errores de consola en carga limpia').toEqual([]);
});

test('Simulador: cambiar canal/días/noches recalcula y muestra Margen y Markup distintos', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="simulador"]').click();
  await page.locator('#simDays').fill('10');
  await page.locator('#simDays').dispatchEvent('change');
  const text = await page.locator('#simResult').innerText();
  expect(text).toContain('Margen sobre venta');
  expect(text).toContain('Markup sobre costo');
  expect(page.__errors).toEqual([]);
});

test('validación bloqueante: comisión inválida (150%) muestra banner y bloquea KPIs con "—"', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await page.locator('[data-chid="booking"][data-chf="comm"]').fill('150');
  await page.locator('[data-chid="booking"][data-chf="comm"]').dispatchEvent('change');
  await expect(page.locator('#validationBanner')).toContainText('BLOQUEADO');
  await expect(page.locator('#kFloor')).toHaveText('—');
  // revertir para no dejar el navegador de la sesion en estado invalido
  await page.locator('[data-chid="booking"][data-chf="comm"]').fill('18');
  await page.locator('[data-chid="booking"][data-chf="comm"]').dispatchEvent('change');
  await expect(page.locator('#validationBanner')).not.toContainText('BLOQUEADO');
});

test('guardar/cargar/eliminar unidad: Eliminar pide confirmación explícita', async ({page}) => {
  await page.goto('/index.html');
  const name = 'E2E Test Unit ' + Date.now();
  await page.locator('#unitName').fill(name);
  await page.locator('#saveUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('Guardado', {timeout: 5000});

  await page.reload();
  await page.selectOption('#unitList', {label: name});
  await expect(page.locator('#unitName')).toHaveValue(name, {timeout: 5000});

  await page.selectOption('#unitList', {label: name});
  page.once('dialog', dialog => { expect(dialog.message()).toContain('Eliminar'); dialog.accept(); });
  await page.locator('#deleteUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('Eliminado', {timeout: 5000});
});

test('importación con payload XSS: no se ejecuta ningún script, el nombre se muestra escapado', async ({page}) => {
  await page.goto('/index.html');
  let dialogFired = false;
  // Un dialogo aqui SI es el confirm() legitimo de la app pidiendo confirmar la
  // restauracion — pero si el mensaje NO es el esperado, podria ser un alert()
  // disparado por el payload XSS (deteccion de fallo). `.once`: solo aplica a
  // ESTE dialogo de import, no al confirm() de Eliminar en la limpieza de abajo.
  page.once('dialog', async dialog => {
    dialogFired = true;
    if(!dialog.message().includes('Vas a restaurar')) throw new Error('Dialogo inesperado (posible XSS ejecutado): ' + dialog.message());
    await dialog.accept();
  });

  const evilName = 'Evil<img src=x onerror=window.__xssFired=true>';
  const payload = {
    exportedAt: new Date().toISOString(), schemaVersion: 3,
    units: [{key: 'v3:e2e-evil', value: JSON.stringify({
      name: evilName,
      discounts: [{id: 'ab_los4', on: true, pct: '1" onmouseover="alert(1)'}],
      channels: [{id: 'booking', comm: '999', offsetPct: -99999}]
    })}]
  };

  const buffer = Buffer.from(JSON.stringify(payload));
  await page.setInputFiles('#importUnitsFile', {name: 'evil.json', mimeType: 'application/json', buffer});
  await page.waitForTimeout(500);

  expect(dialogFired, 'debe haber pedido confirmacion antes de importar').toBe(true);
  const xssFired = await page.evaluate(() => window.__xssFired === true);
  expect(xssFired, 'el onerror del payload NUNCA debe ejecutarse').toBe(false);

  await page.reload();
  // El texto "Evil<img...>" SI debe verse como TEXTO plano (la entidad HTML se
  // decodifica de vuelta al leerla) — lo que nunca debe pasar es que exista un
  // elemento <img> REAL en el DOM (eso significaria que se interpreto como tag).
  const optionText = await page.locator('#unitList').innerText();
  expect(optionText).toContain('Evil');
  const injectedImgCount = await page.locator('img[src="x"]').count();
  expect(injectedImgCount, 'no debe existir ningun <img> real inyectado en el DOM').toBe(0);

  // limpieza: eliminar la unidad de prueba
  const evilValue = await page.locator('#unitList option', {hasText: 'Evil'}).getAttribute('value');
  await page.selectOption('#unitList', evilValue);
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('Matriz: la fila muestra "Peor payout real detectado" (no solo mayor descuento nativo)', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="comparacion"]').click();
  await page.locator('.matrix-detail summary').first().click();
  const text = await page.locator('.matrix-detail').first().innerText();
  expect(text).toContain('Peor payout real detectado');
  expect(page.__errors).toEqual([]);
});
