// features/moderation/moderation.js
const { Collection, Events } = require('discord.js');
const slashCommandHandler = require('./handlers/slashCommandHandler');
const prefixCommandHandler = require('./handlers/prefixCommandHandler');
const banCommand = require('./commands/ban');
const unbanCommand = require('./commands/unban');

const PREFIX = '!';

module.exports = (client) => {
    // Store commands
    client.moderationCommands = new Collection();
    client.moderationCommands.set('ban', banCommand);
    client.moderationCommands.set('unban', unbanCommand);

    // Register slash commands
    client.on(Events.ClientReady, async () => {
        const commands = [];
        
        // Add commands with proper validation - handles both 'slashCommand' and 'data' properties
        if (banCommand.slashCommand) {
            commands.push(banCommand.slashCommand.toJSON());
        }
        
        // Fixed: Check for both 'slashCommand' and 'data' properties
        if (unbanCommand.slashCommand) {
            commands.push(unbanCommand.slashCommand.toJSON());
        } else if (unbanCommand.data) {
            commands.push(unbanCommand.data.toJSON());
        }

        try {
            console.log('🔨 Registering moderation slash commands...');
            console.log(`📋 Commands to register: ${commands.map(cmd => cmd.name).join(', ')}`);
            
            await client.application.commands.set(commands);
            console.log('✅ Moderation slash commands registered successfully');
        } catch (error) {
            console.error('❌ Failed to register moderation slash commands:', error);
        }
    });

    // Handle slash command interactions
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.moderationCommands.get(interaction.commandName);
        if (!command) return;

        try {
            await slashCommandHandler.handle(interaction, command);
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            
const errorMessage = { 
    content: '❌ An error occurred while executing this command.', 
    flags: ['Ephemeral']
};
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    });

    // Handle prefix commands
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = client.moderationCommands.get(commandName);
        if (!command) return;

        try {
            await prefixCommandHandler.handle(message, command, args);
        } catch (error) {
            console.error('❌ Error handling prefix command:', error);
            await message.reply('❌ An error occurred while executing this command.');
        }
    });

    console.log('🔨 Moderation system initialized');
};