// features/media/handlers/interactionHandler.js
// Handles /media plus every `media:*` button, select menu and modal.
const {
    MessageFlags, PermissionFlagsBits, AttachmentBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder
} = require('discord.js');
const config = require('../config/mediaConfig');
const mediaService = require('../services/mediaService');
const uploadService = require('../services/uploadService');
const { isAllowed } = require('../services/accessService');
const { MediaError, AccessDeniedError } = require('../utils/errors');
const { FILTERS, TYPE_META } = require('../utils/mediaUtils');
const { InteractionContextType } = require('discord.js');
const { listView, itemView, confirmDeleteView, cid, scopeFromCode } = require('../ui/libraryView');

const EPHEMERAL = MessageFlags.Ephemeral;
const DENIED_TEXT = '❌ This feature isn\'t available to you.';

// ── small helpers ────────────────────────────────────────────────────────────
const parseFilter = f => (FILTERS.includes(f) ? f : 'all');
const parsePage   = p => Math.max(0, parseInt(p, 10) || 0);

async function notify(interaction, content) {
    const payload = { content, flags: EPHEMERAL };
    try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
    } catch (err) {
        if (err.code !== 10062) console.error('[media] notify failed:', err.message);
    }
}

async function showList(interaction, userId, filter, page, scope = 'personal') {
    const [res, usage] = await Promise.all([
        mediaService.list(userId, { type: filter, page, scope }),
        mediaService.getUsage(userId, scope)
    ]);
    await interaction.editReply(listView({ ...res, filter, usage, scope }));
}

async function showItem(interaction, userId, itemId, filter, page, scope = 'personal', content = '') {
    const item = await mediaService.getItem(userId, itemId, scope);
    const buffer = await mediaService.getFileBuffer(userId, item);
    await interaction.editReply(itemView(item, buffer, { filter, page, content, viewerId: userId }));
}

const sendHint = item => (item.ownerId === config.SHARED_OWNER ? `!shared_${item.name}` : `!sticker_${item.name}`);

function canPost(channel) {
    if (!channel) return false;
    if (typeof channel.isDMBased === 'function' && channel.isDMBased()) return true;
    const me = channel.guild?.members?.me;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    if (!perms) return false;
    const send = channel.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    return perms.has([PermissionFlagsBits.ViewChannel, send, PermissionFlagsBits.AttachFiles]);
}

async function resolveChannel(interaction) {
    let channel = interaction.channel;
    if (!channel && interaction.channelId) {
        channel = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
    }
    return channel;
}

// Posts the bare file into the channel (no "X used /media" header, no text).
// Falls back to a public follow-up if the bot can't post there itself.
async function sendToChannel(interaction, userId, itemId, scope) {
    const item   = await mediaService.getItem(userId, itemId, scope);
    const buffer = await mediaService.getFileBuffer(userId, item);
    const payload = { files: [new AttachmentBuilder(buffer, { name: `${item.name}.${item.ext}` })] };

    // In DMs/group DMs between users (user-installed app) the bot is not a member
    // of the channel and cannot post itself — reply publicly via the interaction.
    if (interaction.context === InteractionContextType.PrivateChannel) {
        await interaction.followUp(payload);
        return;
    }

    const channel = await resolveChannel(interaction);

    if (canPost(channel)) {
        try {
            await channel.send(payload);
            return;
        } catch (err) {
            console.warn('[media] channel.send failed, using follow-up:', err.message);
        }
    }
    await interaction.followUp(payload);   // public (not ephemeral) fallback
}

// ── /media ───────────────────────────────────────────────────────────────────
async function handleSlash(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) {
        return interaction.reply({ content: DENIED_TEXT, flags: EPHEMERAL });
    }

    await interaction.deferReply({ flags: EPHEMERAL });

    try {
        const attachment = interaction.options.getAttachment('file');
        if (attachment) {
            const scope = interaction.options.getBoolean('shared') ? 'shared' : 'personal';
            const item = await uploadService.addFromAttachment(userId, {
                attachment,
                name: interaction.options.getString('name'),
                type: interaction.options.getString('type'),
                scope,
                addedByName: interaction.user.username
            });
            return await showItem(interaction, userId, item._id, 'all', 0, scope,
                `✅ Saved ${scope === 'shared' ? 'to the **shared library** ' : ''}as **${item.name}**. Send it anywhere with \`${sendHint(item)}\`.`);
        }
        const scope = interaction.options.getBoolean('shared') ? 'shared' : 'personal';
        await showList(interaction, userId, 'all', 0, scope);
    } catch (err) {
        await handleError(interaction, err, { editInstead: true });
    }
}

// ── /sticker <name> (slash equivalent of !sticker_<name>; works in friend DMs) ──
async function handleSticker(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) {
        return interaction.reply({ content: DENIED_TEXT, flags: EPHEMERAL });
    }

    try {
        const name = interaction.options.getString('name', true);
        const scope = interaction.options.getString('library') === 'shared' ? 'shared' : 'personal';
        const item = await mediaService.findByName(userId, name, scope);
        if (!item) {
            return await interaction.reply({
                content: `❌ No item named \`${name}\` in ${scope === 'shared' ? 'the shared library' : 'your library'}.`,
                flags: EPHEMERAL
            });
        }

        const channel = await resolveChannel(interaction);
        const direct = interaction.context !== InteractionContextType.PrivateChannel && canPost(channel);

        if (direct) {
            // Bot can post itself: send the bare file, then remove the "thinking…" reply.
            await interaction.deferReply({ flags: EPHEMERAL });
            const buffer = await mediaService.getFileBuffer(userId, item);
            try {
                await channel.send({ files: [new AttachmentBuilder(buffer, { name: `${item.name}.${item.ext}` })] });
                await interaction.deleteReply().catch(() => {});
            } catch (err) {
                console.warn('[media] /sticker channel.send failed:', err.message);
                await interaction.editReply({ content: '❌ I can\'t post in this channel.' });
            }
        } else {
            // Friend DMs / servers without the bot: the interaction itself carries the file
            // (Discord shows a small "used /sticker" header — unavoidable there).
            await interaction.deferReply();
            const buffer = await mediaService.getFileBuffer(userId, item);
            await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: `${item.name}.${item.ext}` })] });
        }
    } catch (err) {
        await handleError(interaction, err, { editInstead: interaction.deferred && !interaction.replied });
    }
}

async function handleAutocomplete(interaction) {
    try {
        if (!isAllowed(interaction.user.id)) return await interaction.respond([]);
        const focused = interaction.options.getFocused();
        const scope = interaction.options.getString('library') === 'shared' ? 'shared' : 'personal';
        const rows = await mediaService.searchNames(interaction.user.id, focused, scope);
        await interaction.respond(rows.map(r => ({
            name: `${TYPE_META[r.type].emoji} ${r.name}` + (scope === 'shared' ? ` — ${r.addedByName}` : '')
        .slice(0, 100), value: r.name })));
    } catch (err) {
        if (err.code !== 10062) console.error('[media] autocomplete error:', err.message);
        await interaction.respond([]).catch(() => {});
    }
}

// ── buttons / select menus ───────────────────────────────────────────────────
// customId layouts (last arg is always the scope code, p|s):
//   filter:<filter>:<sc>   page:<filter>:<page>:<sc>   back:<filter>:<page>:<sc>
//   pick:<filter>:<page>:<sc>   scope:<sc>   add:<sc>
//   send|rename|del|delyes|delno:<id>:<filter>:<page>:<sc>
async function handleComponent(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) return notify(interaction, DENIED_TEXT);

    const [, action, ...args] = interaction.customId.split(':');
    const scope = scopeFromCode(args[args.length - 1]);

    try {
        switch (action) {
            case 'scope':
                await interaction.deferUpdate();
                return await showList(interaction, userId, 'all', 0, scope);

            case 'filter':
                await interaction.deferUpdate();
                return await showList(interaction, userId, parseFilter(args[0]), 0, scope);

            case 'page':
                await interaction.deferUpdate();
                return await showList(interaction, userId, parseFilter(args[0]), parsePage(args[1]), scope);

            case 'back':
                await interaction.deferUpdate();
                return await showList(interaction, userId, parseFilter(args[0]), parsePage(args[1]), scope);

            case 'delno':
                await interaction.deferUpdate();
                return await showItem(interaction, userId, args[0], parseFilter(args[1]), parsePage(args[2]), scope);

            case 'pick':
                await interaction.deferUpdate();
                return await showItem(interaction, userId, interaction.values?.[0],
                    parseFilter(args[0]), parsePage(args[1]), scope);

            case 'send':
                await interaction.deferUpdate();           // keeps the preview as-is
                return await sendToChannel(interaction, userId, args[0], scope);

            case 'rename': {
                const item = await mediaService.getItem(userId, args[0], scope);
                if (scope === 'shared' && item.addedById !== userId) {
                    throw new MediaError(`Only ${item.addedByName}, who added this, can change or delete it.`, 'FORBIDDEN');
                }
                const modal = new ModalBuilder()
                    .setCustomId(cid('rnm', ...args))
                    .setTitle('Rename item')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('name')
                            .setLabel('New name (letters, numbers, _ and -)')
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(1)
                            .setMaxLength(config.NAME_MAX_LENGTH)
                            .setValue(item.name)
                            .setRequired(true)
                    ));
                return await interaction.showModal(modal);
            }

            case 'del': {
                await interaction.deferUpdate();
                const item = await mediaService.getItem(userId, args[0], scope);
                if (scope === 'shared' && item.addedById !== userId) {
                    throw new MediaError(`Only ${item.addedByName}, who added this, can change or delete it.`, 'FORBIDDEN');
                }
                return await interaction.editReply(
                    confirmDeleteView(item, { filter: parseFilter(args[1]), page: parsePage(args[2]) }));
            }

            case 'delyes': {
                await interaction.deferUpdate();
                const item = await mediaService.remove(userId, args[0], scope);
                await showList(interaction, userId, parseFilter(args[1]), parsePage(args[2]), scope);
                return await interaction.followUp({ content: `🗑️ Deleted **${item.name}**.`, flags: EPHEMERAL });
            }

            case 'add': {
                const shared = scope === 'shared';
                return await interaction.reply({
                    flags: EPHEMERAL,
                    content:
                        `**Add to ${shared ? 'the shared library' : 'your library'}**\n` +
                        'Run `/media` and fill in the options:\n' +
                        '• `file` – upload a PNG, JPG, GIF or WebP\n' +
                        `• \`name\` – e.g. \`slay\` (then use it as \`${shared ? '!shared_slay' : '!sticker_slay'}\`)\n` +
                        (shared ? '• `shared` – set to **True** to add it to the shared library\n' : '') +
                        '• `type` – optional: image, gif, or sticker (stickers are resized to 320×320)\n' +
                        `Max ${Math.round(config.MAX_FILE_BYTES / 1048576)} MB per file.`
                });
            }

            default:
                return;
        }
    } catch (err) {
        await handleError(interaction, err, { refreshList: true, userId, scope });
    }
}

// ── modal submit (rename) ────────────────────────────────────────────────────
async function handleModal(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) return notify(interaction, DENIED_TEXT);

    const [, action, itemId, filterRaw, pageRaw, scopeRaw] = interaction.customId.split(':');
    if (action !== 'rnm') return;

    try {
        const filter = parseFilter(filterRaw);
        const page = parsePage(pageRaw);
        const scope = scopeFromCode(scopeRaw);
        if (interaction.isFromMessage()) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: EPHEMERAL });

        const item = await mediaService.rename(userId, itemId, interaction.fields.getTextInputValue('name'), scope);
        if (interaction.isFromMessage()) {
            await showItem(interaction, userId, itemId, filter, page, scope,
                `✅ Renamed to **${item.name}**. Send it with \`${sendHint(item)}\`.`);
        } else {
            await interaction.editReply({ content: `✅ Renamed to **${item.name}**.` });
        }
    } catch (err) {
        await handleError(interaction, err, {});
    }
}

// ── errors ───────────────────────────────────────────────────────────────────
async function handleError(interaction, err, { editInstead = false, refreshList = false, userId, scope = 'personal' } = {}) {
    if (err instanceof AccessDeniedError) return notify(interaction, DENIED_TEXT);

    if (err instanceof MediaError) {
        if (editInstead && interaction.deferred && !interaction.replied) {
            return interaction.editReply({
                content: `❌ ${err.userMessage}`, embeds: [], components: [], files: [], attachments: []
            }).catch(() => {});
        }
        await notify(interaction, `❌ ${err.userMessage}`);
        if (refreshList && err.code === 'NOT_FOUND' && userId && interaction.deferred) {
            await showList(interaction, userId, 'all', 0, scope).catch(() => {});
        }
        return;
    }

    console.error('❌ [media] Unexpected error:', err);
    if (editInstead && interaction.deferred && !interaction.replied) {
        return interaction.editReply({
            content: '❌ Something went wrong. Please try again.',
            embeds: [], components: [], files: [], attachments: []
        }).catch(() => {});
    }
    await notify(interaction, '❌ Something went wrong. Please try again.');
}

module.exports = { handleSlash, handleSticker, handleAutocomplete, handleComponent, handleModal };
