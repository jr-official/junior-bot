// features/moderation/commands/unban.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { sendDM, logModeration } = require('../utils/moderationUtils');
const { generateCaseId } = require('../utils/caseID');

module.exports = {
    name: 'unban',
    description: 'Unban one or multiple users from the server',

    slashCommand: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban one or multiple users from the server')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User ID(s) or username(s) to unban (space-separated for multiple)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the unban')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        await this.executeUnban(interaction, {
            users:  interaction.options.getString('user'),
            reason: interaction.options.getString('reason')
        });
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply(
                '❌ **Usage:** `!unban <user(s)> <reason>`\n' +
                'Multiple users: `!unban <id1> <id2> <reason>`\n' +
                '**Example:** `!unban 123456789 Appeal accepted`'
            );
        }

        // First arg is always a target (ID or username).
        // Additional targets must be snowflake IDs.
        // First non-snowflake after position 0 starts the reason.
        const userTokens = [];
        let reasonStart  = args.length - 1;

        userTokens.push(args[0]);

        for (let i = 1; i < args.length - 1; i++) {
            if (/^\d{17,19}$/.test(args[i])) {
                userTokens.push(args[i]);
                reasonStart = i + 1;
            } else {
                reasonStart = i;
                break;
            }
        }

        const reason = args.slice(reasonStart).join(' ');
        if (!reason) return message.reply('❌ **Error:** Reason is required.');

        await this.executeUnban(message, { users: userTokens.join(' '), reason });
    },

    async executeUnban(context, options) {
        const guild         = context.guild;
        const moderator     = context.member || context.author;
        const moderatorUser = moderator.user ?? moderator;
        const isInteraction = context.replied !== undefined;

        const rawTokens = options.users.split(/[\s,]+/).filter(Boolean);
        if (!rawTokens.length) {
            const reply = '❌ No users provided.';
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        let bans;
        try {
            bans = await guild.bans.fetch();
        } catch (err) {
            console.error('Failed to fetch ban list:', err);
            const reply = '❌ Could not fetch the ban list. Check my permissions.';
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }

        if (isInteraction) await context.deferReply();

        const results = { successful: [], failed: [] };

        for (const token of rawTokens) {
            try {
                let targetUser = null;

                if (/^\d{17,19}$/.test(token)) {
                    targetUser = bans.get(token)?.user ?? null;
                } else {
                    targetUser = bans.find(ban =>
                        ban.user.username.toLowerCase() === token.toLowerCase() ||
                        ban.user.tag.toLowerCase()      === token.toLowerCase()
                    )?.user ?? null;
                }

                if (!targetUser) {
                    results.failed.push({ token, reason: 'User not found in ban list.' });
                    continue;
                }

                const caseId = generateCaseId('unban');

                // Unban executes FIRST. The user is not in the server when this runs,
                // so the bot has no DM access until the unban restores the shared-server
                // relationship. DM is attempted after and tracked — failure is non-fatal.
                await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderatorUser.tag}`);

                let dmSent = false;
                try {
                    await sendDM(targetUser, {
                        type: 'unban', guild: guild.name, reason: options.reason,
                        moderatorTag: moderatorUser.tag, moderatorId: moderatorUser.id, caseId
                    });
                    dmSent = true;
                } catch (dmErr) {
                    console.error(`Failed to DM unban notice to ${targetUser.tag}:`, dmErr);
                    dmSent = false;
                }

                await logModeration(guild, {
                    type: 'unban', caseId,
                    target:    targetUser,
                    moderator: moderatorUser,
                    reason:    options.reason,
                    dmSent
                });

                results.successful.push({ user: targetUser, caseId, dmSent });
            } catch (error) {
                console.error(`Failed to unban ${token}:`, error);
                results.failed.push({ token, reason: error.message });
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🔓 Unban Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderatorUser.tag}`, iconURL: moderatorUser.displayAvatarURL() });

        if (results.successful.length > 0) {
            embed.addFields({
                name: `Unbanned (${results.successful.length})`,
                value: results.successful.map(r =>
                    `✅ **${r.user.tag}** (${r.user.id}) — \`${r.caseId}\` | DM: ${r.dmSent ? '✅' : '❌'}`
                ).join('\n'),
                inline: false
            });
        }

        if (results.failed.length > 0) {
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: results.failed.map(r =>
                    `❌ **${r.token}** — ${r.reason}`
                ).join('\n'),
                inline: false
            });
        }

        embed.addFields({
            name: 'Details',
            value: `**Reason:** ${options.reason}`,
            inline: false
        });

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};