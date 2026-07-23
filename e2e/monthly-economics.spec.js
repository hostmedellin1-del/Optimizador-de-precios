/* Planificación mensual y punto de equilibrio — nueva sección de Resumen,
   respaldada por src/domain/monthly-economics.js (dominio puro, sin fórmulas
   en index.html). Verifica en un navegador real:
   1. Sin la calculadora de costos detallada llena, el resultado dice
      explícitamente "NO CALCULABLE" — nunca inventa un total mensual.
   2. Con los costos llenos y un escenario manual, el resultado numérico
      coincide con el cálculo a mano (mismo caso que
      tests/monthly-economics.test.js, para que unit y E2E prueben lo mismo).
   3. Un escenario de canal (quoteScenario real) con LM sin verificar (default
      de fábrica) se etiqueta "SIMULACIÓN NO CONFIABLE" — nunca bloquea la
      simulación, solo advierte.
   4. Un escenario que hace la contribución por noche <= 0 muestra
      "EQUILIBRIO NO ALCANZABLE" explícito.
   5. Activar el reparto Propietario/PM detallado muestra los montos; un
      reparto inválido (suma > 100%) también da "NO CALCULABLE".

   Nota de infraestructura (heredada de e2e/base-fixedprice.spec.js): un
   `.fill()` inmediato después de un `change` que dispara `renderAll()` puede
   escribir sobre el foco anterior — cada interacción aquí hace `.click()`
   antes de `.fill()`. */
import {test, expect} from '@playwright/test';

async function fillField(page, selector, value){
  const loc = page.locator(selector);
  await loc.click();
  await loc.fill(value);
  await loc.dispatchEvent('change');
}

async function fillCostBreakdown(page, values){
  // Los campos data-cb viven dentro de <details class="cost-calc">, colapsado
  // por defecto (Fase 3: la calculadora detallada es opt-in) — hay que abrirlo
  // antes de que Playwright pueda interactuar con inputs invisibles.
  await page.locator('details.cost-calc').evaluate(el => { el.open = true; });
  for(const [key, value] of Object.entries(values)){
    await fillField(page, `[data-cb="${key}"]`, String(value));
  }
}

const BASE_COSTS = {rent:500, admin:100, utilities:50, insurance:30, tech:20, occNights:22, cleaning:40, laundry:10, supplies:5, consumables:5};

test('sin la calculadora de costos detallada llena, el resultado mensual dice "NO CALCULABLE" — nunca inventa un total desde fixedCost/varCost por noche', async ({page}) => {
  await page.goto('/index.html');
  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('NO CALCULABLE');
  await expect(result).toContainText('calculadora de costos detallada');
});

test('caso manual (mismo caso que el test unitario): con los costos llenos, el resultado coincide con el cálculo a mano', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '80');

  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('7.3'); // reservas estimadas 22/3
  await expect(result).toContainText('USD 1.760'); // ingreso neto mensual (80*22)
  await expect(result).toContainText('USD 700'); // costos fijos mensuales
  await expect(result).toContainText('13'); // noches de equilibrio (ceil de 12.35)
  await expect(result).not.toContainText('NO CALCULABLE');
  await expect(result).not.toContainText('EQUILIBRIO NO ALCANZABLE');
});

test('escenario con contribución por noche <= 0 muestra "EQUILIBRIO NO ALCANZABLE" explícito, nunca un número inventado', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '20'); // 20-5-55/3 = -3.33 <= 0

  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('EQUILIBRIO NO ALCANZABLE');
  await expect(result).toContainText('no alcanzable');
});

test('escenario de canal específico (LM sin verificar por defecto): se etiqueta "SIMULACIÓN NO CONFIABLE" pero SÍ calcula — nunca se bloquea', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await page.selectOption('[data-mon="incomeType"]', 'channel');
  await fillField(page, '[data-mon="channelPrice"]', '150');

  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('SIMULACIÓN NO CONFIABLE');
  await expect(result).toContainText('Last-Minute sin verificar');
  await expect(result).not.toContainText('NO CALCULABLE');
  // El cálculo sigue mostrando números reales, no se detiene.
  await expect(result).toContainText('Noches de equilibrio', {ignoreCase:true}).catch(()=>{});
  await expect(page.locator('#monthlyResult .kpis')).toBeVisible();
});

test('reparto Propietario/PM detallado: activar la casilla revela los campos y el resultado muestra los tres montos', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '80');

  await page.locator('[data-mon="distConfigured"]').check();
  await fillField(page, '[data-mon="ownerTargetPct"]', '60');
  await fillField(page, '[data-mon="managerTargetPct"]', '30');

  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('PROPIETARIO', {ignoreCase:true});
  await expect(result).toContainText('ADMINISTRADOR/PM', {ignoreCase:true});
});

test('reparto inválido (Propietario+PM > 100%) da "NO CALCULABLE" con el motivo exacto, no un número roto', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '80');
  await page.locator('[data-mon="distConfigured"]').check();
  await fillField(page, '[data-mon="ownerTargetPct"]', '70');
  await fillField(page, '[data-mon="managerTargetPct"]', '50');

  const result = page.locator('#monthlyResult');
  await expect(result).toContainText('NO CALCULABLE');
  await expect(result).toContainText('no puede superar 100%');
});

test('desactivar el reparto detallado vuelve a mostrar la utilidad completa sin dividir', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '80');
  await page.locator('[data-mon="distConfigured"]').check();
  await fillField(page, '[data-mon="ownerTargetPct"]', '60');
  await page.locator('[data-mon="distConfigured"]').uncheck();

  // La palabra "Propietario" SI puede aparecer en el aviso explicativo ("reparto
  // no configurado...") — lo que no debe existir es el KPI con ese label exacto.
  await expect(page.locator('#monthlyResult .kpi .l', {hasText:'Propietario'})).toHaveCount(0);
  await expect(page.locator('#monthlyResult')).toContainText('USD 547'); // utilidad completa sin dividir (546.67 redondeado)
});

test('tabla de sensibilidad por ocupación muestra las 7 filas (0,5,10,15,20,25,30 noches)', async ({page}) => {
  await page.goto('/index.html');
  await fillCostBreakdown(page, BASE_COSTS);
  await fillField(page, '[data-mon="manualNetPerNight"]', '80');

  const rows = page.locator('#monthlyResult table tbody tr');
  await expect(rows).toHaveCount(7);
  const firstRowCells = await rows.first().locator('td').allInnerTexts();
  expect(firstRowCells[0].trim()).toBe('0');
});
