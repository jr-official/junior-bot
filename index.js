const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');
require('dotenv').config();

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Configuration - Change these values to match your server
const CONFIG = {
    TICKET_CHANNEL_ID: '1195346394748301382', // Channel where the ticket embed will be sent
    TICKET_CATEGORY_ID: '1385995916812484638', // Category where ticket channels will be created
    STAFF_ROLE_NAME: 'Staff', // Name of your staff role (case-insensitive)
    TICKET_CREATOR_ROLE_NAME: 'Ticket Creator', // Role given to users who create tickets (optional)
    MAX_TICKETS_PER_USER: 3, // Maximum tickets per user
    TICKET_CLEANUP_HOURS: 48, // Hours before empty tickets are deleted
    TICKET_CLOSE_DELAY: 10000 // Milliseconds before ticket deletion (10 seconds)
};

// Store active tickets to prevent spam and track cleanup
const activeTickets = new Map(); // userId -> array of channel IDs
const ticketCleanupTimers = new Map(); // channelId -> timer

// Utility function to clean username for channel naming
function cleanUsername(username) {
    return username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15) || 'user';
}

// Utility function to validate configuration
function validateConfig() {
    const errors = [];

    if (!CONFIG.TICKET_CHANNEL_ID) errors.push('TICKET_CHANNEL_ID is required');
    if (!CONFIG.TICKET_CATEGORY_ID) errors.push('TICKET_CATEGORY_ID is required');
    if (!CONFIG.STAFF_ROLE_NAME) errors.push('STAFF_ROLE_NAME is required');

    return errors;
}

// Utility function to check if user has too many tickets
function canUserCreateTicket(userId) {
    const userTickets = activeTickets.get(userId) || [];
    return userTickets.length < CONFIG.MAX_TICKETS_PER_USER;
}

// Utility function to add ticket to tracking
function addTicketToTracking(userId, channelId) {
    const userTickets = activeTickets.get(userId) || [];
    userTickets.push(channelId);
    activeTickets.set(userId, userTickets);
}

// Utility function to remove ticket from tracking
function removeTicketFromTracking(userId, channelId) {
    const userTickets = activeTickets.get(userId) || [];
    const updatedTickets = userTickets.filter(id => id !== channelId);

    if (updatedTickets.length === 0) {
        activeTickets.delete(userId);
    } else {
        activeTickets.set(userId, updatedTickets);
    }
}

// Function to setup ticket cleanup timer
function setupTicketCleanup(channel, userId) {
    const cleanupTime = CONFIG.TICKET_CLEANUP_HOURS * 60 * 60 * 1000; // Convert hours to milliseconds

    const timer = setTimeout(async () => {
        try {
            // Check if channel still exists and is relatively empty
            const messages = await channel.messages.fetch({ limit: 10 });
            const userMessages = messages.filter(msg => !msg.author.bot && msg.author.id === userId);

            if (userMessages.size <= 1) { // Only the initial ping message
                const warningEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Ticket Auto-Cleanup')
                    .setDescription('This ticket appears to be empty and will be deleted in 5 minutes. Please send a message if you still need help.')
                    .setColor(0xFFB347)
                    .setTimestamp();

                await channel.send({ embeds: [warningEmbed] });

                // Final cleanup after 5 more minutes
                setTimeout(async () => {
                    try {
                        const finalCheck = await channel.messages.fetch({ limit: 15 });
                        const finalUserMessages = finalCheck.filter(msg => !msg.author.bot && msg.author.id === userId);

                        if (finalUserMessages.size <= 1) {
                            removeTicketFromTracking(userId, channel.id);
                            await channel.delete('Auto-cleanup: Empty ticket');
                        }
                    } catch (error) {
                        console.error('Error in final ticket cleanup:', error);
                    }
                }, 5 * 60 * 1000); // 5 minutes
            }
        } catch (error) {
            console.error('Error in ticket cleanup check:', error);
        }
    }, cleanupTime);

    ticketCleanupTimers.set(channel.id, timer);
}

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Validate configuration on startup
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
        console.error('Configuration errors:', configErrors);
        console.error('Please fix the configuration before running the bot.');
        process.exit(1);
    }

    console.log('Configuration validated successfully!');
});

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');

    // Clear all cleanup timers
    for (const timer of ticketCleanupTimers.values()) {
        clearTimeout(timer);
    }

    client.destroy();
    process.exit(0);
});

// Listen for messages
client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Cancel cleanup timer if user sends a message in their ticket
    if (message.channel.name.includes('ticket-') ||
        ['partnership', 'moderation', 'information'].some(type => message.channel.name.startsWith(type))) {
        const timer = ticketCleanupTimers.get(message.channel.id);
        if (timer) {
            clearTimeout(timer);
            ticketCleanupTimers.delete(message.channel.id);
        }
    }

    // Setup ticket system command (admin only)
    if (message.content === '!setup-tickets') {
        // Check if user has administrator permissions
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permissions to use this command.');
        }

        try {
            // Validate that the configured channel and category exist
            const ticketChannel = message.guild.channels.cache.get(CONFIG.TICKET_CHANNEL_ID);
            const ticketCategory = message.guild.channels.cache.get(CONFIG.TICKET_CATEGORY_ID);

            if (!ticketChannel) {
                return message.reply(`❌ Ticket channel with ID ${CONFIG.TICKET_CHANNEL_ID} not found. Please check your configuration.`);
            }

            if (!ticketCategory) {
                return message.reply(`❌ Ticket category with ID ${CONFIG.TICKET_CATEGORY_ID} not found. Please check your configuration.`);
            }

            if (ticketCategory.type !== ChannelType.GuildCategory) {
                return message.reply(`❌ The specified ticket category is not a category channel. Please check your configuration.`);
            }

            // Check if staff role exists
            const staffRole = message.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            if (!staffRole) {
                return message.reply(`❌ Staff role "${CONFIG.STAFF_ROLE_NAME}" not found. Please create this role first.`);
            }

            const ticketEmbed = new EmbedBuilder()
                .setTitle('Need Help? Open a Ticket Below!')
                .setDescription('Use the dropdown menu to select the type of ticket you\'d like to create. A private channel will be opened where staff can assist you.\n## 📝 Ticket Options\n### 1. 🤝 Partnership Inquiry\nWant to propose a partnership? Choose this option and provide all relevant details.\n-# We do not do exclusive server-to-server partnerships. We only work with established companies.\n### 2. 🛡️ Moderation Ticket\nNeed to report a member, appeal a punishment, or ask about moderation actions? Use this option to contact the Mod Team.\n### 3. ❔ Information Ticket\nHave general questions, need clarification about JR, the rules, events, roles, or anything else? This option is for you.')
                .setColor(8323327)
                .setImage('https://media.discordapp.net/attachments/1200439850013298780/1386761808316076174/Support_Banner.png?ex=685ae213&is=68599093&hm=4021118cebe637c31610edcc5ed9497a540d05a4d4baf84f53cc4cb3c6b7df0d&=&format=webp&quality=lossless&width=1860&height=620')
                .setFooter({
                    text: `Empty tickets will be deleted after ${CONFIG.TICKET_CLEANUP_HOURS} hours. Max ${CONFIG.MAX_TICKETS_PER_USER} tickets per user.`
                });

            const ticketSelect = new StringSelectMenuBuilder()
                .setCustomId('ticket_select')
                .setPlaceholder('Select a ticket type...')
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Partnership Inquiry')
                        .setDescription('Want to propose a partnership? Choose this option.')
                        .setValue('partnership')
                        .setEmoji('🤝'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Moderation Ticket')
                        .setDescription('Report a member, appeal a punishment, or ask about moderation.')
                        .setValue('moderation')
                        .setEmoji('🛡️'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Information Ticket')
                        .setDescription('General questions about JR, rules, events, roles, etc.')
                        .setValue('information')
                        .setEmoji('❔')
                ]);

            const row = new ActionRowBuilder()
                .addComponents(ticketSelect);

            await ticketChannel.send({
                embeds: [ticketEmbed],
                components: [row]
            });

            await message.reply('✅ Ticket system setup complete! All configurations validated.');

        } catch (error) {
            console.error('Error setting up ticket system:', error);
            await message.reply('❌ Failed to setup ticket system. Please check my permissions and configuration.').catch(console.error);
        }
    }
});

// Handle interactions
client.on(Events.InteractionCreate, async interaction => {
    try {
        // Handle dropdown selection
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
            await interaction.deferReply({ ephemeral: true });

            const ticketType = interaction.values[0];
            const cleanedUsername = cleanUsername(interaction.user.username);

            // Check if user can create more tickets
            if (!canUserCreateTicket(interaction.user.id)) {
                return interaction.editReply({
                    content: `❌ You have reached the maximum number of tickets (${CONFIG.MAX_TICKETS_PER_USER}). Please close an existing ticket before creating a new one.`
                });
            }

            // Check if user already has a ticket of this type
            const existingTicket = interaction.guild.channels.cache.find(
                channel => channel.name === `${ticketType}-${cleanedUsername}` &&
                    channel.type === ChannelType.GuildText
            );

            if (existingTicket) {
                return interaction.editReply({
                    content: `❌ You already have a ${ticketType} ticket open: ${existingTicket}`
                });
            }

            // Find the staff role
            const staffRole = interaction.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            if (!staffRole) {
                return interaction.editReply({
                    content: `❌ Staff role "${CONFIG.STAFF_ROLE_NAME}" not found. Please contact an administrator.`
                });
            }

            // Get the category for tickets
            const ticketCategory = interaction.guild.channels.cache.get(CONFIG.TICKET_CATEGORY_ID);

            if (!ticketCategory) {
                return interaction.editReply({
                    content: `❌ Ticket category not found. Please contact an administrator.`
                });
            }

            // Determine ticket type info with custom colors
            const ticketInfo = {
                partnership: {
                    emoji: '🤝',
                    name: 'Partnership',
                    description: 'Partnership inquiry ticket created. Please provide all relevant details about your partnership proposal.',
                    color: 0x5865F2 // Discord Blurple
                },
                moderation: {
                    emoji: '🛡️',
                    name: 'Moderation',
                    description: 'Moderation ticket created. Please describe your issue or inquiry in detail.',
                    color: 0xED4245 // Discord Red
                },
                information: {
                    emoji: '❔',
                    name: 'Information',
                    description: 'Information ticket created. Please ask your questions and we\'ll help you out!',
                    color: 0x57F287 // Discord Green
                }
            };

            const selectedType = ticketInfo[ticketType];

            // Find or create ticket creator role
            let ticketCreatorRole = null;
            if (CONFIG.TICKET_CREATOR_ROLE_NAME) {
                ticketCreatorRole = interaction.guild.roles.cache.find(
                    role => role.name.toLowerCase() === CONFIG.TICKET_CREATOR_ROLE_NAME.toLowerCase()
                );

                if (!ticketCreatorRole) {
                    try {
                        ticketCreatorRole = await interaction.guild.roles.create({
                            name: CONFIG.TICKET_CREATOR_ROLE_NAME,
                            color: 0x2F3136,
                            reason: 'Ticket Creator role for ticket system'
                        });
                    } catch (error) {
                        console.log('Could not create Ticket Creator role:', error);
                    }
                }
            }

            // Create the ticket channel
            const ticketChannel = await interaction.guild.channels.create({
                name: `${ticketType}-${cleanedUsername}`,
                type: ChannelType.GuildText,
                parent: ticketCategory,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id, // @everyone role
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id, // Ticket creator
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    },
                    {
                        id: staffRole.id, // Staff role
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageMessages,
                            PermissionFlagsBits.ManageChannels,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks
                        ]
                    }
                ]
            });

            // Add ticket to tracking
            addTicketToTracking(interaction.user.id, ticketChannel.id);

            // Give user the ticket creator role if it exists
            if (ticketCreatorRole) {
                try {
                    await interaction.member.roles.add(ticketCreatorRole);
                } catch (error) {
                    console.log('Could not add Ticket Creator role to user:', error);
                }
            }

            // Create welcome embed for the ticket
            const welcomeEmbed = new EmbedBuilder()
                .setTitle(`${selectedType.emoji} ${selectedType.name} Ticket Created`)
                .setDescription(`Hello ${interaction.user}!\n\n${selectedType.description}\n\nSupport will be with you shortly. To close this ticket react with 🔒`)
                .setColor(selectedType.color)
                .setFooter({
                    text: `Support Team • Empty tickets will be deleted after ${CONFIG.TICKET_CLEANUP_HOURS} hours`,
                    iconURL: interaction.guild.iconURL()
                })
                .setTimestamp();

            // Create close ticket button
            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒');

            const closeRow = new ActionRowBuilder()
                .addComponents(closeButton);

            // Send welcome message in ticket channel
            await ticketChannel.send({
                content: `${interaction.user} ${staffRole}`,
                embeds: [welcomeEmbed],
                components: [closeRow]
            });

            // Setup cleanup timer
            setupTicketCleanup(ticketChannel, interaction.user.id);

            // Reply to the user
            await interaction.editReply({
                content: `✅ ${selectedType.name} ticket created successfully! ${ticketChannel}`
            });
        }

        // Handle close ticket button
        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            // Check if user is staff or the ticket creator
            const staffRole = interaction.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);
            const isTicketCreator = interaction.channel.name.includes(cleanUsername(interaction.user.username));

            if (!isStaff && !isTicketCreator) {
                return interaction.reply({
                    content: '❌ You can only close your own tickets or you need to be a staff member.',
                    ephemeral: true
                });
            }

            // Create confirmation buttons
            const closeConfirmButton = new ButtonBuilder()
                .setCustomId('confirm_close_ticket')
                .setLabel('Close')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_close_ticket')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary);

            const confirmRow = new ActionRowBuilder()
                .addComponents(closeConfirmButton, cancelButton);

            await interaction.reply({
                content: 'Are you sure you would like to close this ticket?',
                components: [confirmRow]
            });
        }

        // Handle confirm close ticket button
        if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
            await interaction.deferUpdate();

            // Clear cleanup timer
            const timer = ticketCleanupTimers.get(interaction.channel.id);
            if (timer) {
                clearTimeout(timer);
                ticketCleanupTimers.delete(interaction.channel.id);
            }

            // Create ticket closed embed
            const ticketClosedEmbed = new EmbedBuilder()
                .setTitle(`Ticket Closed by @${interaction.user.username}`)
                .setColor(0x2F3136)
                .setTimestamp();

            // Create support team controls
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

            // Send the ticket closed message
            await interaction.editReply({
                content: 'Support team ticket controls',
                embeds: [ticketClosedEmbed],
                components: [controlsRow]
            });

            // Remove permissions for the ticket creator (but keep it visible for staff)
            try {
                const ticketCreatorId = [...activeTickets.entries()]
                    .find(([userId, channels]) => channels.includes(interaction.channel.id))?.[0];

                if (ticketCreatorId) {
                    await interaction.channel.permissionOverwrites.edit(ticketCreatorId, {
                        ViewChannel: true,
                        SendMessages: false,
                        AddReactions: false
                    });
                }
            } catch (error) {
                console.error('Error updating ticket permissions:', error);
            }
        }

        // Handle cancel close ticket button
        if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
            await interaction.update({
                content: '❌ Ticket closure cancelled.',
                components: []
            });
        }

        // Handle delete ticket button (staff only)
        if (interaction.isButton() && interaction.customId === 'delete_ticket') {
            const staffRole = interaction.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

            if (!isStaff) {
                return interaction.reply({
                    content: '❌ Only staff members can delete tickets.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: '🗑️ Deleting ticket in 5 seconds...'
            });

            setTimeout(async () => {
                try {
                    // Remove from tracking and cleanup
                    const ticketCreatorId = [...activeTickets.entries()]
                        .find(([userId, channels]) => channels.includes(interaction.channel.id))?.[0];

                    if (ticketCreatorId) {
                        removeTicketFromTracking(ticketCreatorId, interaction.channel.id);

                        // Remove ticket creator role if user has no more tickets
                        const remainingTickets = activeTickets.get(ticketCreatorId) || [];
                        if (remainingTickets.length === 0) {
                            const ticketCreatorRole = interaction.guild.roles.cache.find(
                                role => role.name.toLowerCase() === CONFIG.TICKET_CREATOR_ROLE_NAME.toLowerCase()
                            );

                            if (ticketCreatorRole) {
                                const member = await interaction.guild.members.fetch(ticketCreatorId).catch(() => null);
                                if (member) {
                                    await member.roles.remove(ticketCreatorRole).catch(console.error);
                                }
                            }
                        }
                    }

                    await interaction.channel.delete('Ticket deleted by staff');
                } catch (error) {
                    console.error('Error deleting ticket channel:', error);
                }
            }, 5000);
        }

        // Handle open ticket button (staff only)
        if (interaction.isButton() && interaction.customId === 'open_ticket') {
            const staffRole = interaction.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

            if (!isStaff) {
                return interaction.reply({
                    content: '❌ Only staff members can reopen tickets.',
                    ephemeral: true
                });
            }

            // Restore permissions for the ticket creator
            try {
                const ticketCreatorId = [...activeTickets.entries()]
                    .find(([userId, channels]) => channels.includes(interaction.channel.id))?.[0];

                if (ticketCreatorId) {
                    await interaction.channel.permissionOverwrites.edit(ticketCreatorId, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true,
                        AttachFiles: true,
                        EmbedLinks: true,
                        AddReactions: true
                    });
                }
            } catch (error) {
                console.error('Error updating ticket permissions:', error);
            }

            // Create close ticket button again
            const closeButton = new ButtonBuilder()
                .setCustomId('close_ticket')
                .setLabel('Close Ticket')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒');

            const closeRow = new ActionRowBuilder()
                .addComponents(closeButton);

            const reopenEmbed = new EmbedBuilder()
                .setTitle('🔓 Ticket Reopened')
                .setDescription(`This ticket has been reopened by ${interaction.user}`)
                .setColor(0x57F287)
                .setTimestamp();

            await interaction.update({
                content: null,
                embeds: [reopenEmbed],
                components: [closeRow]
            });
        }

        // Handle transcript button (placeholder - you can implement actual transcript functionality)
        if (interaction.isButton() && interaction.customId === 'transcript_ticket') {
            const staffRole = interaction.guild.roles.cache.find(
                role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
            );

            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

            if (!isStaff) {
                return interaction.reply({
                    content: '❌ Only staff members can generate transcripts.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: '📄 Transcript functionality is not yet implemented. This is a placeholder for future development.',
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Error handling interaction:', error);

        // Try to respond with error message
        const errorMessage = '❌ An error occurred while processing your request. Please try again or contact an administrator.';

        if (interaction.deferred) {
            await interaction.editReply({ content: errorMessage }).catch(console.error);
        } else if (!interaction.replied) {
            await interaction.reply({ content: errorMessage, ephemeral: true }).catch(console.error);
        }
    }
});

// Handle errors
client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('warn', warning => {
    console.warn('Discord client warning:', warning);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Login to Discord with your client's token
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});