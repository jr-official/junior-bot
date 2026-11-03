// features/media/config/mediaConfig.js
//
// Private personal media library (images / GIFs / stickers).
//
// Required env var (Railway → Variables):
//   MEDIA_ALLOWED_USER_IDS   Comma- or space-separated Discord user IDs that may
//                            use the feature. If empty/missing the feature is
//                            DISABLED entirely (fails closed).
//
// Optional env vars:
//   MEDIA_MAX_USER_MB        Per-user storage quota in MB          (default 40)
//   MEDIA_MAX_FILE_MB        Max size of a single file in MB       (default 8)
//   MEDIA_MAX_ITEMS          Max items per user                    (default 100)
//   MEDIA_MAX_SHARED_MB      Quota of the shared library in MB     (default 40)
//   MEDIA_MAX_SHARED_ITEMS   Max items in the shared library      (default 100)

const MB = 1024 * 1024;

function parseIds(raw) {
    const ids = new Set();
    const invalid = [];
    for (const part of String(raw || '').split(/[\s,;]+/).filter(Boolean)) {
        if (/^\d{15,25}$/.test(part)) ids.add(part);
        else invalid.push(part);
    }
    return { ids, invalid };
}

function numEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

const { ids, invalid } = parseIds(process.env.MEDIA_ALLOWED_USER_IDS);

module.exports = {
    ALLOWED_USER_IDS: ids,
    INVALID_USER_IDS: invalid,

    PREFIX:         '!',
    PREFIX_ALIASES: ['sticker', 'gif', 'img'],   // !sticker_x, !gif_x, !img_x → your own library
    SHARED_ALIAS:   'shared',                    // !shared_x → the shared library

    MAX_FILE_BYTES:     Math.floor(numEnv('MEDIA_MAX_FILE_MB', 8) * MB),
    MAX_USER_BYTES:     Math.floor(numEnv('MEDIA_MAX_USER_MB', 40) * MB),
    MAX_ITEMS_PER_USER: Math.floor(numEnv('MEDIA_MAX_ITEMS', 100)),

    // The shared library is stored as a pseudo-owner; real user ids are numeric snowflakes
    // so this can never collide with one.
    SHARED_OWNER:       'shared',
    MAX_SHARED_BYTES:   Math.floor(numEnv('MEDIA_MAX_SHARED_MB', 40) * MB),
    MAX_SHARED_ITEMS:   Math.floor(numEnv('MEDIA_MAX_SHARED_ITEMS', 100)),

    NAME_MAX_LENGTH:        32,
    STICKER_MAX_DIMENSION:  320,
    MAX_PIXELS:             100_000_000,   // width * height * frames, decode safety
    PAGE_SIZE:              25,            // Discord select menu max

    DOWNLOAD_TIMEOUT_MS:  20_000,
    PREFIX_COOLDOWN_MS:   1_000,
    NOTICE_DELETE_MS:     5_000,

    COLLECTIONS: { items: 'media_items', files: 'media_files' },
    EMBED_COLOR: 0x5037CF
};
