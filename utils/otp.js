// otp.js - OTP generation and validation utilities

/**
 * Generate random OTP code
 * @param {number} length - Length of OTP (4 or 6)
 * @returns {string} OTP code
 */
function generateOTP(length = 4) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

/**
 * Validate OTP format
 * @param {string} otp 
 * @param {number} expectedLength 
 * @returns {boolean}
 */
function validateOTPFormat(otp, expectedLength = 4) {
  if (!otp || typeof otp !== 'string') return false;
  const regex = new RegExp(`^\\d{${expectedLength}}$`);
  return regex.test(otp);
}

/**
 * Check if OTP has expired
 * @param {Date|string} generatedAt 
 * @param {number} expiryMinutes 
 * @returns {boolean}
 */
function isOTPExpired(generatedAt, expiryMinutes = 30) {
  if (!generatedAt) return true;
  const now = new Date();
  const generated = new Date(generatedAt);
  const expiry = new Date(generated.getTime() + expiryMinutes * 60000);
  return now > expiry;
}

/**
 * Check if max attempts exceeded
 * @param {number} attempts 
 * @param {number} maxAttempts 
 * @returns {boolean}
 */
function isMaxAttemptsExceeded(attempts, maxAttempts = 5) {
  return attempts >= maxAttempts;
}

/**
 * Calculate expiry timestamp
 * @param {number} minutes 
 * @returns {Date}
 */
function getExpiryTimestamp(minutes = 30) {
  return new Date(Date.now() + minutes * 60000);
}

module.exports = {
  generateOTP,
  validateOTPFormat,
  isOTPExpired,
  isMaxAttemptsExceeded,
  getExpiryTimestamp
};
