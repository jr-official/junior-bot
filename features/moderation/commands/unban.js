// features/moderation/commands/unban.js
// Note: permission checking is handled upstream by slashCommandHandler /
// prefixCommandHandler before executeSlash / executePrefix are called.
// The redundant internal validatePermissions call has been removed.
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { sendDM, logModeration } = require('../utils/moderationUtils');
const { generateCaseId } = require('../utils/caseID');

module.exports = {
    name: 'unban',
    description: 'Unban a user from the server',

    slashCommand: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User ID or username to unban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the unban')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        await this.executeUnban(interaction, {
            user:   interaction.options.getString('user'),
            reason: interaction.options.getString('reason')
        });
    },

    async executePrefix(message, args) {
        if (args.length < 2) return message.reply('❌ **Usage:** `!unban <user> <reason>`');
        await this.executeUnban(message, { user: args[0], reason: args.slice(1).join(' ') });
    },

    async executeUnban(context, options) {
        const guild = context.guild;
        // Normalise moderator whether this is a slash interaction or a prefix message
        const moderator     = context.member || context.author;
        const moderatorUser = moderator.user ?? moderator;
        const isInteraction = context.replied !== undefined;

        try {
            const bans = await guild.bans.fetch();
            let targetUser = null;

            if (/^\d{17,19}$/.test(options.user)) {
                targetUser = bans.get(options.user)?.user;
            } else {
                targetUser = bans.find(ban =>
                    ban.user.username.toLowerCase() === options.user.toLowerCase() ||
                    ban.user.tag.toLowerCase()      === options.user.toLowerCase()
                )?.user;
            }

            if (!targetUser) {
                const reply = '❌ User not found in ban list.';
                return isInteraction
                    ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                    : context.reply(reply);
            }

            await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderatorUser.tag}`);

            const caseId = generateCaseId('unban');

            await sendDM(targetUser, {
                type: 'unban', guild: guild.name, reason: options.reason,
                moderatorTag: moderatorUser.tag, moderatorId: moderatorUser.id, caseId
            });

            await logModeration(guild, {
                type: 'unban', caseId,
                target:    targetUser,
                moderator: moderatorUser,
                reason:    options.reason
            });

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔓 User Unbanned')
                .addFields(
                    { name: 'Case ID',   value: caseId,                                        inline: true  },
                    { name: 'User',      value: `${targetUser.tag} (${targetUser.id})`,        inline: true  },
                    { name: 'Moderator', value: `${moderatorUser.tag} (${moderatorUser.id})`,  inline: true  },
                    { name: 'Reason',    value: options.reason,                                inline: false }
                )
                .setTimestamp()
                .setFooter({ text: `Moderator: ${moderatorUser.tag}`, iconURL: moderatorUser.displayAvatarURL() });

            const reply = { embeds: [embed] };
            return isInteraction ? context.reply(reply) : context.reply(reply);
        } catch (error) {
            console.error('Failed to unban user:', error);
            const reply = `❌ Failed to unban user: ${error.message}`;
            return isInteraction
                ? context.reply({ content: reply, flags: MessageFlags.Ephemeral })
                : context.reply(reply);
        }
    }
};