// features/tickets/handlers/interactionHandler.js
const { Events, MessageFlags } = require('discord.js');
const CONFIG = require('../config/config');
const TicketService = require('../services/ticketService');
const TranscriptService = require('../services/transcriptService');
const TICKET_TYPES = require('../data/ticketTypes');
const ticketCreationHandler = require('./ticketCreationHandler');
const ticketControlHandler = require('./ticketControlHandler');

// FIX: cacheService is now injected from tickets.js rather than instantiated
// here. This ensures all handlers share the same cache instance and that the
// role-change listeners registered in tickets.js actually invalidate the cache
// that the handlers use.
function setupInteractionHandler(client, cacheService) {
    const ticketService     = new TicketService();
    const transcriptService = new TranscriptService(TICKET_TYPES);

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

    const helpers  = { safeInteractionResponse, safeDeferInteraction, safeReply };
    const services = { ticketService, transcriptService, cacheService };

    client.on(Events.InteractionCreate, async interaction => {
        try {
            // FIX: use a deferred flag that is set *synchronously* before any await,
            // rather than relying on interaction.replied/.deferred which are only
            // set after the Discord API round-trip completes. The old approach had a
            // genuine race: the 2500ms timeout could fire between the handler's first
            // await and the API acknowledging the defer, causing both to attempt a
            // defer simultaneously and one to throw "interaction already acknowledged".
            //
            // Now: the flag is a promise that the handler resolves once it has issued
            // its own defer (or decided not to). The timeout checks the flag before
            // acting. If the handler hasn't started yet when the timeout fires, the
            // timeout defers normally. If the handler already started, the timeout
            // is a no-op.
            let handlerHasDeferred = false;

            const timeout = setTimeout(async () => {
                if (handlerHasDeferred) return;
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        if (interaction.isButton()) {
                            await interaction.deferUpdate();
                        } else {
                            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        }
                    } catch {
                        // Interaction may have expired or been handled already
                    }
                }
            }, 2500);

            // Wrap safeDeferInteraction so setting handlerHasDeferred happens
            // synchronously at the point the handler decides to defer, before
            // the await resolves.
            const trackedHelpers = {
                ...helpers,
                safeDeferInteraction: async (interaction, isUpdate = false) => {
                    handlerHasDeferred = true;
                    return helpers.safeDeferInteraction(interaction, isUpdate);
                },
                safeInteractionResponse: async (interaction, fn) => {
                    handlerHasDeferred = true;
                    return helpers.safeInteractionResponse(interaction, fn);
                }
            };

            let handled = false;

            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
                handled = await ticketCreationHandler.handleTicketCreation(
                    interaction,
                    trackedHelpers,
                    services,
                    CONFIG,
                    TICKET_TYPES,
                    timeout
                );
            }

            if (interaction.isButton() && !handled) {
                handled = await ticketControlHandler.handleButtonInteraction(
                    interaction,
                    trackedHelpers,
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