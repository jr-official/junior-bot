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
const { FILTERS } = require('../utils/mediaUtils');
const { listView, itemView, confirmDeleteView, cid } = require('../ui/libraryView');

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

async function showList(interaction, userId, filter, page) {
    const [res, usage] = await Promise.all([
        mediaService.list(userId, { type: filter, page }),
        mediaService.getUsage(userId)
    ]);
    await interaction.editReply(listView({ ...res, filter, usage }));
}

async function showItem(interaction, userId, itemId, filter, page, content = '') {
    const item = await mediaService.getItem(userId, itemId);
    const buffer = await mediaService.getFileBuffer(userId, item);
    await interaction.editReply(itemView(item, buffer, { filter, page, content }));
}

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

// Posts the bare file into the channel (no "X used /media" header, no text).
// Falls back to a public follow-up if the bot can't post there itself.
async function sendToChannel(interaction, userId, itemId) {
    const item   = await mediaService.getItem(userId, itemId);
    const buffer = await mediaService.getFileBuffer(userId, item);
    const payload = { files: [new AttachmentBuilder(buffer, { name: `${item.name}.${item.ext}` })] };

    let channel = interaction.channel;
    if (!channel && interaction.channelId) {
        channel = await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
    }

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
            const item = await uploadService.addFromAttachment(userId, {
                attachment,
                name: interaction.options.getString('name'),
                type: interaction.options.getString('type')
            });
            return await showItem(interaction, userId, item._id, 'all', 0,
                `✅ Saved as **${item.name}**. Send it anywhere with \`!sticker_${item.name}\`.`);
        }
        await showList(interaction, userId, 'all', 0);
    } catch (err) {
        await handleError(interaction, err, { editInstead: true });
    }
}

// ── buttons / select menus ───────────────────────────────────────────────────
async function handleComponent(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) return notify(interaction, DENIED_TEXT);

    const [, action, ...args] = interaction.customId.split(':');

    try {
        switch (action) {
            case 'filter':
                await interaction.deferUpdate();
                return await showList(interaction, userId, parseFilter(args[0]), 0);

            case 'page':
                await interaction.deferUpdate();
                return await showList(interaction, userId, parseFilter(args[0]), parsePage(args[1]));

            case 'back':
            case 'delno': {
                await interaction.deferUpdate();
                if (action === 'delno') {
                    return await showItem(interaction, userId, args[0], parseFilter(args[1]), parsePage(args[2]));
                }
                return await showList(interaction, userId, parseFilter(args[0]), parsePage(args[1]));
            }

            case 'pick':
                await interaction.deferUpdate();
                return await showItem(interaction, userId, interaction.values?.[0],
                    parseFilter(args[0]), parsePage(args[1]));

            case 'send':
                await interaction.deferUpdate();           // keeps the preview as-is
                return await sendToChannel(interaction, userId, args[0]);

            case 'rename': {
                const item = await mediaService.getItem(userId, args[0]);
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
                const item = await mediaService.getItem(userId, args[0]);
                return await interaction.editReply(
                    confirmDeleteView(item, { filter: parseFilter(args[1]), page: parsePage(args[2]) }));
            }

            case 'delyes': {
                await interaction.deferUpdate();
                const item = await mediaService.remove(userId, args[0]);
                await showList(interaction, userId, parseFilter(args[1]), parsePage(args[2]));
                return await interaction.followUp({ content: `🗑️ Deleted **${item.name}**.`, flags: EPHEMERAL });
            }

            case 'add':
                return await interaction.reply({
                    flags: EPHEMERAL,
                    content:
                        '**Add to your library**\n' +
                        'Run `/media` and fill in the options:\n' +
                        '• `file` – upload a PNG, JPG, GIF or WebP\n' +
                        '• `name` – e.g. `slay` (then use it as `!sticker_slay`)\n' +
                        '• `type` – optional: image, gif, or sticker (stickers are resized to 320×320)\n' +
                        `Max ${Math.round(config.MAX_FILE_BYTES / 1048576)} MB per file.`
                });

            default:
                return;
        }
    } catch (err) {
        await handleError(interaction, err, { refreshList: true, userId });
    }
}

// ── modal submit (rename) ────────────────────────────────────────────────────
async function handleModal(interaction) {
    const userId = interaction.user.id;
    if (!isAllowed(userId)) return notify(interaction, DENIED_TEXT);

    const [, action, itemId, filterRaw, pageRaw] = interaction.customId.split(':');
    if (action !== 'rnm') return;

    try {
        const filter = parseFilter(filterRaw);
        const page = parsePage(pageRaw);
        if (interaction.isFromMessage()) await interaction.deferUpdate();
        else await interaction.deferReply({ flags: EPHEMERAL });

        const item = await mediaService.rename(userId, itemId, interaction.fields.getTextInputValue('name'));
        if (interaction.isFromMessage()) {
            await showItem(interaction, userId, itemId, filter, page,
                `✅ Renamed to **${item.name}**. Send it with \`!sticker_${item.name}\`.`);
        } else {
            await interaction.editReply({ content: `✅ Renamed to **${item.name}**.` });
        }
    } catch (err) {
        await handleError(interaction, err, {});
    }
}

// ── errors ───────────────────────────────────────────────────────────────────
async function handleError(interaction, err, { editInstead = false, refreshList = false, userId } = {}) {
    if (err instanceof AccessDeniedError) return notify(interaction, DENIED_TEXT);

    if (err instanceof MediaError) {
        if (editInstead && interaction.deferred && !interaction.replied) {
            return interaction.editReply({
                content: `❌ ${err.userMessage}`, embeds: [], components: [], files: [], attachments: []
            }).catch(() => {});
        }
        await notify(interaction, `❌ ${err.userMessage}`);
        if (refreshList && err.code === 'NOT_FOUND' && userId && interaction.deferred) {
            await showList(interaction, userId, 'all', 0).catch(() => {});
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

module.exports = { handleSlash, handleComponent, handleModal };
