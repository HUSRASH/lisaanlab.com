#!/usr/bin/env node
'use strict';
/**
 * Emergency recovery — resets the Super Administrator password from the server console.
 * Usage:  npm run reset-super-password -- "NewPassword123"
 */
const { db } = require('../server/db');
const bcrypt = require('bcryptjs');

const pw = process.argv[2] || 'LisaanLab@2026';
if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
  console.error('Password must be at least 8 characters and contain a letter and a number.');
  process.exit(1);
}
const su = db.prepare("SELECT id, uid, email FROM users WHERE role='SUPER_ADMIN'").get();
if (!su) { console.error('No super administrator account found.'); process.exit(1); }

db.prepare('UPDATE users SET password_hash=?, must_change_password=1, status=? WHERE id=?')
  .run(bcrypt.hashSync(pw, 10), 'ACTIVE', su.id);
db.prepare('DELETE FROM sessions WHERE user_id=?').run(su.id);

console.log('Super administrator password reset.');
console.log('  Email    :', su.email);
console.log('  Staff ID :', su.uid);
console.log('  Password :', pw);
console.log('  A change of password will be required at next sign-in.');
