const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verificarToken, direccionDeRetornoValida, leerCuerpo } = require('../src/kommo');

const SECRETO = 'secreto-de-prueba';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function firmar(datos, { secreto = SECRETO, alg = 'HS256' } = {}) {
  const base = `${b64({ alg, typ: 'JWT' })}.${b64(datos)}`;
  return `${base}.${crypto.createHmac('sha256', secreto).update(base).digest('base64url')}`;
}
const ahora = Date.parse('2026-10-06T13:00:00Z');
const seg = ahora / 1000;

test('acepta solo tokens firmados con la clave secreta de la integración', () => {
  const token = firmar({ account_id: 1, exp: seg + 300 });
  assert.equal(verificarToken(token, SECRETO, ahora).account_id, 1);
  assert.throws(() => verificarToken(firmar({ exp: seg + 300 }, { secreto: 'otra' }), SECRETO, ahora), /firma inválida/);
  const [c, , f] = token.split('.');
  assert.throws(() => verificarToken(`${c}.${b64({ account_id: 2, exp: seg + 300 })}.${f}`, SECRETO, ahora), /firma inválida/);
  assert.throws(() => verificarToken(firmar({ exp: seg - 3600 }), SECRETO, ahora), /vencido/);
  assert.throws(() => verificarToken(firmar({}, { alg: 'none' }), SECRETO, ahora), /algoritmo/);
  assert.throws(() => verificarToken('', SECRETO, ahora), /mal formado/);
});

test('solo responde a la cuenta propia de Kommo', () => {
  assert.ok(direccionDeRetornoValida('https://autoonlinesdclientes.kommo.com/api/v4/salesbot/123/continue/456'));
  assert.ok(direccionDeRetornoValida('https://autoonlinesdclientes.kommo.com/api/v4/marketingbot/1/continue/2'));
  for (const mala of [
    'http://autoonlinesdclientes.kommo.com/api/v4/salesbot/1/continue/2',
    'https://otracuenta.kommo.com/api/v4/salesbot/1/continue/2',
    'https://autoonlinesdclientes.kommo.com.evil.com/api/v4/salesbot/1/continue/2',
    'https://autoonlinesdclientes.kommo.com:8443/api/v4/salesbot/1/continue/2',
    'https://autoonlinesdclientes.kommo.com/api/v4/leads',
    'no es una url',
    undefined,
  ]) {
    assert.equal(direccionDeRetornoValida(mala), false, mala);
  }
});

test('lee el cuerpo en JSON o como formulario', () => {
  assert.deepEqual(leerCuerpo('{"token":"t","data":{"lead":"9"}}', 'application/json'), { token: 't', data: { lead: '9' } });
  assert.deepEqual(
    leerCuerpo('token=t&data%5Blead%5D=9&data%5Bmensaje%5D=hola+que+tal&return_url=u', 'application/x-www-form-urlencoded'),
    { token: 't', data: { lead: '9', mensaje: 'hola que tal' }, return_url: 'u' }
  );
});
