// features/moderation/commands/warn.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const {
    canModerate,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData
} = require('../utils/moderationUtils');
const warningService = require('../services/warningService');

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
                .setDescription('Remove the most recent active warning from one or multiple members')
                .addStringOption(opt =>
                    opt.setName('user')
                        .setDescription('User(s) to remove a warning from (mention or ID, space-separated)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('reason')
                        .setDescription('Reason for removing the warning')
                        .setRequired(true))
                .addBooleanOption(opt =>
                    opt.setName('dm')
                        .setDescription('Notify user via DM about the warning removal (default: true)')
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
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();

        const sharedOptions = {
            users: interaction.options.getString('user'),
            reason: interaction.options.getString('reason'),
            dm: interaction.options.getBoolean('dm') !== false,
            proof_url: interaction.options.getString('proof_url'),
            proof_file: interaction.options.getAttachment('proof_file')
        };

        if (sub === 'add') {
            await this.executeWarnAdd(interaction, sharedOptions);
        } else if (sub === 'remove') {
            await this.executeWarnRemove(interaction, sharedOptions);
        }
    },

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(
                '❌ **Usage:**\n' +
                '`!warn <user> <reason> [options]` — Issue a warning\n' +
                '`!warn remove <user> <reason> [options]` — Remove most recent warning\n' +
                '**Options:** `--no-dm`, `--proof=<url>`'
            );
        }

        const isRemove = args[0].toLowerCase() === 'remove';
        const startIdx = isRemove ? 1 : 0;

        if (args.length < startIdx + 2) {
            return message.reply('❌ **Error:** You must provide a user and a reason.');
        }

        const options = {
            users: args[startIdx],
            reason: '',
            dm: true,
            proof_url: null,
            proof_file: null
        };

        const reasonParts = [];
        for (let i = startIdx + 1; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--no-dm') {
                options.dm = false;
            } else if (arg.startsWith('--proof=')) {
                options.proof_url = arg.split('=')[1];
            } else {
                reasonParts.push(arg);
            }
        }

        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ **Error:** Reason is required.');

        if (isRemove) {
            await this.executeWarnRemove(message, options);
        } else {
            await this.executeWarnAdd(message, options);
        }
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

    // ─── WARN REMOVE ─────────────────────────────────────────────────────────
    async executeWarnRemove(context, options) {
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
                const removed = await warningService.removeWarning(guild.id, target.user.id);

                if (!removed) {
                    results.failed.push({ user: target.user, reason: 'This user has no active warnings to remove.' });
                    continue;
                }

                const remaining = await warningService.getUserWarningCount(guild.id, target.user.id);

                let dmSent = false;
                if (options.dm) {
                    try {
                        await sendDM(target.user, {
                            type: 'warn_remove',
                            guild: guild.name,
                            reason: options.reason,
                            moderatorTag: moderator.user.tag,
                            moderatorId: moderator.user.id,
                            originalReason: removed.reason,
                            remaining,
                            proof: proofData.data
                        });
                        dmSent = true;
                    } catch {
                        dmSent = false;
                    }
                }

                results.successful.push({ user: target.user, removed, remaining, dmSent });

                await logModeration(guild, {
                    type: 'warn_remove',
                    target: target.user,
                    moderator: moderator.user,
                    reason: options.reason,
                    originalReason: removed.reason,
                    remaining,
                    proof: proofData.data,
                    dmSent
                });
            } catch (error) {
                console.error(`Failed to remove warning for ${target.user?.tag}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#00ccff')
            .setTitle('🗑️ Warning Removal Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Removed (${results.successful.length})`,
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id})\n   └ Removed warning: *"${r.removed.reason}"*\n   └ Remaining warnings: **${r.remaining}** | DM sent: ${r.dmSent ? '✅' : '❌'}`
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

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};

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