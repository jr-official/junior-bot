// features/moderation/commands/unmute.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const {
    canModerate,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData
} = require('../utils/moderationUtils');
const { generateCaseId } = require('../utils/caseID');

module.exports = {
    name: 'unmute',
    description: 'Remove timeout (unmute) from one or multiple members',
    permission: 'MODERATE_MEMBERS',

    slashCommand: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout (unmute) from one or multiple members')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User(s) to unmute (mention, ID, or multiple space-separated)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the unmute')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('dm')
                .setDescription('Send DM to user about unmute (default: true)')
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
        await this.executeUnmute(interaction, {
            users: interaction.options.getString('user'),
            reason: interaction.options.getString('reason'),
            dm: interaction.options.getBoolean('dm') !== false,
            proof_url: interaction.options.getString('proof_url'),
            proof_file: interaction.options.getAttachment('proof_file')
        });
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply(
                '❌ **Usage:** `!unmute <user> <reason> [options]`\n' +
                '**Options:** `--no-dm`, `--proof=<url>`\n' +
                '**Example:** `!unmute @user Appeal accepted`'
            );
        }

        const options = { users: args[0], reason: '', dm: true, proof_url: null, proof_file: null };
        const reasonParts = [];

        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            if (arg === '--no-dm') options.dm = false;
            else if (arg.startsWith('--proof=')) options.proof_url = arg.split('=')[1];
            else reasonParts.push(arg);
        }

        options.reason = reasonParts.join(' ');
        if (!options.reason) return message.reply('❌ **Error:** Reason is required.');

        await this.executeUnmute(message, options);
    },

    async executeUnmute(context, options) {
        const guild = context.guild;
        const moderator = context.member || context.author;
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

        const results = { successful: [], failed: [] };
        if (isInteraction) await context.deferReply();

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

                const isMuted = target.member.communicationDisabledUntilTimestamp &&
                    target.member.communicationDisabledUntilTimestamp > Date.now();

                if (!isMuted) {
                    results.failed.push({ user: target.user, reason: 'This user is not currently muted.' });
                    continue;
                }

                const caseId = generateCaseId('unmute');

                if (options.dm && target.user) {
                    await sendDM(target.user, {
                        type: 'unmute',
                        guild: guild.name,
                        reason: options.reason,
                        moderatorTag: moderator.user.tag,
                        moderatorId:  moderator.user.id,
                        proof: proofData.data,
                        caseId
                    });
                }

                await target.member.timeout(null, `${options.reason} | Moderator: ${moderator.user.tag}`);
                results.successful.push({ user: target.user, caseId });

                await logModeration(guild, {
                    type: 'unmute',
                    caseId,
                    target: target.user,
                    moderator: moderator.user,
                    reason: options.reason,
                    proof: proofData.data
                });
            } catch (error) {
                console.error(`Failed to unmute ${target.user?.tag}:`, error);
                results.failed.push({ user: target.user, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#00ff99')
            .setTitle('🔊 Unmute Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Unmuted (${results.successful.length})`,
                value: results.successful.map(r => `✅ **${r.user.tag}** (${r.user.id}) — \`${r.caseId}\``).join('\n'),
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