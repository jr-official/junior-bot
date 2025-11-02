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

    // Register slash commands GLOBALLY
    // Use 'once' instead of 'on' to prevent duplicate registrations
    client.once(Events.ClientReady, async () => {
        try {
            console.log('🔨 Registering moderation slash commands globally...');
            
            // Create an array of commands to register
            const commands = [];
            
            if (banCommand.slashCommand) {
                commands.push(banCommand.slashCommand.toJSON());
            }
            
            if (unbanCommand.slashCommand) {
                commands.push(unbanCommand.slashCommand.toJSON());
            }

            // Register commands globally
            await client.application.commands.set(commands);
            console.log('✅ Moderation slash commands registered globally');
            console.log('📝 Note: Global commands may take up to 1 hour to appear in all servers');
            
            // Optional: Uncomment below to clear guild-specific commands (one-time cleanup)
            /*
            console.log('🧹 Cleaning up guild-specific commands...');
            const guilds = client.guilds.cache;
            let cleared = 0;
            for (const [guildId, guild] of guilds) {
                try {
                    await guild.commands.set([]);
                    cleared++;
                } catch (error) {
                    console.error(`Failed to clear commands for guild ${guild.name}:`, error.message);
                }
            }
            console.log(`✅ Cleared commands from ${cleared} guilds`);
            */
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
                ephemeral: true
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