/* "Tarifas de aseo por canal" (Resumen, sep 2026) — pedido textual del dueño:
   "dame un espacio para poder subir esos items de aseo para cada OTA".

   Lo que este spec protege, en un navegador real:
   1. Los CUATRO canales aparecen en una sola tabla (antes había que recorrer
      cuatro pestañas y Directo no tenía input).
   2. Cada fila muestra cuánto aporta ese cargo fijo POR NOCHE a 1, 3 y 7 noches
      — la dilución, que es el concepto que el panel existe para enseñar.
   3. NO hay estado duplicado: el input del panel y el de la pestaña del canal
      son dos vistas del MISMO `state.channels[i].cleanFee*`, y editar cualquiera
      de los dos actualiza el otro en las dos direcciones. */
import {test, expect} from '@playwright/test';

const panel = '#cleanFeesMount';

test('el panel lista los cuatro canales con su input de aseo, Directo incluido', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#cleanFeesSection')).toBeVisible();
  for(const [chId, field] of [['airbnb','cleanFeeShort'], ['airbnb','cleanFeeLong'], ['booking','cleanFee'], ['expedia','cleanFee'], ['direct','cleanFee']]){
    await expect(page.locator(`${panel} [data-chid="${chId}"][data-chf="${field}"]`)).toBeVisible();
  }
  // cada input tiene su <label for> asociado (accesibilidad)
  await expect(page.locator(`${panel} label[for="cf-direct-cleanFee"]`)).toBeVisible();
  await expect(page.locator(`${panel} label[for="cf-airbnb-cleanFeeShort"]`)).toBeVisible();
});

test('cada fila muestra cuánto aporta por noche a 1, 3 y 7 noches (la dilución del cargo fijo)', async ({page}) => {
  await page.goto('/index.html');
  const expedia = page.locator(`${panel} [data-chid="expedia"][data-chf="cleanFee"]`);
  await expedia.fill('35');
  await expedia.dispatchEvent('change');

  const row = page.locator(`${panel} tbody tr`).filter({has: page.locator('[data-chid="expedia"]')});
  const cells = row.locator('td.out');
  await expect(cells).toHaveCount(3);
  // 35 a 1 noche, 35/3 = 11,67 a 3 noches, 35/7 = 5,00 a 7 noches
  await expect(cells.nth(0)).toContainText('35,00');
  await expect(cells.nth(1)).toContainText('11,67');
  await expect(cells.nth(2)).toContainText('5,00');
});

test('sin estado duplicado: editar en el panel se refleja en la pestaña del canal, y al revés', async ({page}) => {
  await page.goto('/index.html');
  const panelInput = page.locator(`${panel} [data-chid="direct"][data-chf="cleanFee"]`);
  const tabInput = page.locator('.tab-panel[data-tab="ch-direct"] [data-chid="direct"][data-chf="cleanFee"]');

  await expect(panelInput).toHaveValue('0');
  await expect(tabInput).toHaveValue('0');

  // panel -> pestaña
  await panelInput.fill('40');
  await panelInput.dispatchEvent('change');
  await expect(tabInput).toHaveValue('40');

  // pestaña -> panel
  await page.locator('[data-tabbtn="ch-direct"]').click();
  await tabInput.fill('55');
  await tabInput.dispatchEvent('change');
  await page.locator('[data-tabbtn="resumen"]').click();
  await expect(panelInput).toHaveValue('55');
  await expect(page.locator(`${panel} tbody tr`).filter({has: page.locator('[data-chid="direct"]')}).locator('td.out').first()).toContainText('55,00');
});

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

test('cobrar aseo en Directo BAJA el Min Price — nunca lo sube (el aseo es ingreso)', async ({page}) => {
  /* Unidad 902 real (costos confirmados y LM gradual verificado, si no el KPI de
     Min Price sale "—" por los gates de siempre), con el aseo de Airbnb en 30:
     ahí Directo es el canal que MANDA el Piso justamente porque es el único que
     no cobra aseo (74,83). Cargarle su propia tarifa tiene que bajar ese
     número. */
  await page.goto('/index.html');
  await importUnit(page, 'Aseo directo e2e', {
    currency:'USD', fixedCost:0, varCost:0, margin:25, marketWindow:9, marketBase:0, avgNights:4,
    costBreakdown:{rent:700, admin:140, utilities:108, insurance:5, tech:22, occNights:26, cleaning:20, laundry:5, consumables:4, supplies:5},
    costBreakdownConfirmed:true,
    channels:[
      {id:'airbnb', comm:15.5, bankFeePct:0, offsetPct:16, cleanFeeShort:30, cleanFeeLong:25, settlementCurrency:null},
      {id:'booking', comm:21, bankFeePct:6, offsetPct:75, cleanFee:37.5, settlementCurrency:null},
      {id:'expedia', comm:25, bankFeePct:0, offsetPct:70, cleanFee:35, settlementCurrency:null},
      {id:'direct', comm:3, bankFeePct:6, offsetPct:5, cleanFee:0, settlementCurrency:null}
    ],
    discounts:[
      {id:'ab_los2', pct:14, on:true},{id:'ab_los3', pct:14, on:true},{id:'ab_los4', pct:25, on:true},
      {id:'ab_los5', pct:10, on:true, minN:4},{id:'ab_los6', pct:15, on:true, minN:21},{id:'ab_los7', pct:21, on:true, minN:35},
      {id:'ab_eb2', pct:15, on:true},{id:'ab_topguest', pct:15, on:true},
      {id:'bk_gen', pct:10, on:true},{id:'bk_mob', pct:10, on:true},{id:'bk_cty', pct:5, on:true},
      {id:'ex_mod', pct:20, on:true},{id:'ex_mob', pct:10, on:true},{id:'ex_los1', pct:15, on:true}
    ],
    ceilings:{w0:40,w1:30,w2:15,w3:0,w4:0,w5:15},
    lmConfig:{mode:'gradual', verified:true, flat:{pct:0,fromDay:0,toDay:3,on:false}, gradual:{maxPct:28, days:6, on:true}, fixedPrice:{price:0,fromDay:0,toDay:3,on:false}, tiers:[]}
  });
  await page.reload();
  await page.selectOption('#unitList', {label:'Aseo directo e2e'});
  await expect(page.locator('#kFloor')).not.toHaveText('—');

  const readFloor = async () => {
    const t = await page.locator('#kFloor').innerText();
    return parseFloat(t.replace(/[^\d.,]/g,'').replace(/\./g,'').replace(',','.'));
  };
  const before = await readFloor();
  expect(before, 'el Piso de partida es el de Directo (74,83 → 75)').toBe(75);
  await expect(page.locator('#kFloorWhy')).toContainText('Directo');

  const direct = page.locator(`${panel} [data-chid="direct"][data-chf="cleanFee"]`);
  await direct.fill('25');
  await direct.dispatchEvent('change');
  const after = await readFloor();
  expect(after, 'cargarle aseo a Directo tiene que BAJAR el Min Price, nunca subirlo').toBeLessThan(before);
  await expect(page.locator('#kFloorWhy'), 'con aseo propio, Directo deja de ser el canal más ajustado').not.toContainText('Directo');
});
