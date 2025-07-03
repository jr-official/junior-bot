// features/moderation/commands/ban.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { parseDuration, formatDuration } = require('../utils/durationParser');
const {
    canModerate,
    sendDM,
    logModeration,
    parseMembers,
    validatePermissions
} = require('../utils/moderationUtils');

module.exports = {
    name: 'ban',
    description: 'Ban one or multiple members from the server',

    slashCommand: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Ban one or multiple members')
                .addStringOption(option =>
                    option.setName('user')
                        .setDescription('User(s) to ban (mention, ID, or username)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for the ban')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Duration of ban (e.g., 1d, 1w, 1m, permanent)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('soft')
                        .setDescription('Soft ban (ban then immediately unban to delete messages)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('purge_days')
                        .setDescription('Days of messages to delete (0-7)')
                        .setMinValue(0)
                        .setMaxValue(7)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('hack')
                        .setDescription('Force ban user not in server')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('dm')
                        .setDescription('Send DM to user about ban')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('proof')
                        .setDescription('Evidence/proof URL')
                        .setRequired(false)))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            await this.executeBan(interaction, {
                users: interaction.options.getString('user'),
                reason: interaction.options.getString('reason'),
                duration: interaction.options.getString('duration'),
                soft: interaction.options.getBoolean('soft') || false,
                purge_days: interaction.options.getInteger('purge_days') || 0,
                hack: interaction.options.getBoolean('hack') || false,
                dm: interaction.options.getBoolean('dm') !== false,
                proof: interaction.options.getString('proof')
            });
        }
    },

    async executeBan(context, options) {
        const guild = context.guild;
        const moderator = context.member || context.author;
        const isInteraction = context.replied !== undefined;

        const permissionCheck = await validatePermissions(moderator, 'BAN_MEMBERS');
        if (!permissionCheck.success) {
            const reply = `❌ ${permissionCheck.message}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }

        let duration = null;
        let durationMs = null;
        let expiresAt = null;

        if (options.duration) {
            const parsed = parseDuration(options.duration);
            if (!parsed.success) {
                const reply = `❌ Invalid duration format. Use formats like: 1d, 1w, 1m, permanent`;
                const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
                return isInteraction ? context.reply(replyObj) : context.reply(reply);
            }
            duration = parsed.duration;
            durationMs = parsed.ms;
            expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms) : null;
        }

        const memberResult = await parseMembers(guild, options.users, options.hack);
        if (!memberResult.success) {
            const reply = `❌ ${memberResult.message}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }

        const targets = memberResult.targets;
        const results = { successful: [], failed: [] };

        if (isInteraction) {
            await context.deferReply();
        }

        for (const target of targets) {
            try {
                if (target.member) {
                    const canMod = await canModerate(moderator, target.member);
                    if (!canMod.success) {
                        results.failed.push({ user: target.user, reason: canMod.message });
                        continue;
                    }
                }

                if (options.dm && target.user) {
                    await sendDM(target.user, {
                        type: 'ban',
                        guild: guild.name,
                        reason: options.reason,
                        duration: duration,
                        moderator: moderator.user.username,
                        proof: options.proof
                    });
                }

                await guild.members.ban(target.user, {
                    reason: `${options.reason} | Moderator: ${moderator.user.tag}`,
                    deleteMessageSeconds: options.purge_days * 24 * 60 * 60
                });

                if (options.soft) {
                    await guild.members.unban(target.user, `Soft ban completed | Moderator: ${moderator.user.tag}`);
                }

                results.successful.push({ user: target.user, member: target.member });

                await logModeration(guild, {
                    type: options.soft ? 'softban' : 'ban',
                    target: target.user,
                    moderator: moderator.user,
                    reason: options.reason,
                    duration: duration,
                    expiresAt: expiresAt,
                    proof: options.proof,
                    purge_days: options.purge_days
                });
            } catch (error) {
                console.error(`Failed to ban ${target.user?.tag || target.id}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor(options.soft ? '#ff9500' : '#ff0000')
            .setTitle(options.soft ? '🔨 Soft Ban Results' : '🔨 Ban Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `${options.soft ? 'Soft Banned' : 'Banned'} (${results.successful.length})`,
                value: results.successful.map(r => `✅ **${r.user.tag}** (${r.user.id})`).join('\n'),
                inline: false
            });
        }

        if (results.failed.length > 0) {
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: results.failed.map(r => `❌ **${r.user?.tag || 'Unknown'}** - ${r.reason}`).join('\n'),
                inline: false
            });
        }

        const details = [`**Reason:** ${options.reason}`];
        if (duration) details.push(`**Duration:** ${formatDuration(duration)}`);
        if (options.purge_days > 0) details.push(`**Messages Deleted:** ${options.purge_days} days`);
        if (options.proof) details.push(`**Proof:** [View Evidence](${options.proof})`);

        embed.addFields({ name: 'Details', value: details.join('\n'), inline: false });

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};
