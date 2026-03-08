// features/moderation/moderation.js
const { Collection, Events } = require('discord.js');
const slashCommandHandler = require('./handlers/slashCommandHandler');
const prefixCommandHandler = require('./handlers/prefixCommandHandler');
const banCommand    = require('./commands/ban');
const unbanCommand  = require('./commands/unban');
const kickCommand   = require('./commands/kick');
const muteCommand   = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const warnCommand   = require('./commands/warn');
const warnsCommand  = require('./commands/warns');
const { handleWarnsButton }      = require('./commands/warns');
const { handleWarnRemoveButton } = require('./commands/warn');
const warningService = require('./services/warningService');

const PREFIX = '!';

module.exports = (client) => {
    client.moderationCommands = new Collection();
    client.moderationCommands.set('ban',    banCommand);
    client.moderationCommands.set('unban',  unbanCommand);
    client.moderationCommands.set('kick',   kickCommand);
    client.moderationCommands.set('mute',   muteCommand);
    client.moderationCommands.set('unmute', unmuteCommand);
    client.moderationCommands.set('warn',   warnCommand);
    client.moderationCommands.set('warns',  warnsCommand);

    // Register slash commands globally on ready
    client.once(Events.ClientReady, async () => {
        try {
            console.log('🔨 Registering moderation slash commands globally...');

            const commands = [];
            for (const command of client.moderationCommands.values()) {
                if (command.slashCommand) commands.push(command.slashCommand.toJSON());
            }

            await client.application.commands.set(commands);
            console.log('✅ Moderation slash commands registered globally');
            console.log('📝 Note: Global commands may take up to 1 hour to appear in all servers');

            await warningService.ensureIndexes();
        } catch (error) {
            console.error('❌ Failed to register moderation slash commands:', error);
        }
    });

    // Handle all interactions
    client.on(Events.InteractionCreate, async (interaction) => {

        // ── Button interactions ──────────────────────────────────────────────
        if (interaction.isButton()) {
            const id = interaction.customId;

            // warn remove picker buttons
            if (id.startsWith('warnrm_')) {
                try {
                    await handleWarnRemoveButton(interaction, interaction.guild);
                } catch (error) {
                    console.error('❌ Error handling warn remove button:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
                    }
                }
                return;
            }

            // warns view pagination buttons
            if (id.startsWith('warns_lb_') || id.startsWith('warns_user_')) {
                try {
                    await handleWarnsButton(interaction);
                } catch (error) {
                    console.error('❌ Error handling warns button:', error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ An error occurred.', ephemeral: true });
                    }
                }
                return;
            }
        }

        // ── Slash commands ───────────────────────────────────────────────────
        if (!interaction.isChatInputCommand()) return;

        const command = client.moderationCommands.get(interaction.commandName);
        if (!command) return;

        try {
            await slashCommandHandler.handle(interaction, command);
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            const errorMessage = { content: '❌ An error occurred while executing this command.', ephemeral: true };
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