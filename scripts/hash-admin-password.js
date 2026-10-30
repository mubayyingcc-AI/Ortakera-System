import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: npm run admin:hash -- "a-unique-password-of-at-least-12-characters"');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64);
console.log(salt.toString('hex') + ':' + hash.toString('hex'));
