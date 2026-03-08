// features/moderation/commands/warn.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const {
    canModerate,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData
} = require('../utils/moderationUtils');
const warningService = require('../services/warningService');

// How many warnings to show per page in the remove picker
const REMOVE_PAGE_SIZE = 3;

module.exports = {
    name: 'warn',
    description: 'Warn a member or remove a warning',
    permission: 'MODERATE_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member or manage warnings')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Issue a warning to one or multiple members')
                .addStringOption(opt =>
                    opt.setName('user')
                        .setDescription('User(s) to warn (mention or ID, space-separated for multiple)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for the warning')
                        .setRequired(true))
                .addBooleanOption(opt =>
                    opt.setName('dm')
                        .setDescription('Send DM to user about the warning (default: true)')
                        .setRequired(false))
                .addStringOption(opt =>
                    opt.setName('proof_url')
                        .setDescription('Evidence/proof URL')
                        .setRequired(false))
                .addAttachmentOption(opt =>
                    opt.setName('proof_file')
                        .setDescription('Upload proof file (image/document)')
                        .setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Pick and remove a specific warning from a member')
                .addUserOption(opt =>
                    opt.setName('user')
                        .setDescription('The user to remove a warning from')
                        .setRequired(true))
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            await this.executeWarnAdd(interaction, {
                users: interaction.options.getString('user'),
                reason: interaction.options.getString('reason'),
                dm: interaction.options.getBoolean('dm') !== false,
                proof_url: interaction.options.getString('proof_url'),
                proof_file: interaction.options.getAttachment('proof_file')
            });
        } else if (sub === 'remove') {
            const targetUser = interaction.options.getUser('user');
            await this.executeWarnRemovePicker(interaction, targetUser, 0);
        }
    },

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(
                '❌ **Usage:**\n' +
                '`!warn <user> <reason> [options]` — Issue a warning\n' +
                '`!warn remove <user>` — Open warning removal picker\n' +
                '**Options:** `--no-dm`, `--proof=<url>`'
            );
        }

        const isRemove = args[0].toLowerCase() === 'remove';

        if (isRemove) {
            if (!args[1]) return message.reply('❌ **Error:** You must provide a user.');

            let userId = args[1];
            if (userId.match(/^<@!?(\d+)>$/)) userId = userId.match(/^<@!?(\d+)>$/)[1];

            let targetUser;
            try {
                targetUser = await message.client.users.fetch(userId);
            } catch {
                return message.reply('❌ Could not find that user.');
            }

            const warnings = await warningService.getUserWarnings(message.guild.id, targetUser.id);
            if (!warnings.length) {
                return message.reply(`✅ **${targetUser.tag}** has no active warnings.`);
            }

            const { embed, components } = buildRemovePickerPage(targetUser, warnings, 0);
            return message.reply({ embeds: [embed], components });
        }

        // Prefix warn add
        if (args.length < 2) {
            return message.reply('❌ **Error:** You must provide a user and a reason.');
        }

        const options = {
            users: args[0],
            reason: '',
            dm: true,
            proof_url: null,
            proof_file: null
        };

        const reasonParts = [];
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--no-dm') options.dm = false;
            else if (arg.startsWith('--proof=')) options.proof_url = arg.split('=')[1];
            else reasonParts.push(arg);
        }

        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ **Error:** Reason is required.');

        await this.executeWarnAdd(message, options);
    },

    // ─── WARN ADD ────────────────────────────────────────────────────────────
    async executeWarnAdd(context, options) {
        const guild = context.guild;
        const moderator = context.member;
        const isInteraction = context.replied !== undefined;

        const proofData = await handleProofData(options.proof_url, options.proof_file);
        if (proofData.error) {
            const reply = `❌ Proof validation failed: ${proofData.error}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }

        const memberResult = await parseMembers(guild, options.users, false);
        if (!memberResult.success) {
            const reply = `❌ ${memberResult.message}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }

        if (isInteraction) await context.deferReply();

        const results = { successful: [], failed: [] };

        for (const target of memberResult.targets) {
            try {
                if (!target.member) {
                    results.failed.push({ user: target.user, reason: 'User is not in the server.' });
                    continue;
                }

                const canMod = await canModerate(moderator, target.member);
                if (!canMod.success) {
                    results.failed.push({ user: target.user, reason: canMod.message });
                    continue;
                }

                let dmSent = false;
                if (options.dm) {
                    try {
                        await sendDM(target.user, {
                            type: 'warn',
                            guild: guild.name,
                            reason: options.reason,
                            moderatorTag: moderator.user.tag,
                            moderatorId: moderator.user.id,
                            proof: proofData.data
                        });
                        dmSent = true;
                    } catch {
                        dmSent = false;
                    }
                }

                const warning = await warningService.addWarning(
                    guild.id,
                    target.user,
                    moderator.user,
                    options.reason,
                    proofData.data,
                    dmSent
                );

                const totalWarnings = await warningService.getUserWarningCount(guild.id, target.user.id);
                results.successful.push({ user: target.user, warning, totalWarnings, dmSent });

                await logModeration(guild, {
                    type: 'warn',
                    target: target.user,
                    moderator: moderator.user,
                    reason: options.reason,
                    proof: proofData.data,
                    totalWarnings,
                    dmSent
                });
            } catch (error) {
                console.error(`Failed to warn ${target.user?.tag}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#ffcc00')
            .setTitle('⚠️ Warn Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Warned (${results.successful.length})`,
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id})\n   └ Total warnings: **${r.totalWarnings}** | DM sent: ${r.dmSent ? '✅' : '❌'}`
                ).join('\n'),
                inline: false
            });
        }

        if (results.failed.length > 0) {
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: results.failed.map(r => `❌ **${r.user?.tag || 'Unknown'}** — ${r.reason}`).join('\n'),
                inline: false
            });
        }

        const details = [`**Reason:** ${options.reason}`];
        if (proofData.data) details.push(`**Proof:** ${formatProofDisplay(proofData.data)}`);
        embed.addFields({ name: 'Details', value: details.join('\n'), inline: false });

        if (proofData.data?.type === 'file' && proofData.data.isImage) {
            embed.setImage(proofData.data.url);
        }

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    },

    // ─── WARN REMOVE PICKER (initial open) ───────────────────────────────────
    async executeWarnRemovePicker(interaction, targetUser, page) {
        await interaction.deferReply();

        const warnings = await warningService.getUserWarnings(interaction.guild.id, targetUser.id);

        if (!warnings.length) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#00ff99')
                        .setDescription(`✅ **${targetUser.tag}** has no active warnings to remove.`)
                ]
            });
        }

        const { embed, components } = buildRemovePickerPage(targetUser, warnings, page);
        return interaction.editReply({ embeds: [embed], components });
    }
};

// ─── BUTTON HANDLER (exported, registered in moderation.js) ──────────────────
async function handleWarnRemoveButton(interaction, guild) {
    const id = interaction.customId;

    // ── Pagination: warnrm_page_<userId>_<page>
    const pageMatch = id.match(/^warnrm_page_(\d+)_(\d+)$/);
    if (pageMatch) {
        const userId = pageMatch[1];
        const page = parseInt(pageMatch[2]);

        await interaction.deferUpdate();

        let targetUser;
        try {
            targetUser = await interaction.client.users.fetch(userId);
        } catch {
            return interaction.editReply({ content: '❌ Could not fetch user.', embeds: [], components: [] });
        }

        const warnings = await warningService.getUserWarnings(guild.id, userId);

        if (!warnings.length) {
            return interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#00ff99')
                        .setDescription(`✅ **${targetUser.tag}** has no more active warnings.`)
                ],
                components: []
            });
        }

        const totalPages = Math.ceil(warnings.length / REMOVE_PAGE_SIZE);
        const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
        const { embed, components } = buildRemovePickerPage(targetUser, warnings, clampedPage);
        return interaction.editReply({ embeds: [embed], components });
    }

    // ── Remove button: warnrm_do_<warningId>_<userId>
    const removeMatch = id.match(/^warnrm_do_([a-f0-9]{24})_(\d+)$/);
    if (removeMatch) {
        const warningId = removeMatch[1];
        const userId = removeMatch[2];

        // Acknowledge quickly — we'll edit after doing DB work
        await interaction.deferUpdate();

        const removed = await warningService.removeWarningById(warningId);

        if (!removed) {
            return interaction.editReply({
                content: '❌ That warning could not be found or was already removed.',
                embeds: [],
                components: []
            });
        }

        let targetUser;
        try {
            targetUser = await interaction.client.users.fetch(userId);
        } catch {
            targetUser = { tag: removed.username, id: userId, displayAvatarURL: () => null };
        }

        const remaining = await warningService.getUserWarningCount(guild.id, userId);
        const ts = Math.floor(new Date(removed.createdAt).getTime() / 1000);

        // Build a confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setColor('#00ccff')
            .setTitle('🗑️ Warning Removed')
            .setDescription(`A warning has been removed from **${targetUser.tag}** (${userId}).`)
            .addFields(
                { name: 'Removed Warning Reason', value: removed.reason,                             inline: false },
                { name: 'Originally Issued By',   value: `<@${removed.moderatorId}> (${removed.moderatorId})`, inline: true },
                { name: 'Originally Issued',      value: `<t:${ts}:F>`,                              inline: true },
                { name: 'DM was sent',             value: removed.dmSent ? '✅ Yes' : '❌ No',        inline: true },
                { name: 'Remaining Warnings',      value: `${remaining}`,                             inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Removed by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        if (removed.proof) {
            confirmEmbed.addFields({
                name: 'Original Proof',
                value: formatProofDisplay(removed.proof),
                inline: false
            });
        }

        // Log to mod-logs
        await logModeration(guild, {
            type: 'warn_remove',
            target: { tag: removed.username, id: userId },
            moderator: interaction.user,
            reason: 'Manually removed via warning picker',
            originalReason: removed.reason,
            remaining,
            proof: null,
            dmSent: false
        });

        // Show updated picker (remaining warnings) or just the confirm embed if none left
        if (remaining === 0) {
            return interaction.editReply({ embeds: [confirmEmbed], components: [] });
        }

        // Re-fetch updated warnings and rebuild the picker on page 0 below the confirm
        const updatedWarnings = await warningService.getUserWarnings(guild.id, userId);
        const { embed: pickerEmbed, components } = buildRemovePickerPage(targetUser, updatedWarnings, 0);

        return interaction.editReply({
            embeds: [confirmEmbed, pickerEmbed],
            components
        });
    }

    return false; // not handled
}

// ─── EMBED + BUTTON BUILDER ───────────────────────────────────────────────────
function buildRemovePickerPage(targetUser, warnings, page) {
    const totalPages = Math.max(1, Math.ceil(warnings.length / REMOVE_PAGE_SIZE));
    const start = page * REMOVE_PAGE_SIZE;
    const slice = warnings.slice(start, start + REMOVE_PAGE_SIZE);

    const embed = new EmbedBuilder()
        .setColor('#ffcc00')
        .setTitle(`⚠️ Remove Warning — ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL ? targetUser.displayAvatarURL({ size: 64 }) : null)
        .setDescription(
            `**${targetUser.tag}** (${targetUser.id}) has **${warnings.length}** active warning${warnings.length !== 1 ? 's' : ''}.\n` +
            `Click a **Remove Warning** button below to remove that specific warning.\n\u200b`
        )
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${warnings.length} active warning${warnings.length !== 1 ? 's' : ''}` });

    // Add each warning as a field
    for (const [i, w] of slice.entries()) {
        const globalIndex = start + i + 1;
        const ts = Math.floor(new Date(w.createdAt).getTime() / 1000);

        const lines = [
            `**Reason:** ${w.reason}`,
            `**Moderator:** <@${w.moderatorId}> (${w.moderatorId})`,
            `**Issued:** <t:${ts}:F> (<t:${ts}:R>)`,
            `**DM sent:** ${w.dmSent ? '✅ Yes' : '❌ No'}`
        ];

        if (w.proof) {
            lines.push(`**Proof:** ${formatProofDisplay(w.proof)}`);
        }

        embed.addFields({
            name: `Warning #${globalIndex}`,
            value: lines.join('\n'),
            inline: false
        });
    }

    // Build button rows:
    // Row 1–N: one Remove Warning button per warning on this page (max 5 per row, but we have max 3 per page so one row)
    // Last row: pagination ← →
    const rows = [];

    // Remove buttons — one per warning on this page
    // Discord allows max 5 buttons per row, we have up to 3 warnings so they all fit in one row
    const removeRow = new ActionRowBuilder().addComponents(
        slice.map((w, i) => {
            const globalIndex = start + i + 1;
            return new ButtonBuilder()
                .setCustomId(`warnrm_do_${w._id.toString()}_${targetUser.id}`)
                .setLabel(`Remove Warning #${globalIndex}`)
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️');
        })
    );
    rows.push(removeRow);

    // Pagination row (only if more than one page)
    if (totalPages > 1) {
        const pageRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`warnrm_page_${targetUser.id}_${page - 1}`)
                .setLabel('← Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`warnrm_page_${targetUser.id}_${page + 1}`)
                .setLabel('Next →')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        );
        rows.push(pageRow);
    }

    return { embed, components: rows };
}

// ─── PROOF HELPERS ────────────────────────────────────────────────────────────
function formatProofDisplay(proofData) {
    if (!proofData) return 'None';
    if (proofData.type === 'file') {
        const emoji = proofData.isImage ? '🖼️' : '📄';
        return `${emoji} [${proofData.filename}](${proofData.url}) (${formatFileSize(proofData.size)})`;
    }
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})`;
    return 'None';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Need logModeration for the button handler
const { logModeration } = require('../utils/moderationUtils');

module.exports.handleWarnRemoveButton = handleWarnRemoveButton;