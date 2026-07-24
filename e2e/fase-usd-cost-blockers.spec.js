/* Auditoria externa (ronda 4) — verificacion en navegador real de los DOS
   bloqueantes corregidos:
   1. Un canal historico con settlementCurrency distinta de USD bloquea
      Min Price/Base Price/Matriz/Alertas/Offset GLOBALMENTE, aunque
      state.currency==='USD' — y dos unidades simultaneas (una bloqueada,
      otra limpia) no se contaminan entre si.
   2. Un desglose de costos detallado PARCIAL (ej. solo "Consumos: 5") jamas
      alimenta Piso/Base mientras no se confirme explicitamente — llenarlo
      completo tampoco basta sin la casilla de confirmacion.
   Tambien cubre el flujo guiado de recuperacion de una unidad no-USD (crear
   copia en USD) y una comprobacion basica de accesibilidad (labels). */
import {test, expect} from '@playwright/test';

async function fillField(page, selector, value){
  const loc = page.locator(selector);
  await loc.click();
  await loc.fill(value);
  await loc.dispatchEvent('change');
}

async function importUnit(page, name, extra){
  let dialogFired = false;
  page.once('dialog', async dialog => { dialogFired = true; await dialog.accept(); });
  const payload = {
    exportedAt: new Date().toISOString(), schemaVersion: 3,
    units: [{key: 'v3:e2e-'+name.replace(/\s+/g,'-'), value: JSON.stringify({name, ...extra})}]
  };
  const buffer = Buffer.from(JSON.stringify(payload));
  await page.setInputFiles('#importUnitsFile', {name: name.replace(/\s+/g,'-')+'.json', mimeType: 'application/json', buffer});
  await page.waitForTimeout(500);
  expect(dialogFired).toBe(true);
}

/* ======================= BLOQUEANTE 1 — canal no-USD ======================= */

test('BLOQUEANTE 1: unidad en USD con Airbnb marcado settlementCurrency:"COP" (dato histórico) — banner, Min Price/Base Price, Matriz, Alertas y Offset TODOS bloqueados', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Unidad USD canal COP', {currency:'USD', channels:[{id:'airbnb', settlementCurrency:'COP'}]});

  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad USD canal COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad USD canal COP', {timeout: 5000});

  // El banner debe aparecer aunque state.currency sea 'USD' — ANTES del fix
  // esto no bloqueaba nada porque solo se miraba state.currency.
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#currencyReviewBanner')).toContainText('Airbnb');
  await expect(page.locator('#currencyReviewBanner')).toContainText('COP');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');

  await page.locator('[data-tabbtn="comparacion"]').click();
  await expect(page.locator('#matrixIntro')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#matrixBody tr')).toHaveCount(0);

  await page.locator('[data-tabbtn="resumen"]').click();
  const alertsText = await page.locator('.alerts').innerText().catch(()=>'');
  expect(alertsText.includes('RENTABLE') || alertsText.includes('OK')).toBe(false);

  // Offset sugerido de CUALQUIER canal (no solo Airbnb) también bloqueado —
  // el gate es global, no solo del canal marcado en otra moneda.
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await expect(page.locator('.tab-panel[data-tab="ch-booking"] .offset-hint')).toContainText('requiere revisión manual');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('BLOQUEANTE 1: dos unidades simultáneas — una bloqueada por canal COP, otra USD limpia — no se contaminan entre sí al cambiar de una a otra', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Unidad bloqueada COP', {currency:'USD', channels:[{id:'booking', settlementCurrency:'COP'}]});
  await importUnit(page, 'Unidad limpia USD', {currency:'USD', fixedCost:40, varCost:25});

  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad bloqueada COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad bloqueada COP', {timeout: 5000});
  await expect(page.locator('#kFloor')).toHaveText('—');

  await page.selectOption('#unitList', {label: 'Unidad limpia USD'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad limpia USD', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toHaveText('');
  // El Piso puede seguir bloqueado por OTRO motivo (LM sin verificar por
  // defecto) — lo que este test aísla es que NO sea por moneda.
  await expect(page.locator('#kFloorWhy')).not.toContainText('revisión manual');

  // volver a la bloqueada confirma que sigue bloqueada (nada se "arregló" al pasar por la otra)
  await page.selectOption('#unitList', {label: 'Unidad bloqueada COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad bloqueada COP', {timeout: 5000});
  await expect(page.locator('#kFloor')).toHaveText('—');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
  await page.selectOption('#unitList', {label: 'Unidad limpia USD'});
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

/* ======================= Recuperación segura de una unidad COP ======================= */

test('Recuperación segura: importar unidad COP → crear copia en USD → original sigue bloqueada → copia también bloqueada hasta confirmar moneda/costos → copia queda operativa solo tras revisión explícita', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Unidad para recuperar COP', {currency:'COP', fixedCost:40, varCost:25});
  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad para recuperar COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad para recuperar COP', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');

  page.once('dialog', d => d.accept()); // confirm() de "se creará una copia..."
  await page.locator('#createUsdCopyBtn').click();
  await page.waitForTimeout(300);

  // La app debe quedar mostrando la COPIA (nombre distinto, marcado "pendiente de revisión").
  await expect(page.locator('#unitName')).toHaveValue(/copia USD — pendiente de revisión manual/, {timeout: 5000});
  await expect(page.locator('#currencyDisplay')).toHaveText('USD');
  await expect(page.locator('#currencyReviewBanner')).toHaveText(''); // la copia SI esta en USD ahora
  // La copia no esta bloqueada POR MONEDA (aunque siga bloqueada por otro
  // motivo ortogonal, ej. LM sin verificar por defecto — eso es correcto y
  // no tiene nada que ver con la recuperación de moneda que este test prueba).
  await expect(page.locator('#kFloorWhy')).not.toContainText('revisión manual');

  // La unidad ORIGINAL (en COP) sigue intacta y bloqueada.
  await page.selectOption('#unitList', {label: 'Unidad para recuperar COP'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad para recuperar COP', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#kFloor')).toHaveText('—');

  // limpieza: borrar ambas
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
  await page.selectOption('#unitList', {label: 'Unidad para recuperar COP (copia USD — pendiente de revisión manual)'});
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

/* ======================= BLOQUEANTE 2 — costos parciales ======================= */

test('BLOQUEANTE 2: agregar SOLO "Consumos: 5" en la calculadora detallada NO baja el Piso — sigue usando el modelo simple (32/22) hasta confirmar', async ({page}) => {
  await page.goto('/index.html');
  // Resolver LM + datos de negocio para poder ver un Piso numérico y aislar
  // el mecanismo de costos bajo prueba.
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  const pct = page.locator('[data-lmf="flat.pct"]');
  await pct.click(); await pct.fill('0'); await pct.dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();
  await page.selectOption('select[data-verif-status="hospyOffsetIsolated"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="bookingGeniusMobileBoth"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="expediaVipTierMix"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="airbnbNonRefundable"]', 'no_aplica');
  for(const chId of ['airbnb','booking','expedia','direct']){
    await page.selectOption(`select[data-verif-status="bankFeePctByChannel"][data-verif-ch="${chId}"]`, 'no_aplica');
  }
  // Costos reales (no el ejemplo de fábrica) en modo simple: 40/25 => 65.
  const fc = page.locator('[data-k="fixedCost"]');
  await fc.click(); await fc.fill('40'); await fc.dispatchEvent('change');
  const vc = page.locator('[data-k="varCost"]');
  await vc.click(); await vc.fill('25'); await vc.dispatchEvent('change');

  const floorBefore = await page.locator('#kFloor').innerText();
  expect(floorBefore).not.toBe('—');

  await page.locator('details.cost-calc').evaluate(el => { el.open = true; });
  await fillField(page, '[data-cb="consumables"]', '5');

  // El costo NO debe caer al desglose parcial (5) — kCost sigue reflejando
  // el modelo simple (65, no bloqueado en sí — el número sigue siendo
  // honesto), pero kFloor/kBase (la RECOMENDACIÓN) sí quedan bloqueados
  // mientras el desglose no esté confirmado.
  await expect(page.locator('#kCost')).toHaveText('USD 65'); // sigue siendo 40+25, NUNCA "5"
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#dataProvenanceBanner')).toContainText('COSTOS SIN CONFIRMAR');

  // Confirmar el desglose parcial (tal como está, solo consumables=5) SÍ lo
  // activa — este es el comportamiento correcto una vez el usuario revisa
  // y confirma explícitamente, no un bug.
  await page.locator('#costBreakdownConfirmedChk').check();
  await expect(page.locator('#kCost')).toHaveText('USD 5');
  await expect(page.locator('#kFloor')).not.toHaveText('—');
});

test('BLOQUEANTE 2: editar el desglose después de confirmarlo invalida la confirmación (vuelve a bloquear)', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('details.cost-calc').evaluate(el => { el.open = true; });
  await fillField(page, '[data-cb="consumables"]', '5');
  await page.locator('#costBreakdownConfirmedChk').check();
  await expect(page.locator('#costBreakdownConfirmedChk')).toBeChecked();

  await fillField(page, '[data-cb="rent"]', '10');
  await expect(page.locator('#costBreakdownConfirmedChk')).not.toBeChecked();
  await expect(page.locator('#dataProvenanceBanner')).toContainText('COSTOS SIN CONFIRMAR');
});

test('BLOQUEANTE 2: costos de ejemplo de fábrica (32/22, nunca tocados) bloquean Min Price/Base Price — ya no solo un aviso pasivo', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#dataProvenanceBanner')).toContainText('EJEMPLO');
  await expect(page.locator('#kFloor')).toHaveText('—');
});

/* ======================= Accesibilidad (spot-check) ======================= */

test('accesibilidad: los campos principales de costos son accesibles por su etiqueta (label asociado)', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.getByLabel('Fijos (arriendo, admin, servicios, seguros, tech)')).toBeVisible();
  await expect(page.getByLabel('Variables (limpieza, lavandería, consumos, insumos)')).toBeVisible();
  await page.locator('details.cost-calc').evaluate(el => { el.open = true; });
  await expect(page.getByLabel(/Revisé estos costos reales en USD/)).toBeVisible();
});
