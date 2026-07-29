import {test, expect} from '@playwright/test';

async function importUnit(page, name, extra){
  let imported = false;
  page.once('dialog', async dialog => { imported = true; await dialog.accept(); });
  const payload = {
    exportedAt:new Date().toISOString(), schemaVersion:3,
    units:[{key:`v3:e2e-${name.replace(/\s+/g, '-')}`, value:JSON.stringify({name, ...extra})}]
  };
  await page.setInputFiles('#importUnitsFile', {
    name:`${name.replace(/\s+/g, '-')}.json`, mimeType:'application/json', buffer:Buffer.from(JSON.stringify(payload))
  });
  await page.waitForTimeout(300);
  expect(imported).toBe(true);
}

function resolvedVerification(){
  const noAplica = {status:'no_aplica', source:'Extranet real', date:'2026-07-27', note:'Confirmado para esta unidad'};
  return {
    bookingGeniusMobileBoth:{...noAplica},
    expediaVipTierMix:{...noAplica},
    airbnbNonRefundable:{...noAplica},
    airbnbTopRatedGuest:{...noAplica},
    bankFeePctByChannel:{airbnb:{...noAplica}, booking:{...noAplica}, expedia:{...noAplica}, direct:{...noAplica}}
  };
}

function sourceConfig(){
  return {
    currency:'USD', fixedCost:46, varCost:23, margin:40, marketWindow:11, marketBase:160, avgNights:4,
    channels:[
      {id:'airbnb', comm:16.4, bankFeePct:1.2, offsetPct:3, cleanFeeShort:28, cleanFeeLong:42, settlementCurrency:null},
      {id:'booking', comm:19, bankFeePct:5, offsetPct:-2, settlementCurrency:null},
      {id:'expedia', comm:24, bankFeePct:2, offsetPct:1, settlementCurrency:null},
      {id:'direct', comm:4, bankFeePct:3, offsetPct:0, settlementCurrency:null}
    ],
    discounts:[
      {id:'ab_new', on:true, pct:19},
      {id:'ab_nonref', on:true, pct:7, verified:true},
      {id:'bk_gen', on:true, pct:12},
      {id:'bk_mob', on:true, pct:8}
    ],
    ceilings:{w0:31, w1:26, w2:17, w3:7, w4:1, w5:14},
    lmConfig:{
      mode:'flat', verified:true,
      flat:{pct:9, fromDay:1, toDay:5, on:true},
      gradual:{maxPct:0, days:3, on:false},
      fixedPrice:{price:0, fromDay:0, toDay:3, on:false}, tiers:[]
    },
    verification:resolvedVerification()
  };
}

async function deleteSelectedUnit(page){
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#deleteUnit').click();
}

test('Duplicar crea una nueva unidad bloqueada: conserva configuración, reinicia pruebas y deja intacto el origen', async ({page}) => {
  await page.goto('/index.html');
  await importUnit(page, 'Origen duplicable', sourceConfig());
  await page.reload();
  await page.selectOption('#unitList', {label:'Origen duplicable'});
  await expect(page.locator('#unitName')).toHaveValue('Origen duplicable');
  await expect(page.locator('#kFloor')).not.toHaveText('—');
  const originalFloor = await page.locator('#kFloor').innerText();
  const originalBase = await page.locator('#kBase').innerText();

  // El handler abre confirm() inmediatamente al cerrar prompt(). Un único
  // listener temporal evita una carrera entre ambos diálogos consecutivos.
  const duplicateDialogs = [];
  const duplicateDialogHandler = async dialog => {
    duplicateDialogs.push({type:dialog.type(), message:dialog.message()});
    await dialog.accept(dialog.type()==='prompt' ? 'Copia segura' : undefined);
  };
  page.on('dialog', duplicateDialogHandler);
  await page.locator('#duplicateUnit').click();
  await expect.poll(() => duplicateDialogs.length).toBe(2);
  page.off('dialog', duplicateDialogHandler);
  expect(duplicateDialogs[0].type).toBe('prompt');
  expect(duplicateDialogs[1].type).toBe('confirm');
  expect(duplicateDialogs[1].message).toContain('NO se copiarán confirmaciones financieras');
  await expect(page.locator('#unitName')).toHaveValue('Copia segura');
  await expect(page.locator('#unitList option', {hasText:'Copia segura'})).toHaveCount(1);

  // La configuración llega completa, pero las recomendaciones globales no.
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await expect(page.locator('[data-chid="airbnb"][data-chf="comm"]')).toHaveValue('16.4');
  await expect(page.locator('[data-chid="airbnb"][data-chf="cleanFeeShort"]')).toHaveValue('28');
  await expect(page.locator('[data-did="ab_new"][data-f="pct"]')).toHaveValue('19');
  await expect(page.locator('[data-did="ab_new"][data-f="on"]')).toBeChecked();
  await expect(page.locator('[data-did="ab_nonref"][data-f="pct"]')).toHaveValue('7');
  await page.locator('[data-tabbtn="resumen"]').click();
  await expect(page.locator('select[data-verif-status]')).toHaveCount(8);
  expect(await page.locator('select[data-verif-status]').evaluateAll(selects => selects.every(select => select.value === 'no_verificado'))).toBe(true);
  await expect(page.locator('#f-fixedCost')).toHaveValue('32');
  await expect(page.locator('#f-varCost')).toHaveValue('22');
  await expect(page.locator('#dataProvenanceBanner')).toContainText('EJEMPLO');

  // Regresar al origen prueba que no fue mutado al crear ni al activar el clon.
  await page.selectOption('#unitList', {label:'Origen duplicable'});
  await expect(page.locator('#unitName')).toHaveValue('Origen duplicable');
  await expect(page.locator('#kFloor')).toHaveText(originalFloor);
  await expect(page.locator('#kBase')).toHaveText(originalBase);
  await page.locator('[data-tabbtn="ch-airbnb"]').click();
  await expect(page.locator('[data-chid="airbnb"][data-chf="comm"]')).toHaveValue('16.4');
  await expect(page.locator('[data-did="ab_nonref"][data-f="pct"]')).toHaveValue('7');

  // Una copia USD todavía pendiente no puede ser duplicada otra vez.
  await page.locator('[data-tabbtn="resumen"]').click();
  await importUnit(page, 'USD pendiente no duplicable', {currency:'USD', usdManualReviewPending:true});
  await page.selectOption('#unitList', {label:'USD pendiente no duplicable'});
  await expect(page.locator('#unitName')).toHaveValue('USD pendiente no duplicable');
  const optionsBefore = await page.locator('#unitList option').count();
  await page.locator('#duplicateUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('No se puede duplicar');
  await expect(page.locator('#unitName')).toHaveValue('USD pendiente no duplicable');
  await expect(page.locator('#unitList option')).toHaveCount(optionsBefore);

  await deleteSelectedUnit(page);
  await page.selectOption('#unitList', {label:'Origen duplicable'});
  await deleteSelectedUnit(page);
  await page.selectOption('#unitList', {label:'Copia segura'});
  await deleteSelectedUnit(page);
});
