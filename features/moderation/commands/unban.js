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

        // FIX: the old parser only accepted snowflake IDs as additional targets —
        // if you typed `!unban 111 BannedUser 222`, the token "BannedUser" would
        // end the target scan and "222" would end up in the reason silently.
        //
        // New approach: the LAST argument is always the start of the reason.
        // Everything before it that looks like a snowflake OR a single-word
        // username (no spaces, not the reason) is treated as a target.
        // The reason is everything from reasonStart to the end, joined.
        //
        // Rule: greedily consume leading tokens as targets until we reach a
        // token that is NOT a snowflake. That non-snowflake token and everything
        // after it is the reason. The first arg is always a target (could be a
        // username). This matches the slash command behaviour where users/reason
        // are separate fields.

        const userTokens = [];
        let reasonStart  = args.length - 1; // fallback: last arg is the reason

        // Always treat first arg as a target
        userTokens.push(args[0]);

        // Continue consuming args as targets while they are snowflake IDs.
        // Stop at the first non-snowflake after position 0 — that's where the
        // reason begins. This is consistent: usernames go in position 0 only,
        // additional targets must be snowflakes.
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

        await this.executeUnban(message, {
            users:  userTokens.join(' '),
            reason
        });
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

                await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderatorUser.tag}`);

                try {
                    await sendDM(targetUser, {
                        type: 'unban', guild: guild.name, reason: options.reason,
                        moderatorTag: moderatorUser.tag, moderatorId: moderatorUser.id, caseId
                    });
                } catch (dmErr) {
                    console.error(`Failed to DM unban notice to ${targetUser.tag}:`, dmErr);
                }

                await logModeration(guild, {
                    type: 'unban', caseId,
                    target:    targetUser,
                    moderator: moderatorUser,
                    reason:    options.reason
                });

                results.successful.push({ user: targetUser, caseId });
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
                    `✅ **${r.user.tag}** (${r.user.id}) — \`${r.caseId}\``
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