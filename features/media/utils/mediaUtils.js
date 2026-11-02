// features/media/utils/mediaUtils.js
const config = require('../config/mediaConfig');

const TYPE_META = {
    image:   { label: 'Image',   plural: 'Images',   emoji: '🖼️' },
    gif:     { label: 'GIF',     plural: 'GIFs',     emoji: '🎞️' },
    sticker: { label: 'Sticker', plural: 'Stickers', emoji: '🏷️' }
};
const TYPES   = Object.keys(TYPE_META);
const FILTERS = ['all', ...TYPES];

// Names are used in `!sticker_<name>`, so keep them command-safe.
function normalizeName(raw) {
    const name = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/^!+/, '');

    if (!name) return { ok: false, error: 'Please give the item a name.' };
    if (name.length > config.NAME_MAX_LENGTH) {
        return { ok: false, error: `Names can be at most ${config.NAME_MAX_LENGTH} characters.` };
    }
    if (!/^[a-z0-9_-]+$/.test(name)) {
        return { ok: false, error: 'Names can only contain letters, numbers, `_` and `-`.' };
    }
    return { ok: true, name };
}

function nameFromFilename(filename) {
    return String(filename || '').replace(/\.[^.]+$/, '');
}

// Detect the real file type from magic bytes — never trust the client-supplied
// content type or extension.
function sniffImage(buf) {
    if (!buf || buf.length < 12) return null;

    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
        // acTL chunk (directly after IHDR) marks an animated PNG
        const apng = buf.subarray(0, Math.min(buf.length, 256)).includes(Buffer.from('acTL'));
        return { mime: 'image/png', ext: 'png', apng };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return { mime: 'image/jpeg', ext: 'jpg', apng: false };
    }
    const head6 = buf.subarray(0, 6).toString('latin1');
    if (head6 === 'GIF87a' || head6 === 'GIF89a') {
        return { mime: 'image/gif', ext: 'gif', apng: false };
    }
    if (buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buf.subarray(8, 12).toString('latin1') === 'WEBP') {
        return { mime: 'image/webp', ext: 'webp', apng: false };
    }
    return null;
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = { TYPE_META, TYPES, FILTERS, normalizeName, nameFromFilename, sniffImage, formatBytes };
