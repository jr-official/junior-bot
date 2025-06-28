// utils/cleanup.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const dompurify = DOMPurify(window);

function cleanUsername(username, userId) {
    // Just clean the username without adding user ID
    return username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15) || 'user';
}

function safeHtml(unsafe) {
    return dompurify.sanitize(unsafe);
}

module.exports = {
    cleanUsername,
    safeHtml
};