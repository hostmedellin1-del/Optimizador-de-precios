import {test, expect} from '@playwright/test';

const snapshot={kind:'pricelabs-sync',version:1,listingId:'15195',pmsName:'otasync',fetchedAt:'2026-08-14T02:54:14Z',min:60,base:103,max:null,currency:'USD',recommendedBasePrice:103,prices:[{date:'2026-08-14',price:88,minStay:1},{date:'2026-08-15',price:96,minStay:1},{date:'2026-08-20',price:111,minStay:2}]};

async function saveUnit(page){
  await page.locator('#unitName').fill('PriceLabs Sync E2E');
  await page.locator('#saveUnit').click();
  await expect(page.locator('#saveStatus')).toContainText('Guardado');
  const fixed=page.locator('[data-k="fixedCost"]'); await fixed.fill('40'); await fixed.dispatchEvent('change');
  const variable=page.locator('[data-k="varCost"]'); await variable.fill('25'); await variable.dispatchEvent('change');
}

/* Fase 4 (ago 2026): Exportar/Importar/Sincronizar/Migrar viven ahora detrás
   del <details class="unit-bar-more"> ("Más opciones") — hay que abrirlo
   antes de poder clickear un botón oculto adentro. */
async function openMoreOptions(page){
  await page.locator('.unit-bar-more summary').click();
}

test('importa snapshot PriceLabs, muestra valores y no hace requests de red', async ({page})=>{
  await page.goto('/index.html');
  await saveUnit(page);
  await page.selectOption('[data-lm="mode"]','flat');
  await page.locator('[data-lm="verified"]').check();
  const requests=[]; page.on('request', req=>requests.push(req.url()));
  await openMoreOptions(page);
  await page.locator('#syncPricelabsBtn').click();
  await page.locator('#syncPricelabsFile').setInputFiles({name:'pricelabs.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snapshot))});
  await expect(page.locator('#pricelabsSyncCard')).toContainText('Según PriceLabs');
  await expect(page.locator('#pricelabsSyncCard')).toContainText('USD 60');
  await expect(page.locator('#pricelabsSyncCard')).toContainText('USD 103');
  await expect(page.locator('#pricelabsSyncCard')).toContainText('POR DEBAJO');
  await expect(page.locator('#pricelabsSyncCard')).toContainText('2026-08-14');
  expect(requests.filter(url=>/price|sync|api/i.test(url)), 'la sincronización no debe llamar APIs').toEqual([]);
});

test('listingId distinto pide confirmación y permite reemplazar', async ({page})=>{
  await page.goto('/index.html'); await saveUnit(page);
  const first={...snapshot,listingId:'one'};
  await openMoreOptions(page);
  await page.locator('#syncPricelabsBtn').click();
  await page.locator('#syncPricelabsFile').setInputFiles({name:'one.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(first))});
  await expect(page.locator('#pricelabsSyncCard')).toContainText('Listing one');
  page.once('dialog', d=>{ expect(d.message()).toContain('listing two'); d.accept(); });
  await page.locator('#syncPricelabsBtn').click();
  await page.locator('#syncPricelabsFile').setInputFiles({name:'two.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...snapshot,listingId:'two'}))});
  await expect(page.locator('#pricelabsSyncCard')).toContainText('Listing two');
});

test('botón queda inactivo sin unidad guardada', async ({page})=>{
  await page.goto('/index.html');
  await expect(page.locator('#syncPricelabsBtn')).toBeDisabled();
});
