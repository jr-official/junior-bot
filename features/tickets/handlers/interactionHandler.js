// handlers/interactionHandler.js
const { Events, MessageFlags } = require('discord.js');
const CONFIG = require('../config/config');
const TicketService = require('../services/ticketService');
const TranscriptService = require('../services/transcriptService');
const CacheService = require('../services/cacheService');
const TICKET_TYPES = require('../data/ticketTypes');
const ticketCreationHandler = require('./ticketCreationHandler');
const ticketControlHandler = require('./ticketControlHandler');

function setupInteractionHandler(client) {
    const ticketService = new TicketService();
    const transcriptService = new TranscriptService(TICKET_TYPES);
    const cacheService = new CacheService();

    // Helper function to safely handle interactions
    async function safeInteractionResponse(interaction, responseFunction) {
        try {
            if (!interaction.isRepliable()) {
                console.log('Interaction is no longer repliable');
                return false;
            }

            if (interaction.replied || interaction.deferred) {
                console.log('Interaction already handled');
                return false;
            }

            await responseFunction();
            return true;
        } catch (error) {
            if (error.code === 10062) {
                console.log('Interaction expired, cannot respond');
                return false;
            }
            throw error;
        }
    }

    // Helper function to safely defer interactions
    async function safeDeferInteraction(interaction, isUpdate = false) {
        try {
            if (interaction.replied || interaction.deferred) {
                return true;
            }

            if (isUpdate) {
                await interaction.deferUpdate();
            } else {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            }
            return true;
        } catch (error) {
            if (error.code === 10062) {
                console.log('Interaction expired before deferral');
                return false;
            }
            throw error;
        }
    }

    // Helper function to safely reply to interactions
    async function safeReply(interaction, options) {
        try {
            if (interaction.deferred) {
                return await interaction.editReply(options);
            } else if (!interaction.replied) {
                return await interaction.reply(options);
            } else {
                return await interaction.followUp(options);
            }
        } catch (error) {
            if (error.code === 10062) {
                console.log('Interaction expired, cannot respond');
                return null;
            }
            throw error;
        }
    }

    const helpers = { safeInteractionResponse, safeDeferInteraction, safeReply };
    const services = { ticketService, transcriptService, cacheService };

    client.on(Events.InteractionCreate, async interaction => {
        try {
            // Set up timeout to ensure we respond within 3 seconds
            const timeout = setTimeout(async () => {
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        if (interaction.isButton()) {
                            await interaction.deferUpdate();
                        } else {
                            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        }
                    } catch (error) {
                        // Ignore timeout errors
                    }
                }
            }, 2500);

            let handled = false;

            // Handle ticket creation (select menu)
            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
                handled = await ticketCreationHandler.handleTicketCreation(
                    interaction, 
                    helpers, 
                    services, 
                    CONFIG, 
                    TICKET_TYPES,
                    timeout
                );
            }

            // Handle button interactions
            if (interaction.isButton() && !handled) {
                handled = await ticketControlHandler.handleButtonInteraction(
                    interaction,
                    helpers,
                    services,
                    CONFIG,
                    timeout
                );
            }

            // Clear timeout if we reach the end without issues
            if (!handled) {
                clearTimeout(timeout);
            }

        } catch (error) {
            console.error('Interaction error:', error);
            
            // Try to respond with error message if we haven't responded yet
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred while processing your request.',
                        flags: MessageFlags.Ephemeral
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ An error occurred while processing your request.'
                    });
                }
            } catch (responseError) {
                // If we can't respond, just log it
                console.error('Failed to send error response:', responseError);
            }
        }
    });
}

module.exports = { setupInteractionHandler };