// utils/cleanup.js
const htmlUtils = require('./htmlUtils');

function cleanUsername(username, userId) {
    // Just clean the username without adding user ID
    return username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15) || 'user';
}

function safeHtml(unsafe) {
    return htmlUtils.sanitize(unsafe);
}

module.exports = {
    cleanUsername,
    safeHtml
};