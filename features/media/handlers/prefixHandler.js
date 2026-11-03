// features/media/handlers/prefixHandler.js
// !sticker_<name>  (also !gif_<name>, !img_<name>) → sends the author's own item.
// !shared_<name> → sends an item from the shared library (any allowed user).
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config/mediaConfig');
const mediaService = require('../services/mediaService');
const { isAllowed } = require('../services/accessService');
const { MediaError } = require('../utils/errors');
const interactionHandler = require('./interactionHandler');

// Set MEDIA_DEBUG=1 in Railway to log why a prefix command was (not) handled.
const DEBUG = process.env.MEDIA_DEBUG === '1';
const dbg = (...a) => { if (DEBUG) console.log('[media:debug]', ...a); };

const PATTERN = new RegExp(
    `^${config.PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(${[...config.PREFIX_ALIASES, config.SHARED_ALIAS].join('|')})_([a-z0-9_-]{1,${config.NAME_MAX_LENGTH}})(?:\\s|$)`,
    'i'
);

// `!shared` on its own (not `!shared_<name>`) posts the public shared-library menu.
const MENU_PATTERN = new RegExp(`^${config.PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${config.SHARED_ALIAS}(?:\\s|$)`, 'i');

const lastUse = new Map();   // userId → timestamp (simple anti-flood)

function canDelete(message) {
    if (!message.guild) return false;                    // Discord never lets bots delete user messages in DMs
    const me = message.guild.members.me;
    const perms = me && message.channel.permissionsFor?.(me);
    return !!perms?.has(PermissionFlagsBits.ManageMessages);
}

async function tempNotice(message, text) {
    try {
        const reply = await message.channel.send({ content: text, allowedMentions: { parse: [] } });
        setTimeout(() => reply.delete().catch(() => {}), config.NOTICE_DELETE_MS);
    } catch { /* can't post here — nothing more to do */ }
}

async function handle(message) {
    if (message.author.bot) return;
    if (!message.content || !message.content.startsWith(config.PREFIX)) return;

    const isMenu = MENU_PATTERN.test(message.content);
    const match = isMenu ? null : message.content.match(PATTERN);
    if (!isMenu && !match) return;

    const where = message.guild ? `guild ${message.guild.id}` : 'DM';
    dbg(`received "${message.content.slice(0, 40)}" from ${message.author.id} in ${where}`);

    // Unauthorized users are ignored completely (no reply, no delete) so the
    // feature stays invisible to them.
    const userId = message.author.id;
    if (!isAllowed(userId)) { dbg(`ignored: ${userId} is not in MEDIA_ALLOWED_USER_IDS`); return; }

    const now = Date.now();
    if (now - (lastUse.get(userId) || 0) < config.PREFIX_COOLDOWN_MS) { dbg('ignored: cooldown'); return; }
    lastUse.set(userId, now);

    if (isMenu) {
        try {
            const menu = await interactionHandler.buildPublicSharedMenu(userId);
            const deletion = canDelete(message) ? message.delete().catch(() => {}) : Promise.resolve();
            await Promise.all([deletion, message.channel.send(menu)]);
            dbg('posted public shared menu');
        } catch (err) {
            console.error('❌ [media] Shared menu error:', err);
            message.react?.('❌').catch(() => {});
        }
        return;
    }

    const name = match[2].toLowerCase();
    const scope = match[1].toLowerCase() === config.SHARED_ALIAS ? 'shared' : 'personal';

    try {
        const item = await mediaService.findByName(userId, name, scope);
        if (!item) {
            if (canDelete(message)) message.delete().catch(() => {});
            return await tempNotice(message, `❌ No item named \`${name}\` in ${scope === 'shared' ? 'the shared library' : 'your library'}.`);
        }

        const buffer = await mediaService.getFileBuffer(userId, item);
        const payload = {
            files: [new AttachmentBuilder(buffer, { name: `${item.name}.${item.ext}` })],
            allowedMentions: { parse: [], repliedUser: false }
        };
        // Keep threading if the command was itself a reply to someone.
        if (message.reference?.messageId) {
            payload.reply = { messageReference: message.reference.messageId, failIfNotExists: false };
        }

        const deletion = canDelete(message) ? message.delete().catch(() => {}) : Promise.resolve();
        await Promise.all([deletion, message.channel.send(payload)]);
        dbg(`sent ${scope}:${item.name}`);
    } catch (err) {
        if (err instanceof MediaError) return tempNotice(message, `❌ ${err.userMessage}`);
        console.error('❌ [media] Prefix command error:', err);
        // Best effort: signal the failure without spamming the channel.
        message.react?.('❌').catch(() => {});
    }
}

module.exports = { handle };
