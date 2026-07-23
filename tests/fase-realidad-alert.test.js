/* BLOQUEANTE MEDIO (revision externa) — la alerta REALIDAD reimplementaba su
   propia formula (offset+nativo OTA+payoutFactor), sin LM ni tarifa de aseo.
   Migrada a worstScenarioFactor()+quoteScenario() — debe reflejar un LM real
   configurado en el margen "alcanzable" que reporta. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compute} from '../src/domain/engine.js';
import {buildAlerts} from '../src/domain/alerts.js';
import {defaultLmConfig} from '../src/catalog/discounts.js';
import {freshChannels, freshDiscounts, freshWindows, defaultCeilings} from './helpers/state-factory.js';

function baseAlertsConfig(extra={}){
  const channels = freshChannels();
  const discounts = freshDiscounts().map(d=>({...d, on:false}));
  const windows = freshWindows();
  const ceilings = defaultCeilings(windows);
  return {discounts, channels, windows, ceilings, marketWindow:16, marketBase:150,
    chTab:{airbnb:'ch-airbnb', booking:'ch-booking', expedia:'ch-expedia', direct:'ch-direct'},
    currency:'USD', margin:80, ...extra};
}

function findRealidad(alerts){ return alerts.find(a=>a.tag==='REALIDAD'); }

test('alerta REALIDAD refleja un LM real activo — el margen "alcanzable" baja cuando hay LM verificado', () => {
  const configBase = baseAlertsConfig();
  const model = compute({fixedCost:60, varCost:0, margin:80, marketBase:150, channels:configBase.channels, discounts:configBase.discounts, windows:configBase.windows, ceilings:configBase.ceilings});

  const alertsSinLm = buildAlerts(configBase, model);
  const r1 = findRealidad(alertsSinLm);

  const lmConfig = {...defaultLmConfig(), mode:'flat', verified:true, flat:{pct:40, fromDay:0, toDay:9999, on:true}};
  const modelConLm = compute({fixedCost:60, varCost:0, margin:80, marketBase:150, channels:configBase.channels, discounts:configBase.discounts, windows:configBase.windows, ceilings:configBase.ceilings, lmConfig});
  const alertsConLm = buildAlerts({...configBase, lmConfig}, modelConLm);
  const r2 = findRealidad(alertsConLm);

  assert.ok(r1, 'debe existir alerta REALIDAD sin LM en este escenario (Base muy por encima del mercado)');
  assert.ok(r2, 'debe existir alerta REALIDAD con LM tambien');
  assert.notEqual(r1.msg, r2.msg, 'el mensaje debe cambiar cuando hay un LM real de 40% activo — antes la formula ni lo miraba');
  assert.ok(r2.msg.includes('LM'), 'el mensaje ahora debe mencionar explicitamente que el peor caso incluye LM y aseo');
});
