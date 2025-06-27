// utils/cleanup.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const dompurify = DOMPurify(window);

function cleanUsername(username, userId) {
    const base = username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
    const idPart = userId.slice(-6);
    return `${base}-${idPart}`;
}

function safeHtml(unsafe) {
    return dompurify.sanitize(unsafe);
}

module.exports = {
    cleanUsername,
    safeHtml
};