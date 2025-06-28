const { Events, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const CONFIG = require('../config/config');
const TicketService = require('../services/ticketService');
const TranscriptService = require('../services/transcriptService');
const CacheService = require('../services/cacheService');
const TICKET_TYPES = require('../data/ticketTypes');
const { cleanUsername } = require('../utils/cleanup');

function setupInteractionHandler(client) {
    const ticketService = new TicketService();
    const transcriptService = new TranscriptService(TICKET_TYPES);
    const cacheService = new CacheService();

    // Helper function to safely handle interactions
    async function safeInteractionResponse(interaction, responseFunction) {
        try {
            // Check if interaction is still valid
            if (!interaction.isRepliable()) {
                console.log('Interaction is no longer repliable');
                return false;
            }

            // Check if already handled
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

            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
                const success = await safeDeferInteraction(interaction);
                if (!success) {
                    clearTimeout(timeout);
                    return;
                }

                const ticketType = interaction.values[0];
                const ticketConfig = TICKET_TYPES[ticketType];

                if (!ticketConfig) {
                    clearTimeout(timeout);
                    return await safeReply(interaction, {
                        content: '❌ Invalid ticket type selected.'
                    });
                }

                if (ticketService.isUserOnCooldown(interaction.user.id, CONFIG.TICKET_CREATE_COOLDOWN)) {
                    clearTimeout(timeout);
                    return await safeReply(interaction, {
                        content: '⏰ Please wait before creating another ticket.'
                    });
                }

                if (!ticketService.canUserCreateTicket(interaction.user.id, CONFIG.MAX_TICKETS_PER_USER)) {
                    clearTimeout(timeout);
                    return await safeReply(interaction, {
                        content: `❌ You already have the maximum number of tickets (${CONFIG.MAX_TICKETS_PER_USER}) open.`
                    });
                }

                try {
                    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                    if (!staffRole) {
                        clearTimeout(timeout);
                        return await safeReply(interaction, {
                            content: '❌ Staff role not found. Please contact an administrator.'
                        });
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
                        content: `${interaction.user} | ${staffRole}`,
                        embeds: [ticketEmbed],
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
            }

            if (interaction.isButton()) {
                switch (interaction.customId) {
                    case 'close_ticket': {
                        const success = await safeDeferInteraction(interaction, true);
                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        const channelPermissions = interaction.channel.permissionOverwrites.cache;
                        let ticketUserId = null;

                        for (const [id, overwrite] of channelPermissions) {
                            if (overwrite.type === 1 && id !== interaction.guild.id) {
                                const member = interaction.guild.members.cache.get(id);
                                if (member && !member.roles.cache.some(role => role.name === CONFIG.STAFF_ROLE_NAME)) {
                                    ticketUserId = id;
                                    break;
                                }
                            }
                        }

                        const isTicketCreator = ticketUserId === interaction.user.id;

                        if (!isStaff && !isTicketCreator) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ You can only close your own tickets or you need to be a staff member.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        // Store the initiator of the close action
                        ticketService.ticketMetadata.set(interaction.channel.id, {
                            closeInitiator: interaction.user.id,
                            ticketCreatorId: ticketUserId
                        });

                        const confirmEmbed = new EmbedBuilder()
                            .setTitle('🔒 Close Ticket')
                            .setDescription('Are you sure you want to close this ticket?')
                            .setColor(0xED4245);

                        const confirmButton = new ButtonBuilder()
                            .setCustomId('confirm_close_ticket')
                            .setLabel('Yes, Close')
                            .setStyle(ButtonStyle.Danger);

                        const cancelButton = new ButtonBuilder()
                            .setCustomId('cancel_close_ticket')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary);

                        const confirmRow = new ActionRowBuilder()
                            .addComponents(confirmButton, cancelButton);

                        // Send as regular message in channel
                        const confirmationMessage = await interaction.channel.send({
                            embeds: [confirmEmbed],
                            components: [confirmRow]
                        });

                        // Store the confirmation message ID
                        ticketService.ticketMetadata.set(interaction.channel.id, {
                            ...ticketService.ticketMetadata.get(interaction.channel.id),
                            confirmationMessageId: confirmationMessage.id
                        });

                        clearTimeout(timeout);
                        break;
                    }

                    case 'confirm_close_ticket': {
                        const success = await safeDeferInteraction(interaction, true);
                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        const metadata = ticketService.ticketMetadata.get(interaction.channel.id);
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        // Verify this is the original user who initiated the close or a staff member
                        if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ Only the user who initiated this action can confirm it.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        const timer = ticketService.ticketCleanupTimers.get(interaction.channel.id);
                        if (timer) {
                            clearTimeout(timer);
                            ticketService.ticketCleanupTimers.delete(interaction.channel.id);
                        }

                        // Remove creator's permissions only after confirmation
                        if (metadata?.ticketCreatorId) {
                            await interaction.channel.permissionOverwrites.edit(metadata.ticketCreatorId, {
                                ViewChannel: false,
                                SendMessages: false,
                                AddReactions: false
                            }).catch(console.error);
                        }

                        const ticketClosedEmbed = new EmbedBuilder()
                            .setTitle(`Ticket Closed by @${interaction.user.username}`)
                            .setColor(0x2F3136)
                            .setTimestamp();

                        const transcriptButton = new ButtonBuilder()
                            .setCustomId('transcript_ticket')
                            .setLabel('Transcript')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('📄');

                        const openButton = new ButtonBuilder()
                            .setCustomId('open_ticket')
                            .setLabel('Open')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔓');

                        const deleteButton = new ButtonBuilder()
                            .setCustomId('delete_ticket')
                            .setLabel('Delete')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🗑️');

                        const controlsRow = new ActionRowBuilder()
                            .addComponents(transcriptButton, openButton, deleteButton);

                        // Send as regular message in channel
                        await interaction.channel.send({
                            content: 'Support team ticket controls',
                            embeds: [ticketClosedEmbed],
                            components: [controlsRow]
                        });

                        // Delete the confirmation message
                        if (metadata?.confirmationMessageId) {
                            const confirmationMessage = await interaction.channel.messages.fetch(metadata.confirmationMessageId).catch(() => null);
                            if (confirmationMessage) {
                                await confirmationMessage.delete().catch(console.error);
                            }
                        }

                        clearTimeout(timeout);
                        break;
                    }

                    case 'cancel_close_ticket': {
                        const success = await safeDeferInteraction(interaction, true);
                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        const metadata = ticketService.ticketMetadata.get(interaction.channel.id);
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        // Verify this is the original user who initiated the close or a staff member
                        if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ Only the user who initiated this action can cancel it.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        if (metadata?.confirmationMessageId) {
                            const confirmationMessage = await interaction.channel.messages.fetch(metadata.confirmationMessageId).catch(() => null);
                            if (confirmationMessage) {
                                await confirmationMessage.delete().catch(console.error);
                            }
                        }
                        await interaction.channel.send({
                            content: '✅ Ticket closure cancelled.'
                        });

                        clearTimeout(timeout);
                        break;
                    }

                    case 'delete_ticket': {
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ Only staff members can delete tickets.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        const success = await safeInteractionResponse(interaction, async () => {
                            await interaction.reply({
                                content: `🗑️ Deleting ticket in ${CONFIG.DELETION_DELAY_SECONDS} seconds...`
                            });
                        });

                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        setTimeout(async () => {
                            try {
                                const channelPermissions = interaction.channel.permissionOverwrites.cache;
                                let ticketUserId = null;

                                for (const [id, overwrite] of channelPermissions) {
                                    if (overwrite.type === 1 && id !== interaction.guild.id) {
                                        const member = interaction.guild.members.cache.get(id);
                                        if (member && !member.roles.cache.some(role => role.name === CONFIG.STAFF_ROLE_NAME)) {
                                            ticketUserId = id;
                                            break;
                                        }
                                    }
                                }

                                if (ticketUserId) {
                                    ticketService.removeTicketFromTracking(ticketUserId, interaction.channel.id);
                                }

                                await interaction.channel.delete();
                            } catch (error) {
                                console.error('Error deleting ticket channel:', error);
                            }
                        }, CONFIG.DELETION_DELAY_SECONDS * 1000);

                        clearTimeout(timeout);
                        break;
                    }

                    case 'open_ticket': {
                        const success = await safeDeferInteraction(interaction, true);
                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ Only staff members can reopen tickets.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        const channelPermissions = interaction.channel.permissionOverwrites.cache;
                        let ticketUserId = null;

                        for (const [id, overwrite] of channelPermissions) {
                            if (overwrite.type === 1 && id !== interaction.guild.id) {
                                const member = interaction.guild.members.cache.get(id);
                                if (member && !member.roles.cache.some(role => role.name === CONFIG.STAFF_ROLE_NAME)) {
                                    ticketUserId = id;
                                    // Restore creator's permissions
                                    await interaction.channel.permissionOverwrites.edit(id, {
                                        ViewChannel: true,
                                        SendMessages: true,
                                        AddReactions: true
                                    }).catch(console.error);
                                    break;
                                }
                            }
                        }

                        const reopenEmbed = new EmbedBuilder()
                            .setTitle('🔓 Ticket Reopened')
                            .setDescription(`This ticket has been reopened by ${interaction.user}`)
                            .setColor(0x57F287)
                            .setTimestamp();

                        const closeButton = new ButtonBuilder()
                            .setCustomId('close_ticket')
                            .setLabel('Close Ticket')
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji('🔒');

                        const closeRow = new ActionRowBuilder()
                            .addComponents(closeButton);

                        // Send as regular message in channel
                        await interaction.channel.send({
                            embeds: [reopenEmbed],
                            components: [closeRow]
                        });

                        clearTimeout(timeout);
                        break;
                    }

                    case 'transcript_ticket': {
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            clearTimeout(timeout);
                            return await safeReply(interaction, {
                                content: '❌ Only staff members can generate transcripts.',
                                flags: MessageFlags.Ephemeral
                            });
                        }

                        const success = await safeInteractionResponse(interaction, async () => {
                            await interaction.reply({
                                content: '📄 Generating transcript... Please wait.',
                                flags: MessageFlags.Ephemeral
                            });
                        });

                        if (!success) {
                            clearTimeout(timeout);
                            return;
                        }

                        try {
                            const channelPermissions = interaction.channel.permissionOverwrites.cache;
                            let ticketUserId = null;
                            let ticketCreator;

                            for (const [id, overwrite] of channelPermissions) {
                                if (overwrite.type === 1 && id !== interaction.guild.id) {
                                    const member = interaction.guild.members.cache.get(id);
                                    if (member && !member.roles.cache.some(role => role.name === CONFIG.STAFF_ROLE_NAME)) {
                                        ticketUserId = id;
                                        try {
                                            ticketCreator = await interaction.guild.members.fetch(id);
                                            ticketCreator = ticketCreator.user;
                                        } catch (error) {
                                            console.error('Error fetching ticket creator:', error);
                                            ticketCreator = { username: 'Unknown', discriminator: '0000' };
                                        }
                                        break;
                                    }
                                }
                            }

                            if (!ticketCreator) {
                                const channelName = interaction.channel.name;
                                const usernameFromChannel = channelName.split('-').slice(1).join('-');
                                const member = interaction.guild.members.cache.find(m =>
                                    cleanUsername(m.user.username, m.user.id) === usernameFromChannel
                                );
                                ticketCreator = member ? member.user : { username: 'Unknown', discriminator: '0000' };
                            }

                            const transcriptData = await transcriptService.generateTranscript(
                                interaction.channel,
                                ticketCreator
                            );

                            if (!transcriptData) {
                                clearTimeout(timeout);
                                return await safeReply(interaction, {
                                    content: '❌ Failed to generate transcript. Please try again.'
                                });
                            }

                            const logsChannel = interaction.guild.channels.cache.get(CONFIG.TICKET_LOGS_CHANNEL_ID);
                            if (logsChannel && transcriptData) {
                                const transcriptEmbed = new EmbedBuilder()
                                    .setTitle('📄 Ticket Transcript Saved')
                                    .setColor(0x7289da)
                                    .addFields(
                                        { name: 'Ticket Owner', value: `${ticketCreator.username}#${ticketCreator.discriminator}`, inline: true },
                                        { name: 'Ticket Name', value: interaction.channel.name, inline: true },
                                        { name: 'Panel Name', value: transcriptData.ticketType, inline: true },
                                        { name: 'Total Messages', value: transcriptData.totalMessages.toString(), inline: true },
                                        { name: 'Closed By', value: interaction.user.toString(), inline: true },
                                        { name: 'Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                                    );

                                await logsChannel.send({
                                    content: `Transcript for ${interaction.channel.name}`,
                                    embeds: [transcriptEmbed],
                                    files: [{
                                        attachment: Buffer.from(transcriptData.html, 'utf8'),
                                        name: `transcript-${interaction.channel.name}.html`
                                    }]
                                });
                            }

                            clearTimeout(timeout);
                            await safeReply(interaction, {
                                content: '✅ Transcript generated and sent to the logs channel.'
                            });

                        } catch (error) {
                            console.error('Error generating transcript:', error);
                            clearTimeout(timeout);
                            await safeReply(interaction, {
                                content: '❌ An error occurred while generating the transcript.'
                            });
                        }
                        break;
                    }
                    default:
                        clearTimeout(timeout);
                        break;
                }
            }

            // Clear timeout if we reach the end without issues
            clearTimeout(timeout);

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