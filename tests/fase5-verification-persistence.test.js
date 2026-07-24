/* Fase 5 (revision externa — "datos financieros verificados") — punto 4 y 7
   del encargo: el registro de verificacion ahora guarda status/fuente/fecha/
   nota (antes solo status/nota), y las claves por canal (bankFeePctByChannel)
   guardan un registro POR CANAL, no uno solo plano. normalizeUnit() es la
   UNICA puerta de entrada para cualquier unidad guardada o importada — estos
   tests prueban que:
   1. Una unidad guardada con el formato NUEVO (source/date/note, por canal)
      sobrevive el ciclo completo import/export exactamente.
   2. Una unidad del formato VIEJO (pre-fase-5: bankFeePctByChannel plano, sin
      source/date) migra de forma segura — cada canal arranca 'no_verificado',
      JAMAS hereda un 'verificado' de un registro que no era por canal.
   3. Un payload malformado/malicioso (status inventado, source no-string,
      fecha con forma invalida, entradas null) nunca puede terminar marcando
      algo como verificado, y nunca rompe normalizeUnit(). */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUnit} from '../src/domain/persistence.js';
import {defaultVerification, isVerified} from '../src/domain/verification.js';

test('formato NUEVO (fase 5): status/source/date/note sobreviven el ciclo de normalizeUnit exactamente, para claves globales y por canal', () => {
  const verification = defaultVerification();
  verification.hospyOffsetIsolated = {status:'verificado', source:'chat soporte Hospy #4521', date:'2026-07-10', note:'confirmado por escrito'};
  verification.bankFeePctByChannel.booking = {status:'verificado', source:'extracto Bancolombia', date:'2026-07-15', note:''};
  verification.bankFeePctByChannel.airbnb = {status:'no_aplica', source:'', date:'', note:'Airbnb no cobra comision bancaria en este listing'};
  const {state, warnings} = normalizeUnit({name:'Unidad nueva', verification});
  assert.deepEqual(state.verification.hospyOffsetIsolated, verification.hospyOffsetIsolated);
  assert.deepEqual(state.verification.bankFeePctByChannel.booking, verification.bankFeePctByChannel.booking);
  assert.deepEqual(state.verification.bankFeePctByChannel.airbnb, verification.bankFeePctByChannel.airbnb);
  assert.equal(state.verification.bankFeePctByChannel.expedia.status, 'no_verificado', 'un canal que no se toco sigue en el default seguro');
  assert.equal(warnings.filter(w=>w.startsWith('verification')).length, 0, 'un formato bien formado no debe generar warnings');
});

test('migracion segura: unidad VIEJA con bankFeePctByChannel PLANO (pre-fase-5, sin per-canal) — cada canal arranca no_verificado, NUNCA hereda "verificado" del registro plano viejo', () => {
  const oldShapeUnit = {
    name: 'Unidad vieja',
    verification: {
      hospyOffsetIsolated: {status:'verificado', note:'ya lo habia confirmado antes'},
      bankFeePctByChannel: {status:'verificado', note:'confirme esto hace meses, formato viejo'}
    }
  };
  const {state, warnings} = normalizeUnit(oldShapeUnit);
  // Clave global (sin cambio de forma): la migracion SI puede preservar 'verificado' — el
  // encargo pide "nunca inventar" verificado, no pide destruir uno que ya era legitimo
  // y de la MISMA forma (global) antes y despues de esta fase.
  assert.equal(state.verification.hospyOffsetIsolated.status, 'verificado');
  assert.equal(state.verification.hospyOffsetIsolated.note, 'ya lo habia confirmado antes');
  // Clave que CAMBIO de forma (plana -> por canal): el registro viejo no tiene
  // sub-claves por canal (raw.bankFeePctByChannel.booking es undefined), asi
  // que TODOS los canales deben caer al default seguro, nunca heredar el
  // 'verificado' del registro plano de antes.
  ['airbnb','booking','expedia','direct'].forEach(chId=>{
    assert.equal(state.verification.bankFeePctByChannel[chId].status, 'no_verificado', `${chId} debe migrar a no_verificado, nunca heredar 'verificado' de un formato plano previo`);
    assert.equal(isVerified(state.verification, 'bankFeePctByChannel', chId), false);
  });
});

test('unidad completamente vieja (sin claves de verificacion en absoluto) recibe el default completo — nunca "verificado" por ausencia de dato', () => {
  const {state} = normalizeUnit({name:'Muy vieja', channels:[], discounts:[]});
  assert.deepEqual(state.verification, defaultVerification());
});

test('payload malformado: status inventado NUNCA se acepta como verificado — cae a no_verificado con warning', () => {
  const {state, warnings} = normalizeUnit({name:'Evil', verification: {
    hospyOffsetIsolated: {status:'TOTALMENTE_CONFIABLE_CONFIA_EN_MI', source:'', date:'', note:''}
  }});
  assert.equal(state.verification.hospyOffsetIsolated.status, 'no_verificado');
  assert.ok(warnings.some(w=>w.includes('hospyOffsetIsolated.status')));
});

test('payload malformado: source/note no-string, fecha con forma invalida — se descartan a favor del default, con warning, nunca rompen normalizeUnit', () => {
  assert.doesNotThrow(() => normalizeUnit({name:'Evil', verification: {
    hospyOffsetIsolated: {status:'verificado', source: 12345, date:'no-es-una-fecha', note: {a:1}},
    bankFeePctByChannel: {booking: {status:'verificado', source: ['a','b'], date:'2026-99-99', note: null}}
  }}));
  const {state, warnings} = normalizeUnit({name:'Evil', verification: {
    hospyOffsetIsolated: {status:'verificado', source: 12345, date:'no-es-una-fecha', note: {a:1}},
    bankFeePctByChannel: {booking: {status:'verificado', source: ['a','b'], date:'2026-99-99', note: null}}
  }});
  assert.equal(state.verification.hospyOffsetIsolated.status, 'verificado', 'un status VALIDO en un objeto que ademas tiene otros campos malformados sigue siendo un status legitimo — solo esos otros campos se descartan');
  assert.equal(state.verification.hospyOffsetIsolated.source, '', 'source no-string se descarta a favor del default');
  assert.equal(state.verification.hospyOffsetIsolated.date, '', 'fecha con forma invalida se descarta a favor del default');
  assert.equal(state.verification.hospyOffsetIsolated.note, '', 'note no-string se descarta a favor del default');
  // La validacion de fecha es de FORMA (AAAA-MM-DD), no de calendario real —
  // es un campo de auditoria en texto libre, no un dato que alimente ningun
  // calculo financiero, asi que exigir un calendario 100% valido es
  // complejidad sin beneficio real. Lo unico que debe garantizarse es que
  // nunca rompe normalizeUnit() y que un status invalido/objeto malformado
  // en el resto de la entrada no se propaga a otras claves.
  assert.equal(state.verification.bankFeePctByChannel.booking.status, 'verificado');
  assert.ok(warnings.some(w=>w.includes('verification.')));
});

test('payload malformado: un canal con valor no-objeto (string suelto) en una clave por canal no rompe normalizeUnit y cae al default', () => {
  assert.doesNotThrow(() => normalizeUnit({name:'Evil', verification: {
    bankFeePctByChannel: {booking: 'esto no es un objeto de verificacion', airbnb: null, expedia: 42, direct: [1,2,3]}
  }}));
  const {state} = normalizeUnit({name:'Evil', verification: {
    bankFeePctByChannel: {booking: 'esto no es un objeto de verificacion', airbnb: null, expedia: 42, direct: [1,2,3]}
  }});
  ['booking','airbnb','expedia','direct'].forEach(chId=>{
    assert.equal(state.verification.bankFeePctByChannel[chId].status, 'no_verificado');
  });
});

test('payload malformado: verification completo no-objeto (string, numero, array) no rompe normalizeUnit y da el default completo', () => {
  for(const badVerification of ['texto', 42, [1,2,3], true]){
    assert.doesNotThrow(() => normalizeUnit({name:'Evil', verification: badVerification}));
    const {state} = normalizeUnit({name:'Evil', verification: badVerification});
    assert.deepEqual(state.verification, defaultVerification());
  }
});

test('"no_aplica" (respuesta explicita, no pendiente) sobrevive el ciclo de normalizacion sin degradarse a no_verificado', () => {
  const {state} = normalizeUnit({name:'X', verification: {
    airbnbNonRefundable: {status:'no_aplica', source:'', date:'', note:'este listing no tiene no-reembolsable activo'}
  }});
  assert.equal(state.verification.airbnbNonRefundable.status, 'no_aplica');
});
