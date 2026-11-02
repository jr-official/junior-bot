// features/media/utils/errors.js

// An error whose message is safe to show to the user.
class MediaError extends Error {
    constructor(userMessage, code = 'INVALID') {
        super(userMessage);
        this.name = 'MediaError';
        this.userMessage = userMessage;
        this.code = code;
    }
}

class AccessDeniedError extends Error {
    constructor() {
        super('Media library access denied');
        this.name = 'AccessDeniedError';
        this.code = 'DENIED';
    }
}

module.exports = { MediaError, AccessDeniedError };
