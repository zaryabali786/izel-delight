const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits for GCM

// Derive 32-byte key from JWT_SECRET or dedicated ENCRYPTION_KEY
function getMasterKey() {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'sellsphere_nexus_master_crypto_key_2026';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypt sensitive credentials (tokens, secrets, passwords)
 */
function encrypt(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: iv:tag:encrypted (in base64)
    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  } catch (err) {
    console.error('[Crypto] Encryption error:', err.message);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt sensitive credentials
 */
function decrypt(ciphertext) {
  if (!ciphertext) return '';
  // Check if text is actually in encrypted format
  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) {
    // If not encrypted (legacy plain string), return as is
    return ciphertext;
  }

  try {
    const [ivB64, tagB64, encB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encB64, 'base64');
    const key = getMasterKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[Crypto] Decryption error:', err.message);
    return ciphertext; // Fallback to raw if decryption fails
  }
}

/**
 * Mask secret string for safe display in UI/logs (e.g. "••••••••abcd")
 */
function maskSecret(secret, visibleChars = 4) {
  if (!secret) return '';
  const str = String(secret);
  if (str.length <= visibleChars) return '••••••••';
  const visible = str.slice(-visibleChars);
  return `••••••••${visible}`;
}

/**
 * Verify HMAC SHA-256 signature (used for Shopify, Meta & Courier webhooks)
 */
function verifyHmacSha256(data, secret, expectedHmac) {
  if (!data || !secret || !expectedHmac) return false;
  try {
    const generated = crypto.createHmac('sha256', secret).update(data).digest('base64');
    return crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(expectedHmac));
  } catch (_) {
    return false;
  }
}

module.exports = {
  encrypt,
  decrypt,
  maskSecret,
  verifyHmacSha256,
};
