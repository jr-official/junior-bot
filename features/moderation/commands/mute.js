// features/moderation/commands/mute.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { parseDuration, formatDuration } = require('../utils/durationParser');
const {
    canModerate, sendDM, logModeration,
    parseMembers, handleProofData, formatProofDisplay
} = require('../utils/moderationUtils');
const { generateCaseId } = require('../utils/caseID');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

module.exports = {
    name: 'mute',
    description: 'Timeout (mute) one or multiple members in the server',
    permission: 'MODERATE_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout (mute) one or multiple members in the server')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User(s) to mute (mention, ID, or multiple space-separated)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('duration')
                .setDescription('Mute duration (e.g. 10m, 1h, 1d, 1w) — max 28 days')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the mute')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('dm')
                .setDescription('Send DM to user about mute (default: true)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('proof_url')
                .setDescription('Evidence/proof URL')
                .setRequired(false))
        .addAttachmentOption(option =>
            option.setName('proof_file')
                .setDescription('Upload proof file (image/document)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async executeSlash(interaction) {
        await this.executeMute(interaction, {
            users:      interaction.options.getString('user'),
            duration:   interaction.options.getString('duration'),
            reason:     interaction.options.getString('reason'),
            dm:         interaction.options.getBoolean('dm') !== false,
            proof_url:  interaction.options.getString('proof_url'),
            proof_file: interaction.options.getAttachment('proof_file')
        });
    },

    async executePrefix(message, args) {
        if (args.length < 3) {
            return message.reply(
                '❌ **Usage:** `!mute <user> <duration> <reason> [options]`\n' +
                '**Options:** `--no-dm`, `--proof=<url>`\n' +
                '**Duration examples:** `10m`, `1h`, `6h`, `1d`, `1w` (max 28 days)\n' +
                '**Example:** `!mute @user 1h Spamming`'
            );
        }

        const options = { users: args[0], duration: args[1], reason: '', dm: true, proof_url: null, proof_file: null };
        const reasonParts = [];
        for (let i = 2; i < args.length; i++) {
            if (args[i] === '--no-dm') options.dm = false;
            else if (args[i].startsWith('--proof=')) options.proof_url = args[i].split('=')[1];
            else reasonParts.push(args[i]);
        }
        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ **Error:** Reason is required.');
        await this.executeMute(message, options);
    },

    async executeMute(context, options) {
        const guild         = context.guild;
        const moderator     = context.member || context.author;
        const isInteraction = context.replied !== undefined;

        const parsed = parseDuration(options.duration);
        if (!parsed.success) {
            const reply = '❌ Invalid duration format. Use formats like: 10m, 1h, 6h, 1d, 1w (max 28 days)';
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }
        if (!parsed.ms) {
            const reply = '❌ Mute duration cannot be permanent. Discord timeouts require a set duration (max 28 days).';
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }
        if (parsed.ms > MAX_TIMEOUT_MS) {
            const reply = '❌ Mute duration cannot exceed 28 days (Discord limitation).';
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        const duration  = parsed.duration;
        const expiresAt = new Date(Date.now() + parsed.ms);

        const proofData = await handleProofData(options.proof_url, options.proof_file);
        if (proofData.error) {
            const reply = `❌ Proof validation failed: ${proofData.error}`;
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        const memberResult = await parseMembers(guild, options.users, false);
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
                if (!target.member) {
                    results.failed.push({ user: target.user, reason: 'User is not in the server.' });
                    continue;
                }

                const canMod = await canModerate(moderator, target.member);
                if (!canMod.success) {
                    results.failed.push({ user: target.user, reason: canMod.message });
                    continue;
                }

                if (!target.member.moderatable) {
                    results.failed.push({ user: target.user, reason: 'I cannot moderate this user.' });
                    continue;
                }

                if (
                    target.member.communicationDisabledUntilTimestamp &&
                    target.member.communicationDisabledUntilTimestamp > Date.now()
                ) {
                    const existing = new Date(target.member.communicationDisabledUntilTimestamp);
                    results.failed.push({
                        user: target.user,
                        reason: `Already muted until <t:${Math.floor(existing.getTime() / 1000)}:F>. Use \`/unmute\` first.`
                    });
                    continue;
                }

                const caseId = generateCaseId('mute');

                // Muted user stays in the server so DM order doesn't affect delivery,
                // but we send before the action for consistency. We track delivery so
                // the result embed shows DM: ✅ or ❌ rather than silently swallowing
                // failures.
                let dmSent = false;
                if (options.dm && target.user) {
                    try {
                        await sendDM(target.user, {
                            type: 'mute', guild: guild.name, reason: options.reason,
                            duration, expiresAt, moderatorTag: moderator.user.tag,
                            moderatorId: moderator.user.id, proof: proofData.data, caseId
                        });
                        dmSent = true;
                    } catch {
                        dmSent = false;
                    }
                }

                await target.member.timeout(parsed.ms, `${options.reason} | Moderator: ${moderator.user.tag}`);
                results.successful.push({ user: target.user, expiresAt, caseId, dmSent });

                await logModeration(guild, {
                    type: 'mute', caseId, target: target.user, moderator: moderator.user,
                    reason: options.reason, duration, expiresAt, proof: proofData.data,
                    dmSent
                });
            } catch (error) {
                console.error(`Failed to mute ${target.user?.tag}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#ffa500').setTitle('🔇 Mute Results').setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Muted (${results.successful.length})`,
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id}) — \`${r.caseId}\` | DM: ${r.dmSent ? '✅' : options.dm ? '❌' : 'skipped'}\n   └ Expires: <t:${Math.floor(r.expiresAt.getTime() / 1000)}:R>`
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

        const details = [
            `**Reason:** ${options.reason}`,
            `**Duration:** ${formatDuration(duration)}`,
            `**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:F>`
        ];
        if (proofData.data) details.push(`**Proof:** ${formatProofDisplay(proofData.data)}`);
        embed.addFields({ name: 'Details', value: details.join('\n'), inline: false });
        if (proofData.data?.type === 'file' && proofData.data.isImage) embed.setImage(proofData.data.url);

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};