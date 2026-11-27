// Generates the Ed25519 key pair used to sign Agent licences.
//   node scripts/generate-licence-keys.mjs
// Put LICENCE_SIGNING_PRIVATE_KEY in Vercel (never commit it). Embed the public
// key in the Agent build. Rotating: issue a new pair with a new LICENCE_KEY_ID
// and ship an Agent that trusts both before switching the server over.
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

console.log('# Server env (secret):');
console.log(`LICENCE_SIGNING_PRIVATE_KEY=${Buffer.from(privatePem).toString('base64')}`);
console.log('\n# Agent public key (embed in the Agent build):');
console.log(publicPem);
