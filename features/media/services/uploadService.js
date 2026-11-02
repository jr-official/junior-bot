// features/media/services/uploadService.js
// Turns a Discord attachment into a stored library item: download (size-capped,
// Discord CDN only) → verify real file type → process → store.
const config = require('../config/mediaConfig');
const mediaService = require('./mediaService');
const imageProcessor = require('./imageProcessor');
const { assertAllowed } = require('./accessService');
const { MediaError } = require('../utils/errors');
const { normalizeName, nameFromFilename, sniffImage, formatBytes } = require('../utils/mediaUtils');

const CDN_HOST = /(^|\.)(discordapp\.com|discordapp\.net|discord\.com|discordcdn\.com)$/i;

async function download(url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new MediaError('Invalid attachment.'); }
    if (parsed.protocol !== 'https:' || !CDN_HOST.test(parsed.hostname)) {
        throw new MediaError('Only files uploaded to Discord are supported.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.DOWNLOAD_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new MediaError('I could not download that file from Discord.');

        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > config.MAX_FILE_BYTES) {
            throw new MediaError(`File is too large (max ${formatBytes(config.MAX_FILE_BYTES)}).`);
        }

        const chunks = [];
        let total = 0;
        for await (const chunk of res.body) {
            total += chunk.length;
            if (total > config.MAX_FILE_BYTES) {
                controller.abort();
                throw new MediaError(`File is too large (max ${formatBytes(config.MAX_FILE_BYTES)}).`);
            }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch (err) {
        if (err instanceof MediaError) throw err;
        if (err.name === 'AbortError') throw new MediaError('Downloading that file timed out. Try again.');
        console.error('[uploadService] download failed:', err.message);
        throw new MediaError('I could not download that file from Discord.');
    } finally {
        clearTimeout(timer);
    }
}

async function addFromAttachment(ownerId, { attachment, name, type }) {
    assertAllowed(ownerId);

    if (attachment.size > config.MAX_FILE_BYTES) {
        throw new MediaError(`File is too large (max ${formatBytes(config.MAX_FILE_BYTES)}).`);
    }

    // Validate the name before spending time downloading.
    const n = normalizeName(name || nameFromFilename(attachment.name));
    if (!n.ok) throw new MediaError(n.error);

    const raw = await download(attachment.url);
    const info = sniffImage(raw);
    if (!info) throw new MediaError('Unsupported file. Please upload a PNG, JPG, GIF or WebP image.');

    let finalType = type;
    if (!finalType) finalType = info.mime === 'image/gif' ? 'gif' : 'image';
    if (finalType === 'gif' && info.mime !== 'image/gif') {
        throw new MediaError('The GIF type needs a .gif file. Use `image` or `sticker` for other formats.');
    }

    const processed = await imageProcessor.process(raw, info, finalType);

    return mediaService.addItem(ownerId, {
        name: n.name,
        type: finalType,
        buffer: processed.buffer,
        mime: processed.mime,
        ext: processed.ext,
        width: processed.width,
        height: processed.height,
        animated: processed.animated
    });
}

module.exports = { addFromAttachment };
