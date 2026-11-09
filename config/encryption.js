const crypto = require('crypto');

// Configuration Encryption Setup (AES-256-GCM / Base64URL)
let SECRET_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (SECRET_ENCRYPTION_KEY) {
    SECRET_ENCRYPTION_KEY = crypto.createHash('sha256').update(String(SECRET_ENCRYPTION_KEY)).digest();
} else {
    SECRET_ENCRYPTION_KEY = crypto.createHash('sha256').update('nuvio-default-volatile-fallback-key-2026').digest();
}

function encryptConfigPayload(configObj) {
    try {
        const text = JSON.stringify(configObj);
        return Buffer.from(text, 'utf8').toString('base64url');
    } catch (e) {
        console.error('[Encoding Error]', e);
        return null;
    }
}

function decryptConfigPayload(token) {
    if (!token) return null;
    try {
        // Support legacy enc_ prefix temporarily if users still have old AES tokens
        if (token.startsWith('enc_')) {
            let parts;
            if (token.includes('.')) {
                const withoutPrefix = token.substring(4);
                parts = withoutPrefix.split('.');
                if (parts.length !== 3) return null;
                parts = ['enc', parts[0], parts[1], parts[2]];
            } else {
                parts = token.split('_');
            }
            if (parts.length !== 4) return null;
            const iv = Buffer.from(parts[1], 'base64url');
            const encrypted = parts[2];
            const authTag = Buffer.from(parts[3], 'base64url');
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_ENCRYPTION_KEY, iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encrypted, 'base64url', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        }
        
        // Standard Base64url token
        const decrypted = Buffer.from(token, 'base64url').toString('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

module.exports = {
    SECRET_ENCRYPTION_KEY,
    encryptConfigPayload,
    decryptConfigPayload
};
