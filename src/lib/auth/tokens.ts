import crypto from 'node:crypto';

export const createOpaqueToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

export const hashOpaqueToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
