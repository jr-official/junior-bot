// features/moderation/handlers/prefixCommandHandler.js
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    async handle(message, command, args) {
        // Check if user has permission to use moderation commands
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply('❌ You do not have permission to use moderation commands.');
        }

        // Check if bot has permission
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            return message.reply('❌ I do not have permission to ban members in this server.');
        }

        // Execute the command
        await command.executePrefix(message, args);
    }
};