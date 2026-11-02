// features/media/ui/libraryView.js
// Builds the ephemeral library screens. All state lives in the customIds:
//   media:<action>:<args...>   (parsed in handlers/interactionHandler.js)
const {
    EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, AttachmentBuilder
} = require('discord.js');
const config = require('../config/mediaConfig');
const { TYPE_META, FILTERS, formatBytes } = require('../utils/mediaUtils');

const cid = (...parts) => ['media', ...parts].join(':');
const FILTER_LABEL = { all: 'All', image: 'Images', gif: 'GIFs', sticker: 'Stickers' };

function usageLine(usage) {
    return `${usage.count}/${usage.maxCount} items · ${formatBytes(usage.bytes)} of ${formatBytes(usage.maxBytes)} used`;
}

function listView({ items, total, pages, page, filter, usage }) {
    const embed = new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setTitle('📚 Your media library')
        .setFooter({ text: 'Add: /media file:<upload> name:<name>  ·  Send in chat: !sticker_<name>' });

    const lines = [`**${FILTER_LABEL[filter]}** · ${total} item${total === 1 ? '' : 's'} · page ${page + 1}/${pages}`,
                   usageLine(usage)];
    if (items.length) {
        lines.push('', items.map(i => `${TYPE_META[i.type].emoji} \`${i.name}\``).join('  '));
        lines.push('', 'Pick an item below to preview it.');
    } else {
        lines.push('', filter === 'all'
            ? 'Nothing here yet. Use **➕ Add** to see how to save your first item.'
            : 'No items of this type yet.');
    }
    embed.setDescription(lines.join('\n'));

    const components = [];

    if (items.length) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(cid('pick', filter, page))
                .setPlaceholder('Select an item…')
                .addOptions(items.map(i => ({
                    label: i.name,
                    value: String(i._id),
                    description: `${TYPE_META[i.type].label} · ${formatBytes(i.size)}`,
                    emoji: TYPE_META[i.type].emoji
                })))
        ));
    }

    components.push(new ActionRowBuilder().addComponents(
        FILTERS.map(f => new ButtonBuilder()
            .setCustomId(cid('filter', f))
            .setLabel(FILTER_LABEL[f])
            .setStyle(f === filter ? ButtonStyle.Primary : ButtonStyle.Secondary))
    ));

    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('page', filter, page - 1)).setLabel('◀ Prev')
            .setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId(cid('page', filter, page + 1)).setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        new ButtonBuilder().setCustomId(cid('add')).setLabel('➕ Add').setStyle(ButtonStyle.Success)
    ));

    // attachments: [] clears any preview file left over from the item screen
    return { content: '', embeds: [embed], components, files: [], attachments: [] };
}

function itemView(item, buffer, { filter, page, content = '' }) {
    const meta = TYPE_META[item.type];
    const fileName = `preview.${item.ext}`;

    const embed = new EmbedBuilder()
        .setColor(config.EMBED_COLOR)
        .setTitle(`${meta.emoji} ${item.name}`)
        .setImage(`attachment://${fileName}`)
        .addFields(
            { name: 'Type', value: meta.label + (item.animated ? ' (animated)' : ''), inline: true },
            { name: 'Size', value: formatBytes(item.size), inline: true },
            { name: 'Dimensions', value: item.width ? `${item.width}×${item.height}` : '—', inline: true },
            { name: 'Send in chat', value: `\`!sticker_${item.name}\`` }
        )
        .setTimestamp(item.createdAt);

    const tail = [item._id, filter, page];
    const components = [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('send', ...tail)).setLabel('📤 Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(cid('rename', ...tail)).setLabel('✏️ Rename').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(cid('del', ...tail)).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cid('back', filter, page)).setLabel('⬅ Back').setStyle(ButtonStyle.Secondary)
    )];

    return {
        content,
        embeds: [embed],
        components,
        files: [new AttachmentBuilder(buffer, { name: fileName })],
        attachments: []
    };
}

function confirmDeleteView(item, { filter, page }) {
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ Delete this item?')
        .setDescription(`**${item.name}** will be permanently deleted. This cannot be undone.`);

    const tail = [item._id, filter, page];
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

module.exports = { cid, listView, itemView, confirmDeleteView };
