// handlers/messageHandler.js
const { Events } = require('discord.js');
const CONFIG = require('../config/config');
const { validateConfig } = require('../utils/validation');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const TICKET_TYPES = require('../data/ticketTypes');

function setupMessageHandler(client) {
    client.on(Events.MessageCreate, async message => {
        if (message.author.bot) return;
        if (!message.guild) return; // guild-only; DMs are enabled for other features

        if (message.content === '!setup-tickets') {
            try {
                const embed = new EmbedBuilder()
                    .setTitle('🎫 Create a Support Ticket')
                    .setDescription('Select the type of ticket you\'d like to create from the dropdown below.')
                    .setColor(0x5865F2)
                    .setFooter({ text: 'Please select the appropriate category for your inquiry.' });

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_select')
                    .setPlaceholder('Choose a ticket type...')
                    .addOptions(
                        Object.entries(TICKET_TYPES).map(([key, type]) =>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(type.name)
                                .setDescription(type.description)
                                .setValue(key)
                                .setEmoji(type.emoji)
                        )
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);

                await message.channel.send({
                    embeds: [embed],
                    components: [row]
                });

                await message.delete().catch(() => { });
            } catch (error) {
                console.error('Error setting up ticket system:', error);
                await message.reply('❌ Failed to setup ticket system. Please check bot permissions.');
            }
        }
    });

    client.once(Events.ClientReady, readyClient => {
        console.log(`Ready! Logged in as ${readyClient.user.tag}`);

        const configErrors = validateConfig(CONFIG);
        if (configErrors.length > 0) {
            console.error('Configuration errors:', configErrors);
            process.exit(1);
        } else {
            console.log('✅ Configuration validated successfully!');
        }
    });
}

module.exports = { setupMessageHandler };