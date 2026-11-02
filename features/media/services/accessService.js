// features/media/services/accessService.js
// Single source of truth for "is this user allowed to use the media library?".
// Called by every entry point (slash, buttons, menus, modals, prefix) AND by the
// data layer, so a forged interaction can never reach the database.
const config = require('../config/mediaConfig');
const { AccessDeniedError } = require('../utils/errors');

function isEnabled() {
    return config.ALLOWED_USER_IDS.size > 0;
}

function isAllowed(userId) {
    return typeof userId === 'string' && config.ALLOWED_USER_IDS.has(userId);
}

function assertAllowed(userId) {
    if (!isAllowed(userId)) throw new AccessDeniedError();
}

module.exports = { isEnabled, isAllowed, assertAllowed };
