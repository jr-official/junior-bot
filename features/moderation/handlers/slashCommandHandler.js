// features/moderation/handlers/slashCommandHandler.js
const { PermissionFlagsBits } = require('discord.js');

// Map command names to the Discord permission required
const COMMAND_PERMISSIONS = {
    ban:    { flag: PermissionFlagsBits.BanMembers,       label: 'ban members' },
    unban:  { flag: PermissionFlagsBits.BanMembers,       label: 'ban members' },
    kick:   { flag: PermissionFlagsBits.KickMembers,      label: 'kick members' },
    mute:   { flag: PermissionFlagsBits.ModerateMembers,  label: 'moderate members (timeout)' },
    unmute: { flag: PermissionFlagsBits.ModerateMembers,  label: 'moderate members (timeout)' }
};

module.exports = {
    async handle(interaction, command) {
        const perm = COMMAND_PERMISSIONS[command.name];

        if (!perm) {
            return interaction.reply({
                content: '❌ Unknown command permission configuration.',
                ephemeral: true
            });
        }

        // Check if the user has the required permission
        if (!interaction.member.permissions.has(perm.flag)) {
            return interaction.reply({
                content: `❌ You do not have permission to ${perm.label}.`,
                ephemeral: true
            });
        }

        // Check if the bot has the required permission
        if (!interaction.guild.members.me.permissions.has(perm.flag)) {
            return interaction.reply({
                content: `❌ I do not have permission to ${perm.label} in this server.`,
                ephemeral: true
            });
        }

        await command.executeSlash(interaction);
    }
};