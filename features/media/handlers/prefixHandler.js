// features/media/handlers/prefixHandler.js
// !sticker_<name>  (also !gif_<name>, !img_<name>) → sends the author's own item.
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config/mediaConfig');
const mediaService = require('../services/mediaService');
const { isAllowed } = require('../services/accessService');
const { MediaError } = require('../utils/errors');

const PATTERN = new RegExp(
    `^${config.PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(${config.PREFIX_ALIASES.join('|')})_([a-z0-9_-]{1,${config.NAME_MAX_LENGTH}})(?:\\s|$)`,
    'i'
);

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

    const match = message.content.match(PATTERN);
    if (!match) return;

    // Unauthorized users are ignored completely (no reply, no delete) so the
    // feature stays invisible to them.
    const userId = message.author.id;
    if (!isAllowed(userId)) return;

    const now = Date.now();
    if (now - (lastUse.get(userId) || 0) < config.PREFIX_COOLDOWN_MS) return;
    lastUse.set(userId, now);

    const name = match[2].toLowerCase();

    try {
        const item = await mediaService.findByName(userId, name);
        if (!item) {
            if (canDelete(message)) message.delete().catch(() => {});
            return await tempNotice(message, `❌ No item named \`${name}\` in your library.`);
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
    } catch (err) {
        if (err instanceof MediaError) return tempNotice(message, `❌ ${err.userMessage}`);
        console.error('❌ [media] Prefix command error:', err);
        // Best effort: signal the failure without spamming the channel.
        message.react?.('❌').catch(() => {});
    }
}

module.exports = { handle };
