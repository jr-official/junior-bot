// features/moderation/handlers/slashCommandHandler.js
module.exports = {
    async handle(interaction, command) {
// Check if user has permission to use moderation commands
if (!interaction.member.permissions.has('BAN_MEMBERS')) {
    return interaction.reply({ 
        content: '❌ You do not have permission to use moderation commands.', 
        flags: ['Ephemeral']
    });
}

// Check if bot has permission
if (!interaction.guild.members.me.permissions.has('BAN_MEMBERS')) {
    return interaction.reply({ 
        content: '❌ I do not have permission to ban members in this server.', 
        flags: ['Ephemeral']
    });
}

        // Execute the command
        await command.executeSlash(interaction);
    }
};