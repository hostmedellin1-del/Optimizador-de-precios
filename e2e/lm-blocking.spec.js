/* Bloqueante CRITICO (revision externa, ronda 2) — quoteScenario() ya exponia
   lmBlocked por escenario, pero compute() seguia devolviendo valid:true y la
   UI mostraba Min Price/Base Price como recomendaciones usables incluso con
   la CONFIGURACION POR DEFECTO (LM automatico, sin verificar). Este spec
   prueba en un navegador real que:
   1. La app, tal como carga, NO deja usar Min Price/Base Price/Offset como
      recomendacion — explica que falta y en que pantalla arreglarlo.
   2. Verificar el LM (o cambiar a un modo configurable y marcarlo verificado)
      desbloquea esos numeros.
   3. La Matriz nunca muestra "RENTABLE EN TODOS" sostenido solo por un LM sin
      verificar — el tag cambia, no se le agrega solo una advertencia.

   Fase 5 (revision externa — "datos financieros verificados"): Min Price/Base
   Price ahora tienen un SEGUNDO gate ortogonal a LM — datos de negocio
   (comision bancaria real, Genius+Mobile de Booking, VIP de Expedia, etc,
   ver src/domain/readiness.js). Verificar LM ya NO es suficiente por si solo
   para desbloquear con el catalogo de fabrica (que trae esos datos activos
   y sin confirmar) — los tests que antes asumian "solo LM" ahora usan
   resolveAllFinancialFacts() para aislar especificamente el comportamiento
   de LM bajo prueba, dejando el resto de los datos ya resueltos. */
import {test, expect} from '@playwright/test';

async function resolveAllFinancialFacts(page){
  await page.locator('[data-tabbtn="resumen"]').click();
  await page.selectOption('select[data-verif-status="hospyOffsetIsolated"]', 'no_aplica');
  await page.selectOption('select[data-verif-status="bookingGeniusMobileBoth"]', 'verificado');
  await page.selectOption('select[data-verif-status="expediaVipTierMix"]', 'verificado');
  await page.selectOption('select[data-verif-status="airbnbNonRefundable"]', 'no_aplica');
  for(const chId of ['airbnb','booking','expedia','direct']){
    await page.selectOption(`select[data-verif-status="bankFeePctByChannel"][data-verif-ch="${chId}"]`, 'no_aplica');
  }
}

test('config por defecto: Min Price, Base Price y el Offset sugerido arrancan bloqueados por LM sin verificar', async ({page}) => {
  await page.goto('/index.html');
  await expect(page.locator('#kFloor')).toHaveText('—');
  await expect(page.locator('#kBase')).toHaveText('—');
  await expect(page.locator('#kFloorWhy')).toContainText('LM sin verificar');
  await expect(page.locator('#kBaseWhy')).toContainText('LM sin verificar');

  // #validationBanner vive en la pestaña Resumen (activa por defecto) — el
  // aviso explica EXACTAMENTE que falta y en que pantalla arreglarlo.
  const banner = page.locator('#validationBanner');
  await expect(banner).toContainText('LM SIN VERIFICAR');
  await expect(banner).toContainText('Last-Minute de PriceLabs');
  await expect(banner.locator('button', {hasText: 'Ir a Last-Minute de PriceLabs'})).toBeVisible();

  // El Offset sugerido / neto estimado de cada canal tambien queda bloqueado
  // (no solo Min Price/Base Price) — se verifica en su propia pestaña.
  await page.locator('[data-tabbtn="ch-booking"]').click();
  await expect(page.locator('.offset-hint').first()).toContainText('bloqueados');
  await expect(page.locator('.offset-hint').first()).toContainText('Last-Minute de PriceLabs');
});

test('marcar el LM automático como "verificado" NO desbloquea — sigue siendo una proyección, nunca un hecho confirmable', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-lm="verified"]').check();
  await expect(page.locator('#kFloor')).toHaveText('—', {timeout: 3000});
  await expect(page.locator('#validationBanner')).toContainText('LM SIN VERIFICAR');
});

test('cambiar a un modo configurable (plano) y marcarlo verificado SÍ desbloquea Min Price/Base Price', async ({page}) => {
  await page.goto('/index.html');
  /* BLOQUEANTE 2 (auditoria externa, ronda 4): con los costos de fábrica
     (32/22, nunca tocados) el gate de costos por sí solo mantendría Min
     Price/Base Price bloqueados aunque LM/datos de negocio ya estén
     resueltos — este test aísla específicamente el mecanismo de LM, así
     que se cargan costos reales (no el ejemplo) primero. */
  const fc = page.locator('[data-k="fixedCost"]');
  await fc.click(); await fc.fill('40'); await fc.dispatchEvent('change');
  const vc = page.locator('[data-k="varCost"]');
  await vc.click(); await vc.fill('25'); await vc.dispatchEvent('change');
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lmf="flat.on"]').check();
  await page.locator('[data-lmf="flat.pct"]').fill('20');
  await page.locator('[data-lmf="flat.pct"]').dispatchEvent('change');
  await page.locator('[data-lm="verified"]').check();
  await resolveAllFinancialFacts(page); // aisla el comportamiento de LM bajo prueba (Fase 5)

  await expect(page.locator('#validationBanner')).not.toContainText('LM SIN VERIFICAR');
  await expect(page.locator('#kFloor')).not.toHaveText('—', {timeout: 3000});
  await expect(page.locator('#kBase')).not.toHaveText('—');
});

test('Matriz: con la configuración de fábrica (Expedia VIP 20% siempre activo, ceilings ajustados), ninguna fila dice "RENTABLE EN TODOS" mientras el LM no esté verificado', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="comparacion"]').click();
  const tags = await page.locator('#matrixBody .v-tag').allInnerTexts();
  expect(tags.length).toBeGreaterThan(0);
  for(const tag of tags){
    expect(tag.trim(), 'ninguna fila puede quedar "RENTABLE EN TODOS" sin calificar mientras el LM no está verificado').not.toBe('RENTABLE EN TODOS');
  }
});

test('Matriz: un escenario que SERÍA "RENTABLE EN TODOS" con LM verificado, se muestra bloqueado mientras no lo esté — y se desbloquea al verificar', async ({page}) => {
  await page.goto('/index.html');
  // Escenario generoso: costo bajo, margen bajo, sin descuentos nativos activos
  // — a nativos puros esto es rentable en cualquier ventana. El único motivo
  // por el que el veredicto depende de algo no verificado es el LM por defecto.
  await page.locator('[data-k="fixedCost"]').fill('5');
  await page.locator('[data-k="fixedCost"]').dispatchEvent('change');
  await page.locator('[data-k="varCost"]').fill('0');
  await page.locator('[data-k="varCost"]').dispatchEvent('change');
  await page.locator('[data-k="margin"]').fill('5');
  await page.locator('[data-k="margin"]').dispatchEvent('change');
  await page.evaluate(async () => {
    let guard = 0;
    while(guard++ < 50){
      const cb = document.querySelector('[data-did][data-f="on"]:checked');
      if(!cb) break;
      cb.checked = false;
      cb.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });

  await page.locator('[data-tabbtn="comparacion"]').click();
  const blockedTags = await page.locator('#matrixBody .v-tag').allInnerTexts();
  expect(blockedTags.every(t => t.includes('SIN VERIFICAR')), `todas las filas deberían depender del LM sin verificar: ${JSON.stringify(blockedTags)}`).toBe(true);
  expect(blockedTags.some(t => t.trim()==='RENTABLE EN TODOS')).toBe(false);

  // Verificar el LM (modo plano, marcado como confirmado) desbloquea el mismo escenario:
  // el selector de LM vive en Resumen, no en Comparación.
  await page.locator('[data-tabbtn="resumen"]').click();
  await page.selectOption('[data-lm="mode"]', 'flat');
  await page.locator('[data-lm="verified"]').check();
  await resolveAllFinancialFacts(page); // aisla el comportamiento de LM bajo prueba (Fase 5)
  await page.locator('[data-tabbtn="comparacion"]').click();
  const unblockedTags = await page.locator('#matrixBody .v-tag').allInnerTexts();
  expect(unblockedTags.every(t => t.trim()==='RENTABLE EN TODOS'), `una vez verificado, el mismo escenario generoso debería quedar "RENTABLE EN TODOS": ${JSON.stringify(unblockedTags)}`).toBe(true);
});
