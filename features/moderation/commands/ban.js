// features/moderation/commands/ban.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { parseDuration, formatDuration } = require('../utils/durationParser');
const { generateCaseId } = require('../utils/caseID');
const {
    canModerate,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData,
    formatProofDisplay
} = require('../utils/moderationUtils');

module.exports = {
    name: 'ban',
    description: 'Ban one or multiple members from the server',
    permission: 'BAN_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban one or multiple members from the server')
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
            option.setName('proof_url')
                .setDescription('Evidence/proof URL')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('proof_file')
                .setDescription('Upload proof file (image/document)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        await this.executeBan(interaction, {
            users:      interaction.options.getString('user'),
            reason:     interaction.options.getString('reason'),
            duration:   interaction.options.getString('duration'),
            soft:       interaction.options.getBoolean('soft')    || false,
            purge_days: interaction.options.getInteger('purge_days') || 0,
            hack:       interaction.options.getBoolean('hack')    || false,
            dm:         interaction.options.getBoolean('dm')      !== false,
            proof_url:  interaction.options.getString('proof_url'),
            proof_file: interaction.options.getAttachment('proof_file')
        });
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply(
                '❌ **Usage:** `!ban <user> <reason> [options]`\n' +
                '**Options:**\n' +
                '`--soft` - Soft ban (delete messages then unban)\n' +
                '`--hack` - Force ban user not in server\n' +
                '`--no-dm` - Don\'t send DM to user\n' +
                '`--purge=<days>` - Days of messages to delete (0-7)\n' +
                '`--duration=<time>` - Ban duration (e.g., 1d, 1w, 1m)\n' +
                '`--proof=<url>` - Evidence URL\n' +
                '**Example:** `!ban @user spam --soft --purge=7 --duration=1d`'
            );
        }

        const options = {
            users: args[0], reason: '', duration: null,
            soft: false, purge_days: 0, hack: false, dm: true,
            proof_url: null, proof_file: null
        };

        const reasonParts = [];
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--soft') options.soft = true;
            else if (arg === '--hack') options.hack = true;
            else if (arg === '--no-dm') options.dm = false;
            else if (arg.startsWith('--purge=')) {
                const days = parseInt(arg.split('=')[1]);
                if (days >= 0 && days <= 7) options.purge_days = days;
                else return message.reply('❌ **Error:** Purge days must be between 0 and 7.');
            } else if (arg.startsWith('--duration=')) options.duration = arg.split('=')[1];
            else if (arg.startsWith('--proof=')) options.proof_url = arg.split('=')[1];
            else reasonParts.push(arg);
        }

        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ **Error:** Reason is required.');

        await this.executeBan(message, options);
    },

    async executeBan(context, options) {
        const guild         = context.guild;
        const moderator     = context.member || context.author;
        const isInteraction = context.replied !== undefined;

        const proofData = await handleProofData(options.proof_url, options.proof_file);
        if (proofData.error) {
            const reply = `❌ Proof validation failed: ${proofData.error}`;
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        let duration = null, expiresAt = null;
        if (options.duration) {
            const parsed = parseDuration(options.duration);
            if (!parsed.success) {
                const reply = '❌ Invalid duration format. Use formats like: 1d, 1w, 1m, permanent';
                return isInteraction
                    ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                    : context.reply(reply);
            }
            duration  = parsed.duration;
            expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms) : null;
        }

        const memberResult = await parseMembers(guild, options.users, options.hack);
        if (!memberResult.success) {
            const reply = `❌ ${memberResult.message}`;
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        if (isInteraction) await context.deferReply();

        const results = {
            successful: [],
            failed: (memberResult.failed || []).map(f => ({ user: f.user, reason: f.reason }))
        };

        for (const target of memberResult.targets) {
            try {
                if (target.member) {
                    const canMod = await canModerate(moderator, target.member);
                    if (!canMod.success) {
                        results.failed.push({ user: target.user, reason: canMod.message });
                        continue;
                    }
                }

                const caseId = generateCaseId(options.soft ? 'softban' : 'ban');

                // DM goes out BEFORE the ban. Once banned the user leaves the server and
                // the bot may lose DM access if they share no other server. We track
                // whether it actually delivered so the result embed shows DM: ✅ or ❌.
                let dmSent = false;
                if (options.dm && target.user) {
                    try {
                        await sendDM(target.user, {
                            type: options.soft ? 'softban' : 'ban',
                            guild: guild.name, reason: options.reason,
                            duration, moderatorTag: moderator.user.tag,
                            moderatorId: moderator.user.id, proof: proofData.data, caseId
                        });
                        dmSent = true;
                    } catch {
                        dmSent = false;
                    }
                }

                await guild.members.ban(target.user, {
                    reason: `${options.reason} | Moderator: ${moderator.user.tag}`,
                    deleteMessageSeconds: options.purge_days * 24 * 60 * 60
                });

                if (options.soft) {
                    await guild.members.unban(target.user, `Soft ban completed | Moderator: ${moderator.user.tag}`);
                }

                results.successful.push({ user: target.user, member: target.member, caseId, dmSent });

                await logModeration(guild, {
                    type: options.soft ? 'softban' : 'ban', caseId,
                    target: target.user, moderator: moderator.user,
                    reason: options.reason, duration, expiresAt,
                    proof: proofData.data, purge_days: options.purge_days,
                    dmSent
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
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id}) — \`${r.caseId}\` | DM: ${r.dmSent ? '✅' : options.dm ? '❌' : 'skipped'}`
                ).join('\n'),
                inline: false
            });
        }
        if (results.failed.length > 0) {
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: results.failed.map(r =>
                    `❌ **${r.user?.tag || 'Unknown'}** - ${r.reason}`
                ).join('\n'),
                inline: false
            });
        }

        const details = [`**Reason:** ${options.reason}`];
        if (duration)               details.push(`**Duration:** ${formatDuration(duration)}`);
        if (options.purge_days > 0) details.push(`**Messages Deleted:** ${options.purge_days} days`);
        if (proofData.data)         details.push(`**Proof:** ${formatProofDisplay(proofData.data)}`);
        embed.addFields({ name: 'Details', value: details.join('\n'), inline: false });

        if (proofData.data?.type === 'file' && proofData.data.isImage) embed.setImage(proofData.data.url);

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};