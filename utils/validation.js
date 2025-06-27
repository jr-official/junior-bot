// utils/validation.js
function validateConfig(config) {
    const errors = [];
    if (!config.TICKET_CHANNEL_ID) errors.push('TICKET_CHANNEL_ID is required');
    if (!config.TICKET_CATEGORY_ID) errors.push('TICKET_CATEGORY_ID is required');
    if (!config.STAFF_ROLE_NAME) errors.push('STAFF_ROLE_NAME is required');
    if (!config.TICKET_LOGS_CHANNEL_ID) errors.push('TICKET_LOGS_CHANNEL_ID is required');
    return errors;
}

module.exports = {
    validateConfig
};