// features/media/services/imageProcessor.js
// Validates that an upload is a real, decodable image and, for stickers,
// shrinks it to fit a Discord-sticker-sized box (320x320), keeping animation.
const sharp = require('sharp');
const config = require('../config/mediaConfig');
const { MediaError } = require('../utils/errors');

const BAD_IMAGE = 'That file looks corrupted or is not a valid image.';

async function process(buffer, info, type) {
    let meta;
    try {
        meta = await sharp(buffer, { animated: true, limitInputPixels: 50_000_000 }).metadata();
    } catch {
        throw new MediaError(BAD_IMAGE);
    }

    const width  = meta.width;
    const height = meta.pageHeight || meta.height;
    const frames = meta.pages || 1;
    if (!width || !height) throw new MediaError(BAD_IMAGE);
    if (width * height * frames > config.MAX_PIXELS) {
        throw new MediaError('That image is too large to process. Try a smaller one.');
    }

    const result = { buffer, mime: info.mime, ext: info.ext, width, height, animated: frames > 1 || info.apng };

    const needsResize = type === 'sticker' &&
        (width > config.STICKER_MAX_DIMENSION || height > config.STICKER_MAX_DIMENSION);

    // sharp cannot re-encode animated PNG without flattening it, so APNGs are kept as-is.
    if (!needsResize || info.apng) return result;

    try {
        let pipeline = sharp(buffer, { animated: true, limitInputPixels: 50_000_000 })
            .resize({
                width: config.STICKER_MAX_DIMENSION,
                height: config.STICKER_MAX_DIMENSION,
                fit: 'inside',
                withoutEnlargement: true
            });

        if (info.mime === 'image/gif')       pipeline = pipeline.gif();
        else if (info.mime === 'image/webp') pipeline = pipeline.webp({ quality: 90 });
        else if (info.mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 90 });
        else                                 pipeline = pipeline.png();

        const out = await pipeline.toBuffer({ resolveWithObject: true });
        if (out.data.length > config.MAX_FILE_BYTES) {
            throw new MediaError('That sticker is still too large after resizing.');
        }
        return {
            ...result,
            buffer: out.data,
            width: out.info.width,
            height: out.info.pageHeight || out.info.height
        };
    } catch (err) {
        if (err instanceof MediaError) throw err;
        console.error('[imageProcessor] resize failed:', err.message);
        throw new MediaError('I could not resize that image into a sticker.');
    }
}

module.exports = { process };
