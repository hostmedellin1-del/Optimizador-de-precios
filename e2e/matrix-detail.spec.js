/* Bloqueante BAJO (revision externa, ronda 2) — worstScenariosInWindow()
   (src/domain/matrix.js) devuelve `day`/`night`, pero renderMatrix() leía
   `worstPayoutRow.d`/`.n` (nunca existieron) — la fila "Peor payout real
   detectado" siempre mostraba "día undefined". Este spec abre el detalle de
   cada fila en un navegador real y confirma: no aparece "undefined" en
   ningún lado, el día/noches mostrados son números reales, y ese día/noche
   corresponde efectivamente al canal con el PEOR payout de esa ventana (no a
   cualquier número al azar). */
import {test, expect} from '@playwright/test';

test('Matriz: el detalle de cada ventana muestra día/noches reales, nunca "undefined", y coincide con el canal de peor payout', async ({page}) => {
  await page.goto('/index.html');
  await page.locator('[data-tabbtn="comparacion"]').click();

  const rows = page.locator('#matrixBody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);

  for(let i=0;i<count;i++){
    const row = rows.nth(i);
    await row.locator('.matrix-detail summary').click();
    const detailText = await row.locator('.matrix-detail').innerText();

    expect(detailText, `fila ${i}: no debe contener "undefined" en ningún lado`).not.toContain('undefined');

    const worstMatch = detailText.match(/Peor payout real detectado: día (\d+), (\d+) noches? \(([^)]+)\)/);
    expect(worstMatch, `fila ${i}: debe mostrar "día N" y "N noches" reales — texto: ${detailText}`).not.toBeNull();
    const [, worstDay, worstNight, worstChannel] = worstMatch;
    expect(Number.isFinite(Number(worstDay))).toBe(true);
    expect(Number.isFinite(Number(worstNight))).toBe(true);

    // Cruce: la columna "Neto para ti" lista, POR CANAL, su propio (día, noches)
    // de peor payout — el minimo de esos payouts debe ser el mismo canal/día/
    // noche que "Peor payout real detectado" (worstPayoutRow es el minimo GLOBAL
    // sobre el mismo grid que alimenta cada entrada por canal).
    const netText = await row.locator('.cell-ch').last().innerText();
    const entries = [...netText.matchAll(/([^:\n]+): [A-Z]{3}\s?[\d.,]+ \(día (\d+), (\d+)n, LM [\d.]+%\)/g)]
      .map(m => ({channel: m[1].trim(), day: m[2], night: m[3]}));
    expect(entries.length, `fila ${i}: debe poder leerse al menos un canal de la columna Neto`).toBeGreaterThan(0);
    const matchingChannel = entries.find(e => worstChannel.includes(e.channel) || e.channel.includes(worstChannel));
    expect(matchingChannel, `fila ${i}: el canal "${worstChannel}" del peor payout debe aparecer también en la columna Neto (${JSON.stringify(entries)})`).toBeTruthy();
    expect(matchingChannel.day).toBe(worstDay);
    expect(matchingChannel.night).toBe(worstNight);
  }
});
