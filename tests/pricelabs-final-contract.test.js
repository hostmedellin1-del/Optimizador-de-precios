/* Contrato explícito del Min Price final de PriceLabs. No basta que la
   fórmula sea correcta: una unidad real no puede usarla hasta confirmar que
   PriceLabs no cruza su propio campo de mínimo con ajustes internos. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {defaultVerification} from '../src/domain/verification.js';
import {normalizeUnit, buildDuplicateUnit} from '../src/domain/persistence.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function resolvedVerification(){
  const verification=defaultVerification();
  Object.values(verification.bankFeePctByChannel).forEach(x=>{x.status='no_aplica';});
  verification.bookingGeniusMobileBoth.status='no_aplica';
  verification.expediaVipTierMix.status='no_aplica';
  verification.airbnbNonRefundable.status='no_aplica';
  verification.airbnbTopRatedGuest.status='no_aplica';
  return verification;
}

test('Piso final queda bloqueado hasta confirmar el contrato PriceLabs, aunque Base solo esté bloqueado por LM', () => {
  const channels=freshChannels();
  const discounts=freshDiscounts().map(d=>({...d, on:false}));
  const windows=freshWindows();
  const common={fixedCost:80, varCost:0, margin:30, marketBase:0, channels, discounts, windows, ceilings:defaultCeilings(windows), verification:resolvedVerification()};
  const pending=compute({...common, priceLabsMinPriceContractConfirmed:false});
  assert.equal(pending.floorContractBlocked, true);
  assert.equal(pending.floorReadinessBlocked, true);
  assert.match(pending.floorReadinessBlockedReason, /Precio mínimo/);
  assert.equal(pending.baseReadinessBlocked, true, 'Base sigue bloqueado por LM automático sin verificar');

  const confirmed=compute({...common, priceLabsMinPriceContractConfirmed:true});
  assert.equal(confirmed.floorReadinessBlocked, false, 'el Piso se libera: no depende del LM interno');
  assert.equal(confirmed.baseReadinessBlocked, true, 'Base aún requiere confirmar su curva LM');
});

test('persistencia segura: unidades viejas y duplicados nunca heredan la confirmación del piso final', () => {
  const old=normalizeUnit({name:'Unidad vieja', currency:'USD'}).state;
  assert.equal(old.priceLabsMinPriceContractConfirmed, false);
  const reviewed=normalizeUnit({name:'Unidad revisada', currency:'USD', priceLabsMinPriceContractConfirmed:true}).state;
  assert.equal(reviewed.priceLabsMinPriceContractConfirmed, true);
  const duplicate=buildDuplicateUnit(reviewed, 'Copia segura').state;
  assert.equal(duplicate.priceLabsMinPriceContractConfirmed, false);
});
