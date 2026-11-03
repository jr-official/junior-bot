// features/media/ui/libraryView.js
// Builds the ephemeral library screens. All state lives in the customIds:
//   media:<action>:<args...>:<scope>      scope code: p = personal, s = shared
// (parsed in handlers/interactionHandler.js)
const {
    EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');
const config = require('../config/mediaConfig');
const { TYPE_META, FILTERS, formatBytes } = require('../utils/mediaUtils');

const cid = (...parts) => ['media', ...parts].join(':');
const FILTER_LABEL = { all: 'All', image: 'Images', gif: 'GIFs', sticker: 'Stickers' };

const scopeCode = scope => (scope === 'shared' ? 's' : 'p');
const scopeFromCode = code => (code === 's' ? 'shared' : 'personal');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function usageLine(usage) {
    return `${usage.count}/${usage.maxCount} items · ${formatBytes(usage.bytes)} of ${formatBytes(usage.maxBytes)} used`;
}

function listView({ items, total, pages, page, filter, usage, scope = 'personal' }) {
    const shared = scope === 'shared';
    const sc = scopeCode(scope);

    const embed = new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setTitle(shared ? '🌐 Shared library' : '📚 Your media library')
        .setFooter({
            text: shared
                ? 'Add: /media shared:true file:<upload> name:<name>  ·  Send in chat: !shared_<name>  ·  /sticker library:shared'
                : 'Add: /media file:<upload> name:<name>  ·  Send in chat: !sticker_<name>'
        });

    const lines = [];
    if (shared) lines.push('Everyone with access can add and use these. Only the person who added an item can rename or delete it.', '');
    lines.push(`**${FILTER_LABEL[filter]}** · ${total} item${total === 1 ? '' : 's'} · page ${page + 1}/${pages}`, usageLine(usage));
    if (items.length) {
        lines.push('', items.map(i => shared
            ? `${TYPE_META[i.type].emoji} \`${i.name}\` — ${i.addedByName}`
            : `${TYPE_META[i.type].emoji} \`${i.name}\``).join(shared ? '\n' : '  '));
        lines.push('', 'Pick an item below to preview it.');
    } else {
        lines.push('', filter === 'all'
            ? 'Nothing here yet. Use **➕ Add** to see how to save your first item.'
            : 'No items of this type yet.');
    }
    embed.setDescription(clip(lines.join('\n'), 4000));

    const components = [];

    if (items.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(cid('pick', filter, page, sc))
                .setPlaceholder('Select an item…')
                .addOptions(items.map(i => ({
                    label: i.name,
                    value: String(i._id),
                    description: clip(
                        `${TYPE_META[i.type].label} · ${formatBytes(i.size)}` + (shared ? ` · added by ${i.addedByName}` : ''), 100),
                    emoji: TYPE_META[i.type].emoji
                })))
        ));
    }

    components.push(new ActionRowBuilder().addComponents(
        FILTERS.map(f => new ButtonBuilder()
            .setCustomId(cid('filter', f, sc))
            .setLabel(FILTER_LABEL[f])
            .setStyle(f === filter ? ButtonStyle.Primary : ButtonStyle.Secondary))
    ));

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('page', filter, page - 1, sc)).setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId(cid('page', filter, page + 1, sc)).setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        new ButtonBuilder().setCustomId(cid('add', sc)).setLabel('➕ Add').setStyle(ButtonStyle.Success)
    ));

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('scope', 'p')).setLabel('👤 My library')
            .setStyle(shared ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(!shared),
        new ButtonBuilder().setCustomId(cid('scope', 's')).setLabel('🌐 Shared library')
            .setStyle(shared ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(shared)
    ));

    // attachments: [] clears any preview file left over from the item screen
    return { content: '', embeds: [embed], components, files: [], attachments: [] };
}

function itemView(item, buffer, { filter, page, content = '', viewerId }) {
    const meta = TYPE_META[item.type];
    const shared = item.ownerId === config.SHARED_OWNER;
    const sc = scopeCode(shared ? 'shared' : 'personal');
    const fileName = `preview.${item.ext}`;
    const canEdit = !shared || item.addedById === viewerId;

    const embed = new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setTitle(`${meta.emoji} ${item.name}`)
        .setImage(`attachment://${fileName}`)
        .addFields(
            { name: 'Type', value: meta.label + (item.animated ? ' (animated)' : ''), inline: true },
            { name: 'Size', value: formatBytes(item.size), inline: true },
            { name: 'Dimensions', value: item.width ? `${item.width}×${item.height}` : '—', inline: true }
        )
        .setTimestamp(item.createdAt);
    if (shared) embed.addFields({ name: 'Added by', value: item.addedByName || 'unknown', inline: true });
    embed.addFields({ name: 'Send in chat', value: shared ? `\`!shared_${item.name}\`  or  \`/sticker library:shared\`` : `\`!sticker_${item.name}\`` });

    const tail = [item._id, filter, page, sc];
    const components = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('send', ...tail)).setLabel('📤 Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('rename', ...tail)).setLabel('✏️ Rename')
            .setStyle(ButtonStyle.Primary).setDisabled(!canEdit),
        new ButtonBuilder().setCustomId(cid('del', ...tail)).setLabel('🗑️ Delete')
            .setStyle(ButtonStyle.Danger).setDisabled(!canEdit),
        new ButtonBuilder().setCustomId(cid('back', filter, page, sc)).setLabel('⬅ Back').setStyle(ButtonStyle.Secondary)
    )];
    if (!shared) {
        // Personal items can be copied into the shared library.
        components[0].addComponents(
            new ButtonBuilder().setCustomId(cid('share', ...tail)).setLabel('🌐 Share').setStyle(ButtonStyle.Secondary)
        );
    }

    return {
        content,
        embeds: [embed],
        components,
        files: [new AttachmentBuilder(buffer, { name: fileName })],
        attachments: []
    };
}

function confirmDeleteView(item, { filter, page }) {
    const shared = item.ownerId === config.SHARED_OWNER;
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ Delete this item?')
        .setDescription(`**${item.name}** will be permanently deleted${shared ? ' for everyone' : ''}. This cannot be undone.`);

    const tail = [item._id, filter, page, scopeCode(shared ? 'shared' : 'personal')];
    return {
        content: '',
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(cid('delyes', ...tail)).setLabel('Yes, delete').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(cid('delno', ...tail)).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        )],
        files: [],
        attachments: []
    };
}

module.exports = { cid, scopeCode, scopeFromCode, listView, itemView, confirmDeleteView };
