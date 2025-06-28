// utils/htmlUtils.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

class HtmlUtils {
    constructor() {
        this.window = new JSDOM('').window;
        this.dompurify = DOMPurify(this.window);
    }

    sanitize(unsafe) {
        if (typeof unsafe !== 'string') {
            return '';
        }
        return this.dompurify.sanitize(unsafe);
    }

    formatMessage(message) {
        return this.sanitize(message).replace(/\n/g, '<br>');
    }
}

// Export singleton instance
module.exports = new HtmlUtils();