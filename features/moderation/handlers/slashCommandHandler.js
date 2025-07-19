// features/moderation/handlers/slashCommandHandler.js
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    async handle(interaction, command) {
        // Check if user has permission to use moderation commands
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ 
                content: '❌ You do not have permission to use moderation commands.', 
                ephemeral: true
            });
        }

        // Check if bot has permission
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({ 
                content: '❌ I do not have permission to ban members in this server.', 
                ephemeral: true
            });
        }

        // Execute the command
        await command.executeSlash(interaction);
    }
};