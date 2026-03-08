// features/moderation/utils/caseId.js
// Generates human-readable case IDs like BAN-A3X9KQ, WARN-7ZTMP2, KICK-R5VB8W
// Format: <TYPE_PREFIX>-<6 random uppercase alphanumeric chars>
// 6 base-36 chars uppercased = ~2.18 billion combinations per type.

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
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${random}`;
}

module.exports = { generateCaseId };