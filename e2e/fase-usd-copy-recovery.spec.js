/* Auditoria externa (ronda 5) — BLOQUEANTE 3: "recuperación segura de COP no
   es segura". El flujo "Crear copia en USD" (agregado en la ronda 4) copiaba
   los valores monetarios SIN convertir nada, pero en cuanto se resolvían
   LM/verificaciones/costos reales, la copia ya podía mostrar Piso/Base como
   si esos números fueran USD reales y revisados — el encargo reporta Piso
   USD 108,33 y Base USD 196,97 disponibles sin revisión manual real, con
   fixedCost:40/varCost:25 copiados de una unidad COP.

   `usdManualReviewPending` (src/domain/usd-only.js) cierra ese hueco: la
   copia arranca con esa bandera en `true` — bloquea GLOBALMENTE aunque su
   `currency` YA sea 'USD' — y solo el flujo explícito de "Finalizar revisión
   manual" (confirmación fuerte) puede apagarla. Este spec reproduce el caso
   EXACTO del encargo en un navegador real, paso a paso 1-10 tal como los
   pide la auditoría. */
import {test, expect} from '@playwright/test';

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

/* Resuelve LM + TODOS los datos de negocio (Fase 5) para los 4 canales — no
   deja a Directo sin tocar como hace `financial-readiness.spec.js` a
   propósito (ese aísla otro caso). Aquí se necesita TODO resuelto para
   aislar específicamente el gate de `usdManualReviewPending`: si algo más
   quedara pendiente, un kFloor en "—" no probaría nada sobre BLOQUEANTE 3. */
async function resolveEverythingExceptCurrency(page){
  await page.locator('[data-tabbtn="resumen"]').click();
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
}

test('BLOQUEANTE 3 (reproducción exacta, 1-9): importar COP fixedCost:40/varCost:25 → crear copia USD → LM/verificaciones resueltas → SIGUE bloqueado → confirmar revisión manual → SOLO ENTONCES se desbloquea → original COP intacta', async ({page}) => {
  await page.goto('/index.html');

  // 1. Importar unidad COP con costos simples 40/25.
  await importUnit(page, 'Unidad COP para BLOQUEANTE 3', {currency:'COP', fixedCost:40, varCost:25});
  await page.reload();
  await page.selectOption('#unitList', {label: 'Unidad COP para BLOQUEANTE 3'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad COP para BLOQUEANTE 3', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');

  // 2. Crear copia USD.
  page.once('dialog', d => d.accept());
  await page.locator('#createUsdCopyBtn').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#unitName')).toHaveValue(/copia USD — pendiente de revisión manual/, {timeout: 5000});
  await expect(page.locator('#currencyDisplay')).toHaveText('USD (copia pendiente de revisión manual)');
  // La copia sí quedó en USD, pero el gate de revisión manual sigue activo —
  // el banner debe seguir mostrando el bloqueo (a diferencia de la ronda 4,
  // donde esto quedaba en blanco en cuanto currency era 'USD').
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#currencyReviewBanner')).toContainText('pendiente de revisión manual');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');

  // 3. Resolver LM, comisiones y demás verificaciones.
  await resolveEverythingExceptCurrency(page);

  // 4. Confirmar que Piso/Base/Offset/Matriz/Alertas/planificación/conciliación
  //    SIGUEN bloqueados por usdManualReviewPending, y 5. que NO aparece un
  //    Piso/Base numérico engañoso (el bug real: 108.33/196.97 disponibles).
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('revisión manual');
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kBaseWhy')).toContainText('revisión manual');

  await page.locator('[data-tabbtn="comparacion"]').click();
  await expect(page.locator('#matrixIntro')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#matrixBody tr')).toHaveCount(0);
  await page.locator('[data-tabbtn="resumen"]').click();
  const alertsText = await page.locator('.alerts').innerText().catch(()=>'');
  expect(alertsText.includes('RENTABLE') || alertsText.includes('OK')).toBe(false);

  await page.locator('[data-tabbtn="ch-booking"]').click();
  await expect(page.locator('.tab-panel[data-tab="ch-booking"] .offset-hint')).toContainText('revisión manual');

  await page.locator('[data-tabbtn="resumen"]').click();
  await expect(page.locator('#monthlyResult')).toContainText(/revisión manual/i);

  // 6. Completar la confirmación explícita de revisión manual.
  page.once('dialog', d => d.accept());
  await page.locator('#confirmUsdReviewBtn').click();
  await page.waitForTimeout(300);

  // 7. Confirmar que solo entonces se desbloquean las recomendaciones.
  await expect(page.locator('#currencyReviewBanner')).toHaveText('');
  await expect(page.locator('#currencyDisplay')).toHaveText('USD');
  await expect(page.locator('#kFloor')).not.toHaveText('—');
  await expect(page.locator('#kBase')).not.toHaveText('—');
  // El historial de revisión manual queda visible y NUNCA se borra.
  await expect(page.locator('#usdReviewTrail')).toContainText('Copia creada');
  await expect(page.locator('#usdReviewTrail')).toContainText('Revisión confirmada');

  // 8. Volver a la unidad original COP: sigue bloqueada e intacta.
  await page.selectOption('#unitList', {label: 'Unidad COP para BLOQUEANTE 3'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad COP para BLOQUEANTE 3', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#kFloor')).toHaveText('—');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
  await page.selectOption('#unitList', {label: 'Unidad COP para BLOQUEANTE 3 (copia USD — pendiente de revisión manual)'});
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('BLOQUEANTE 3 (paso 9): copia USD pendiente y una unidad USD normal no se contaminan entre sí', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Copia pendiente aislada', {currency:'USD', fixedCost:40, varCost:25, usdManualReviewPending:true});
  await importUnit(page, 'Unidad normal aislada', {currency:'USD', fixedCost:40, varCost:25});
  await page.reload();

  await page.selectOption('#unitList', {label: 'Copia pendiente aislada'});
  await expect(page.locator('#unitName')).toHaveValue('Copia pendiente aislada', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#kFloor')).toHaveText('—');

  await page.selectOption('#unitList', {label: 'Unidad normal aislada'});
  await expect(page.locator('#unitName')).toHaveValue('Unidad normal aislada', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toHaveText('');
  // Puede seguir bloqueada por OTRO motivo (LM sin verificar por defecto) —
  // lo que este test aísla es que NO sea por la copia pendiente de la otra unidad.
  await expect(page.locator('#kFloorWhy')).not.toContainText('revisión manual');

  await page.selectOption('#unitList', {label: 'Copia pendiente aislada'});
  await expect(page.locator('#unitName')).toHaveValue('Copia pendiente aislada', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
  await page.selectOption('#unitList', {label: 'Unidad normal aislada'});
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('BLOQUEANTE 3 (paso 10): persistencia — guardar/recargar conserva el estado pendiente y la nota; importar directamente un JSON con usdManualReviewPending:true también bloquea', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Persistencia copia pendiente', {
    currency:'USD', fixedCost:40, varCost:25, usdManualReviewPending:true,
    usdManualReviewLog:[{at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde "Unidad original COP" (COP) — ningún valor fue convertido automáticamente.'}]
  });
  await page.reload();
  await page.selectOption('#unitList', {label: 'Persistencia copia pendiente'});
  await expect(page.locator('#unitName')).toHaveValue('Persistencia copia pendiente', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#usdReviewTrail')).toContainText('Copia creada');
  await expect(page.locator('#kFloor')).toHaveText('—');

  // Recargar de nuevo (simula cerrar/volver a abrir la app) — el estado
  // pendiente y la nota deben sobrevivir exactamente igual.
  await page.reload();
  await page.selectOption('#unitList', {label: 'Persistencia copia pendiente'});
  await expect(page.locator('#unitName')).toHaveValue('Persistencia copia pendiente', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#usdReviewTrail')).toContainText('Copia creada');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

/* ======================= BLOQUEANTE (ronda 6) — bypass por importación === */

test('BYPASS: importar un JSON con usdManualReviewPending:false pero usdManualReviewLog con copy_created SIN review_confirmed — sigue bloqueada', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Intento de bypass por import', {
    currency:'USD', fixedCost:40, varCost:25,
    usdManualReviewPending: false, // el archivo MIENTE — dice que ya no hace falta revisión
    usdManualReviewLog: [{at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'}]
  });
  await page.reload();
  await page.selectOption('#unitList', {label: 'Intento de bypass por import'});
  await expect(page.locator('#unitName')).toHaveValue('Intento de bypass por import', {timeout: 5000});

  // ANTES del fix, esto quedaba desbloqueado (el booleano crudo bastaba).
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#currencyDisplay')).toHaveText('USD (copia pendiente de revisión manual)');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('revisión manual');
  await expect(page.locator('#confirmUsdReviewBtn')).toBeVisible();

  await resolveEverythingExceptCurrency(page);
  // Resolver TODO lo demás tampoco debe desbloquearla — el único gate que
  // falta es la revisión manual, que la bitácora demuestra incompleta.
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('revisión manual');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

test('BYPASS: la MISMA copia, pero con review_confirmed VÁLIDO y posterior en el log — sí puede desbloquearse (una vez resueltos los demás gates)', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Copia con confirmación válida en el log', {
    currency:'USD', fixedCost:40, varCost:25,
    usdManualReviewPending: false,
    usdManualReviewLog: [
      {at:'2026-07-24T10:00:00.000Z', event:'copy_created', text:'Copia creada desde COP.'},
      {at:'2026-07-24T11:00:00.000Z', event:'review_confirmed', text:'Revisé manualmente todos los valores...'}
    ]
  });
  await page.reload();
  await page.selectOption('#unitList', {label: 'Copia con confirmación válida en el log'});
  await expect(page.locator('#unitName')).toHaveValue('Copia con confirmación válida en el log', {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toHaveText('');
  await expect(page.locator('#currencyDisplay')).toHaveText('USD');

  await resolveEverythingExceptCurrency(page);
  await expect(page.locator('#kFloor')).not.toHaveText('—');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});

/* ======================= BLOQUEANTE (ronda 6) — fallo de guardado ======== */

test('Fallo de guardado al confirmar: la unidad sigue bloqueada en memoria y en pantalla, con un error explícito — nunca se muestra como revisada', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Falla de guardado al confirmar', {currency:'COP', fixedCost:40, varCost:25});
  await page.reload();
  await page.selectOption('#unitList', {label: 'Falla de guardado al confirmar'});
  await expect(page.locator('#unitName')).toHaveValue('Falla de guardado al confirmar', {timeout: 5000});

  page.once('dialog', d => d.accept());
  await page.locator('#createUsdCopyBtn').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#unitName')).toHaveValue(/copia USD — pendiente de revisión manual/, {timeout: 5000});
  await expect(page.locator('#confirmUsdReviewBtn')).toBeVisible();

  // Simula un fallo real de persistencia (ej. storage lleno/no disponible)
  // — window.storage.set() empieza a devolver `false` para CUALQUIER
  // escritura posterior, sin lanzar excepción.
  await page.evaluate(() => { window.storage.set = async () => false; });

  page.once('dialog', d => d.accept()); // confirm() del texto de revisión
  await page.locator('#confirmUsdReviewBtn').click();
  await page.waitForTimeout(300);

  // La unidad debe seguir exactamente igual de bloqueada — ni el banner, ni
  // los KPIs, ni el botón deben cambiar a "revisado".
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');
  await expect(page.locator('#currencyDisplay')).toHaveText('USD (copia pendiente de revisión manual)');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#confirmUsdReviewBtn')).toBeVisible();
  await expect(page.locator('#saveStatus')).not.toHaveText('Revisión manual confirmada ✓');
  const statusText = await page.locator('#saveStatus').innerText().catch(()=>'');
  expect(statusText.toLowerCase()).toContain('error');

  // Restaurar el storage real (recargando la página) confirma que el
  // estado persistido en disco NUNCA se corrompió — sigue pendiente.
  await page.reload();
  await page.selectOption('#unitList', {label: 'Falla de guardado al confirmar (copia USD — pendiente de revisión manual)'});
  await expect(page.locator('#unitName')).toHaveValue(/copia USD — pendiente de revisión manual/, {timeout: 5000});
  await expect(page.locator('#currencyReviewBanner')).toContainText('REQUIERE REVISIÓN MANUAL');

  // Ahora sí, con el storage real funcionando, la confirmación normal debe funcionar.
  page.once('dialog', d => d.accept());
  await page.locator('#confirmUsdReviewBtn').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#currencyReviewBanner')).toHaveText('');
  await expect(page.locator('#currencyDisplay')).toHaveText('USD');

  // limpieza
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
  await page.selectOption('#unitList', {label: 'Falla de guardado al confirmar'});
  page.once('dialog', d => d.accept());
  await page.locator('#deleteUnit').click();
});
