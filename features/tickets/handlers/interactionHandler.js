// features/tickets/handlers/interactionHandler.js
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
            // FIX: use a shared flag instead of relying on interaction.replied/deferred
            // to coordinate between the timeout and the handler. The old approach had a
            // race where both could try to defer simultaneously if the handler awaited
            // just as the 2500ms timeout fired, causing "interaction already acknowledged".
            let handlerStarted = false;

            const timeout = setTimeout(async () => {
                // Only auto-defer if the handler hasn't already started its own defer
                if (handlerStarted) return;
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        if (interaction.isButton()) {
                            await interaction.deferUpdate();
                        } else {
                            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        }
                    } catch {
                        // Ignore — interaction may have expired or been handled already
                    }
                }
            }, 2500);

            let handled = false;

            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
                handlerStarted = true;
                handled = await ticketCreationHandler.handleTicketCreation(
                    interaction,
                    helpers,
                    services,
                    CONFIG,
                    TICKET_TYPES,
                    timeout
                );
            }

            if (interaction.isButton() && !handled) {
                handlerStarted = true;
                handled = await ticketControlHandler.handleButtonInteraction(
                    interaction,
                    helpers,
                    services,
                    CONFIG,
                    timeout
                );
            }

            if (!handled) {
                clearTimeout(timeout);
            }

        } catch (error) {
            console.error('Interaction error:', error);

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
                console.error('Failed to send error response:', responseError);
            }
        }
    });
}

module.exports = { setupInteractionHandler };