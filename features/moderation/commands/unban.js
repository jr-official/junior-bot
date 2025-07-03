const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { MessageFlags } = require('discord-api-types/v10');
const { validatePermissions, sendDM, logModeration } = require('../utils/moderationUtils');

module.exports = {
    name: 'unban',
    description: 'Unban a user from the server',

    // Changed from 'data' to 'slashCommand' to match your ban.js structure
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

    // Changed from 'execute' to 'executeSlash' to match your structure
    async executeSlash(interaction) {
        const options = {
            user: interaction.options.getString('user'),
            reason: interaction.options.getString('reason')
        };

        await this.executeUnban(interaction, options);
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply('❌ **Usage:** `!unban <user> <reason>`');
        }

        const options = {
            user: args[0],
            reason: args.slice(1).join(' ')
        };

        await this.executeUnban(message, options);
    },

    async executeUnban(context, options) {
        const guild = context.guild;
        const moderator = context.member;
        const isInteraction = context.replied !== undefined;

        // Fixed permission check to match your handlers (BAN_MEMBERS instead of BanMembers)
        const permissionCheck = await validatePermissions(moderator, 'BAN_MEMBERS');
        if (!permissionCheck.success) {
            const reply = `❌ ${permissionCheck.message}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }

        try {
            const bans = await guild.bans.fetch();
            let targetUser = null;

            // Check if input is a user ID (17-19 digits)
            if (/^\d{17,19}$/.test(options.user)) {
                const banInfo = bans.get(options.user);
                targetUser = banInfo?.user;
            } else {
                // Search by username or tag
                const banInfo = bans.find(ban =>
                    ban.user.username.toLowerCase() === options.user.toLowerCase() ||
                    ban.user.tag.toLowerCase() === options.user.toLowerCase()
                );
                targetUser = banInfo?.user;
            }

            if (!targetUser) {
                const reply = `❌ User not found in ban list.`;
                const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
                return isInteraction ? context.reply(replyObj) : context.reply(reply);
            }

            // Unban the user
            await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderator.user.tag}`);

            // Send DM to user
            await sendDM(targetUser, {
                type: 'unban',
                guild: guild.name,
                reason: options.reason,
                moderator: moderator.user.tag
            });

            // Log the moderation action
            await logModeration(guild, {
                type: 'unban',
                target: targetUser,
                moderator: moderator.user,
                reason: options.reason
            });

            // Create success embed
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔓 User Unbanned')
                .addFields(
                    { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: 'Moderator', value: `${moderator.user.tag}`, inline: true },
                    { name: 'Reason', value: options.reason, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

            const reply = { embeds: [embed] };
            return isInteraction ? context.reply(reply) : context.reply(reply);

        } catch (error) {
            console.error('Failed to unban user:', error);
            const reply = `❌ Failed to unban user: ${error.message}`;
            const replyObj = { content: reply, flags: MessageFlags.Ephemeral };
            return isInteraction ? context.reply(replyObj) : context.reply(reply);
        }
    }
};