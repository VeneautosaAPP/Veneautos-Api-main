import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isValidWhatsAppPhone, normalizeWhatsAppPhone } from './whatsappPhone'

test('normaliza espacios, guiones, paréntesis y puntos', () => {
  assert.equal(normalizeWhatsAppPhone('300 555-1111'), '573005551111')
  assert.equal(normalizeWhatsAppPhone('(300) 555-1111.'), '573005551111')
})

test('respeta prefijo +', () => {
  assert.equal(normalizeWhatsAppPhone('+57 3005551111'), '573005551111')
  assert.equal(normalizeWhatsAppPhone('+573005551111'), '573005551111')
})

test('convierte prefijo 00', () => {
  assert.equal(normalizeWhatsAppPhone('0057 3005551111'), '573005551111')
})

test('no duplica el código de país por defecto', () => {
  assert.equal(normalizeWhatsAppPhone('573005551111'), '573005551111')
  assert.equal(normalizeWhatsAppPhone('57300 555 11 11'), '573005551111')
})

test('antepone el código de país por defecto si falta', () => {
  assert.equal(normalizeWhatsAppPhone('3005551111'), '573005551111')
  assert.equal(normalizeWhatsAppPhone('3005551111', '58'), '583005551111')
})

test('vacío y nulos', () => {
  assert.equal(normalizeWhatsAppPhone(''), '')
  assert.equal(normalizeWhatsAppPhone(null), '')
  assert.equal(normalizeWhatsAppPhone(undefined), '')
  assert.equal(normalizeWhatsAppPhone('   '), '')
})

test('sin código de país por defecto', () => {
  assert.equal(normalizeWhatsAppPhone('3005551111', ''), '3005551111')
})

test('validación de longitud razonable', () => {
  assert.equal(isValidWhatsAppPhone('573005551111'), true)
  assert.equal(isValidWhatsAppPhone('30555111'), true)
  assert.equal(isValidWhatsAppPhone('1234'), false)
  assert.equal(isValidWhatsAppPhone('12345678901234567890'), false)
  assert.equal(isValidWhatsAppPhone('abc'), false)
})

test('quita caracteres no numéricos sueltos', () => {
  assert.equal(normalizeWhatsAppPhone('+57 300 555 11 11'), '573005551111')
})