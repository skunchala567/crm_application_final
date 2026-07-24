// =====================================================
// Cryptographic Utilities
// Token encryption/decryption for secure storage
// =====================================================

import crypto from 'crypto';

/**
 * Encryption configuration
 * Uses AES-256-GCM for authenticated encryption
 */
const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 16;
const SALT_BYTE_LENGTH = 64;
const DERIVED_KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Derive encryption key from master key using PBKDF2
 * @param {string} masterKey - Master encryption key (from environment)
 * @param {Buffer} salt - Salt for derivation
 * @returns {Buffer} Derived key
 */
function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, ITERATIONS, DERIVED_KEY_LENGTH, 'sha256');
}

/**
 * Encrypt sensitive data (API keys, tokens, etc.)
 * @param {string} plaintext - Data to encrypt
 * @param {string} masterKey - Master encryption key from environment
 * @returns {string} Encrypted data in format: salt:iv:authTag:ciphertext
 */
export function encryptToken(plaintext, masterKey) {
  if (!plaintext || !masterKey) {
    throw new Error('Plaintext and master key are required');
  }

  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_BYTE_LENGTH);
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);

  // Derive key from master key
  const key = deriveKey(masterKey, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Return concatenated: salt:iv:authTag:ciphertext (all hex encoded)
  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypt sensitive data
 * @param {string} encrypted - Encrypted data in format: salt:iv:authTag:ciphertext
 * @param {string} masterKey - Master encryption key from environment
 * @returns {string} Decrypted plaintext
 */
export function decryptToken(encrypted, masterKey) {
  if (!encrypted || !masterKey) {
    throw new Error('Encrypted data and master key are required');
  }

  try {
    // Split encrypted data
    const parts = encrypted.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const salt = Buffer.from(parts[0], 'hex');
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const ciphertext = parts[3];

    // Validate lengths
    if (salt.length !== SALT_BYTE_LENGTH || iv.length !== IV_BYTE_LENGTH || authTag.length !== AUTH_TAG_BYTE_LENGTH) {
      throw new Error('Invalid encrypted data - invalid component lengths');
    }

    // Derive same key
    const key = deriveKey(masterKey, salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    throw new Error(`Token decryption failed: ${error.message}`);
  }
}

/**
 * Generate a cryptographically secure random state token for OAuth
 * Used to prevent CSRF attacks
 * @returns {string} Random state token (43 characters)
 */
export function generateOAuthState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a random PKCE code verifier for OAuth 2.0 with PKCE
 * @returns {string} Code verifier (128 characters)
 */
export function generatePKCEVerifier() {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Generate PKCE code challenge from verifier
 * @param {string} verifier - PKCE code verifier
 * @returns {string} Code challenge (base64url encoded)
 */
export function generatePKCEChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate HMAC signature for webhook verification
 * @param {object} payload - Webhook payload
 * @param {string} secret - Webhook secret
 * @param {string} algorithm - HMAC algorithm (default: sha256)
 * @returns {string} HMAC signature in hex format
 */
export function generateWebhookSignature(payload, secret, algorithm = 'sha256') {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac(algorithm, secret).update(payloadString).digest('hex');
}

/**
 * Verify webhook signature
 * @param {string} signature - Signature to verify
 * @param {object} payload - Webhook payload
 * @param {string} secret - Webhook secret
 * @param {string} algorithm - HMAC algorithm (default: sha256)
 * @returns {boolean} True if signature is valid
 */
export function verifyWebhookSignature(signature, payload, secret, algorithm = 'sha256') {
  const expected = generateWebhookSignature(payload, secret, algorithm);

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

/**
 * Hash a value using SHA-256
 * @param {string} value - Value to hash
 * @returns {string} SHA-256 hash in hex format
 */
export function hashSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Verify encryption is working (test function)
 * @param {string} masterKey - Master encryption key
 * @returns {boolean} True if encryption/decryption works
 */
export function testEncryption(masterKey) {
  try {
    const testData = 'test_token_12345';
    const encrypted = encryptToken(testData, masterKey);
    const decrypted = decryptToken(encrypted, masterKey);
    return decrypted === testData;
  } catch (error) {
    return false;
  }
}

/**
 * Get encryption key from environment
 * @returns {string} Encryption key from INTEGRATION_MASTER_KEY env var
 * @throws {Error} If master key not configured
 */
export function getMasterKey() {
  const masterKey = process.env.INTEGRATION_MASTER_KEY;
  if (!masterKey || masterKey.length < 32) {
    throw new Error(
      'INTEGRATION_MASTER_KEY environment variable not set or too short (minimum 32 characters). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return masterKey;
}

/**
 * Ensure master key is configured and working
 * @throws {Error} If encryption is not properly configured
 */
export function validateEncryptionSetup() {
  try {
    const masterKey = getMasterKey();
    if (!testEncryption(masterKey)) {
      throw new Error('Encryption test failed');
    }
  } catch (error) {
    console.error('Encryption setup validation failed:', error.message);
    throw error;
  }
}
