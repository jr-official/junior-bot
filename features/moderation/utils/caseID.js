// features/moderation/utils/caseId.js
// Generates human-readable case IDs like BAN-A3X9KQ, WARN-7ZTMP2, KICK-R5VB8W
// Format: <TYPE_PREFIX>-<6 random uppercase hex chars>
//
// Uses crypto.randomBytes for better collision resistance vs Math.random().
// 4 random bytes → 8 hex chars, first 6 taken → 16^6 = ~16.7 million combinations
// per type. Uniform distribution with no PRNG bias.
//
// NOTE: the suffix is hexadecimal (0-9, A-F), not base-36. The comment in the
// original file incorrectly described it as base-36.

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