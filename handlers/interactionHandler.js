// handlers/interactionHandler.js
const { Events, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config/config');
const TicketService = require('../services/ticketService');
const TranscriptService = require('../services/transcriptService');
const CacheService = require('../services/cacheService');
const TICKET_TYPES = require('../data/ticketTypes');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { cleanUsername } = require('../utils/cleanup');

function setupInteractionHandler(client) {
    const ticketService = new TicketService();
    const transcriptService = new TranscriptService(TICKET_TYPES);
    const cacheService = new CacheService();

    client.on(Events.InteractionCreate, async interaction => {
        try {
            if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
                const ticketType = interaction.values[0];
                const ticketConfig = TICKET_TYPES[ticketType];

                if (!ticketConfig) {
                    return await interaction.reply({
                        content: '❌ Invalid ticket type selected.',
                        ephemeral: true
                    });
                }

                if (ticketService.isUserOnCooldown(interaction.user.id, CONFIG.TICKET_CREATE_COOLDOWN)) {
                    return await interaction.reply({
                        content: '⏰ Please wait before creating another ticket.',
                        ephemeral: true
                    });
                }

                if (!ticketService.canUserCreateTicket(interaction.user.id, CONFIG.MAX_TICKETS_PER_USER)) {
                    return await interaction.reply({
                        content: `❌ You already have the maximum number of tickets (${CONFIG.MAX_TICKETS_PER_USER}) open.`,
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                try {
                    const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                    if (!staffRole) {
                        return await interaction.editReply({
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

                    await interaction.editReply({
                        content: `✅ Your ticket has been created: ${ticketChannel}`
                    });

                } catch (error) {
                    console.error('Error creating ticket:', error);
                    await interaction.editReply({
                        content: '❌ Failed to create ticket. Please try again or contact an administrator.'
                    });
                }
            }

            if (interaction.isButton()) {
                switch (interaction.customId) {
                    case 'close_ticket': {
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
                            return interaction.reply({
                                content: '❌ You can only close your own tickets or you need to be a staff member.',
                                ephemeral: true
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

                        await interaction.deferUpdate();
                        break;
                    }

                    case 'confirm_close_ticket': {
                        const metadata = ticketService.ticketMetadata.get(interaction.channel.id);
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        // Verify this is the original user who initiated the close or a staff member
                        if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
                            return interaction.reply({
                                content: '❌ Only the user who initiated this action can confirm it.',
                                ephemeral: true
                            });
                        }

                        await interaction.deferUpdate();

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
                        break;
                    }

                    case 'cancel_close_ticket': {
                        const metadata = ticketService.ticketMetadata.get(interaction.channel.id);
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        // Verify this is the original user who initiated the close or a staff member
                        if (!isStaff && (!metadata || metadata.closeInitiator !== interaction.user.id)) {
                            return interaction.reply({
                                content: '❌ Only the user who initiated this action can cancel it.',
                                ephemeral: true
                            });
                        }

                        await interaction.deferUpdate();
                        if (metadata?.confirmationMessageId) {
                            const confirmationMessage = await interaction.channel.messages.fetch(metadata.confirmationMessageId).catch(() => null);
                            if (confirmationMessage) {
                                await confirmationMessage.delete().catch(console.error);
                            }
                        }
                        await interaction.channel.send({
                            content: '✅ Ticket closure cancelled.'
                        });
                        break;
                    }

                    case 'delete_ticket': {
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            return interaction.reply({
                                content: '❌ Only staff members can delete tickets.',
                                ephemeral: true
                            });
                        }

                        await interaction.reply({
                            content: `🗑️ Deleting ticket in ${CONFIG.DELETION_DELAY_SECONDS} seconds...`
                        });

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
                        break;
                    }

                    case 'open_ticket': {
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            return interaction.reply({
                                content: '❌ Only staff members can reopen tickets.',
                                ephemeral: true
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

                        await interaction.deferUpdate();
                        break;
                    }

                    case 'transcript_ticket': {
                        const staffRole = await cacheService.getStaffRole(interaction.guild, CONFIG.STAFF_ROLE_NAME);
                        const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

                        if (!isStaff) {
                            return interaction.reply({
                                content: '❌ Only staff members can generate transcripts.',
                                ephemeral: true
                            });
                        }

                        await interaction.reply({
                            content: '📄 Generating transcript... Please wait.',
                            ephemeral: true
                        });

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
                                return interaction.editReply({
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

                            await interaction.editReply({
                                content: '✅ Transcript generated and sent to the logs channel.'
                            });

                        } catch (error) {
                            console.error('Error generating transcript:', error);
                            await interaction.editReply({
                                content: '❌ An error occurred while generating the transcript.'
                            });
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing your request.',
                    ephemeral: true
                }).catch(console.error);
            }
        }
    });
}

module.exports = { setupInteractionHandler };