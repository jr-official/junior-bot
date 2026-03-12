// features/tickets/handlers/ticketCreationHandler.js
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

async function handleTicketCreation(interaction, helpers, services, CONFIG, TICKET_TYPES, timeout) {
    const { safeReply, safeDeferInteraction } = helpers;
    const { ticketService, cacheService } = services;

    const success = await safeDeferInteraction(interaction);
    if (!success) {
        clearTimeout(timeout);
        return true;
    }

    const ticketType   = interaction.values[0];
    const ticketConfig = TICKET_TYPES[ticketType];

    if (!ticketConfig) {
        clearTimeout(timeout);
        await safeReply(interaction, { content: '❌ Invalid ticket type selected.' });
        return true;
    }

    if (ticketService.isUserOnCooldown(interaction.user.id, CONFIG.TICKET_CREATE_COOLDOWN)) {
        clearTimeout(timeout);
        await safeReply(interaction, { content: '⏰ Please wait before creating another ticket.' });
        return true;
    }

    // canUserCreateTicket is now async (queries the DB) so we must await it
    const canCreate = await ticketService.canUserCreateTicket(interaction.user.id, CONFIG.MAX_TICKETS_PER_USER);
    if (!canCreate) {
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: `❌ You already have the maximum number of tickets (${CONFIG.MAX_TICKETS_PER_USER}) open.`
        });
        return true;
    }

    try {
        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
        if (!staffRole) {
            clearTimeout(timeout);
            await safeReply(interaction, {
                content: '❌ Staff role not found. Please contact an administrator.'
            });
            return true;
        }

        const ticketChannel = await ticketService.createTicketChannel(
            interaction.guild,
            ticketType,
            interaction.user,
            CONFIG.TICKET_CATEGORY_ID,
            staffRole
        );

        ticketService.addTicketToTracking(interaction.user.id, ticketChannel.id);
        ticketService.setCooldown(interaction.user.id);

        const ticketEmbed = new EmbedBuilder()
            .setTitle(`${ticketConfig.emoji} ${ticketConfig.name} Ticket`)
            .setDescription(`Hello ${interaction.user}, thank you for creating a ticket!\n\n${ticketConfig.description}`)
            .setColor(ticketConfig.color)
            .setFooter({ text: 'A staff member will be with you shortly.' })
            .setTimestamp();

        const closeButton = new ButtonBuilder()
            .setCustomId('close_ticket')
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒');

        const row = new ActionRowBuilder().addComponents(closeButton);

        await ticketChannel.send({
            content:    `${interaction.user} | ${staffRole}`,
            embeds:     [ticketEmbed],
            components: [row]
        });

        clearTimeout(timeout);
        await safeReply(interaction, {
            content: `✅ Your ticket has been created: ${ticketChannel}`
        });

    } catch (error) {
        console.error('Error creating ticket:', error);
        clearTimeout(timeout);
        await safeReply(interaction, {
            content: '❌ Failed to create ticket. Please try again or contact an administrator.'
        });
    }

    return true;
}

module.exports = { handleTicketCreation };