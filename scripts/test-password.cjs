// Valori sintetici generati soltanto in memoria; mai credenziali reali o log.
const { randomBytes } = require('node:crypto');

function createTestPassword() {
  return String.fromCharCode(71, 57) + randomBytes(12).toString('hex');
}

module.exports = { createTestPassword };
