const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { validatePermissions, sendDM, logModeration } = require('../utils/moderationUtils');

module.exports = {
    data: new SlashCommandBuilder()
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

    async execute(interaction) {
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
        const isInteraction = context.isCommand?.() || context.replied !== undefined;

        const permissionCheck = await validatePermissions(moderator, 'BanMembers');
        if (!permissionCheck.success) {
            const reply = `❌ ${permissionCheck.message}`;
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }

        try {
            const bans = await guild.bans.fetch();
            let targetUser = null;

            if (/^\d{17,19}$/.test(options.user)) {
                const banInfo = bans.get(options.user);
                targetUser = banInfo?.user;
            } else {
                const banInfo = bans.find(ban =>
                    ban.user.username.toLowerCase() === options.user.toLowerCase() ||
                    ban.user.tag.toLowerCase() === options.user.toLowerCase()
                );
                targetUser = banInfo?.user;
            }

            if (!targetUser) {
                const reply = `❌ User not found in ban list.`;
                return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
            }

            await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderator.user.tag}`);

            await sendDM(targetUser, {
                type: 'unban',
                guild: guild.name,
                reason: options.reason,
                moderator: moderator.user.tag
            });

            await logModeration(guild, {
                type: 'unban',
                target: targetUser,
                moderator: moderator.user,
                reason: options.reason
            });

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
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }
    }
};
