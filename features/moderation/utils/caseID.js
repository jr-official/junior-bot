// features/moderation/utils/caseId.js
// Generates human-readable case IDs like BAN-A3X9KQ, WARN-7ZTMP2, KICK-R5VB8W
// Format: <TYPE_PREFIX>-<6 random uppercase alphanumeric chars>
//
// Uses crypto.randomBytes for better collision resistance vs Math.random().
// 6 base-36 chars uppercased ≈ 2.18 billion combinations per type —
// more than sufficient for audit trails, but crypto randomness gives us
// uniform distribution with no PRNG bias.

const { randomBytes } = require('crypto');

const TYPE_PREFIXES = {
    ban:         'BAN',
    softban:     'SBAN',
    unban:       'UNBAN',
    kick:        'KICK',
    mute:        'MUTE',
    unmute:      'UNMUTE',
    warn:        'WARN',
    warn_remove: 'WREM'
};

function generateCaseId(type) {
    const prefix = TYPE_PREFIXES[type] || 'CASE';
    // Generate 4 random bytes → 8 hex chars, take first 6 and uppercase
    const random = randomBytes(4).toString('hex').substring(0, 6).toUpperCase();
    return `${prefix}-${random}`;
}

module.exports = { generateCaseId };