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
    PermissionFlagsBits,
} = require('discord.js');
const { Buffer } = require('buffer');
require('dotenv').config();

// HTML sanitization setup
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const dompurify = DOMPurify(window);

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
    MAX_TICKETS_PER_USER: 3, // Maximum tickets per user
    TICKET_CLEANUP_HOURS: 48, // Hours before empty tickets are deleted
    TICKET_CLOSE_DELAY: 10000, // Milliseconds before ticket deletion (10 seconds)
    TICKET_LOGS_CHANNEL_ID: '1195349555391250522' // Add your logs channel ID here
};

// Centralized ticket types configuration
const TICKET_TYPES = {
    partnership: {
        emoji: '🤝',
        name: 'Partnership',
        description: 'Please provide all relevant details about your partnership proposal.',
        color: 0x5865F2
    },
    moderation: {
        emoji: '🛡️',
        name: 'Moderation',
        description: 'Please describe your issue or inquiry in detail.',
        color: 0xED4245
    },
    information: {
        emoji: '❔',
        name: 'Information',
        description: 'Please ask your questions and we\'ll help you out!',
        color: 0x57F287
    }
};

// Standard permissions
const TICKET_PERMISSIONS = {
    creator: {
        allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AddReactions
        ]
    },
    staff: {
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
};

// Store active tickets and metadata
const activeTickets = new Map();
const ticketMetadata = new Map(); // channelId -> { creatorId, createdAt, ticketType }
const userCooldowns = new Map();
const ticketCleanupTimers = new Map();  // <-- ADD THIS LINE
const ticketCreationLocks = new Map();

// Cache for frequently accessed data
const dataCache = {
    staffRole: null,
    lastCacheUpdate: 0,
    CACHE_TTL: 300000 // 5 minutes
};

// Utility function to clean username for channel naming
function cleanUsername(username, userId) {
    const base = username.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 10);
    const idPart = userId.slice(-6); // Increased from 4 to 6 digits for better uniqueness
    return `${base}-${idPart}`;
}

// Utility function to sanitize HTML
function safeHtml(unsafe) {
    return dompurify.sanitize(unsafe);
}

// Utility function to validate configuration
function validateConfig() {
    const errors = [];

    if (!CONFIG.TICKET_CHANNEL_ID) errors.push('TICKET_CHANNEL_ID is required');
    if (!CONFIG.TICKET_CATEGORY_ID) errors.push('TICKET_CATEGORY_ID is required');
    if (!CONFIG.STAFF_ROLE_NAME) errors.push('STAFF_ROLE_NAME is required');
    if (!CONFIG.TICKET_LOGS_CHANNEL_ID) errors.push('TICKET_LOGS_CHANNEL_ID is required');

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

function removeTicketFromTracking(userId, channelId) {
    const timer = ticketCleanupTimers.get(channelId);
    if (timer) {
        clearTimeout(timer);
        ticketCleanupTimers.delete(channelId);
    }

    ticketMetadata.delete(channelId);

    const userTickets = activeTickets.get(userId) || [];
    const updatedTickets = userTickets.filter(id => id !== channelId);
    if (updatedTickets.length > 0) {
        activeTickets.set(userId, updatedTickets);
    } else {
        activeTickets.delete(userId);
    }
}

function isUserOnCooldown(userId) {
    const lastCreated = userCooldowns.get(userId);
    if (!lastCreated) return false;

    const timeSinceLastCreated = Date.now() - lastCreated;
    return timeSinceLastCreated < CONFIG.TICKET_CREATE_COOLDOWN;
}

function setCooldown(userId) {
    userCooldowns.set(userId, Date.now());
}

// Function to generate HTML transcript with rate limiting
async function generateTranscript(channel, ticketCreator) {
    try {
        const messages = [];
        let lastMessageId;
        let requestCount = 0;

        while (true) {
            if (requestCount > 0 && requestCount % CONFIG.RATE_LIMIT_REQUESTS === 0) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY_MS));
            }

            const options = { limit: CONFIG.MESSAGE_FETCH_LIMIT };
            if (lastMessageId) {
                options.before = lastMessageId;
            }

            const batch = await channel.messages.fetch(options);
            if (batch.size === 0) break;

            messages.push(...batch.values());
            lastMessageId = batch.lastKey();
            requestCount++;
        }

        messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        const metadata = ticketMetadata.get(channel.id) || {};
        const ticketType = metadata.type || channel.name.split('-')[0];
        const createdAt = new Date(metadata.createdAt || channel.createdTimestamp);
        const closedAt = new Date();

        let htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ticket Transcript - ${safeHtml(channel.name)}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #36393f; color: #dcddde; margin: 0; padding: 20px; }
        .header { background: #2f3136; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .header h1 { color: #7289da; margin: 0 0 10px 0; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .info-item { background: #40444b; padding: 15px; border-radius: 6px; }
        .info-label { font-weight: bold; color: #b9bbbe; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
        .info-value { color: #dcddde; }
        .messages { background: #2f3136; border-radius: 8px; padding: 20px; }
        .message { margin-bottom: 20px; display: flex; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 15px; background: #7289da; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
        .message-content { flex: 1; }
        .message-header { display: flex; align-items: center; margin-bottom: 5px; }
        .username { font-weight: bold; color: #dcddde; margin-right: 10px; }
        .timestamp { color: #72767d; font-size: 12px; }
        .message-text { color: #dcddde; line-height: 1.4; }
        .bot-message .username { color: #7289da; }
        .system-message { background: #40444b; padding: 10px; border-radius: 6px; margin: 10px 0; font-style: italic; color: #b9bbbe; }
        .embed { background: #2f3136; border-left: 4px solid #7289da; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .embed-title { font-weight: bold; color: #ffffff; margin-bottom: 8px; }
        .embed-description { color: #dcddde; }
        .attachment { background: #40444b; padding: 10px; border-radius: 6px; margin: 5px 0; }
        .attachment-name { color: #00aff4; text-decoration: none; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎫 Ticket Transcript</h1>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Ticket Owner</div>
                <div class="info-value">${safeHtml(ticketCreator.username)}#${safeHtml(ticketCreator.discriminator)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Ticket Name</div>
                <div class="info-value">${safeHtml(channel.name)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Panel Name</div>
                <div class="info-value">${safeHtml(TICKET_TYPES[ticketType]?.name || ticketType)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Created At</div>
                <div class="info-value">${safeHtml(createdAt.toLocaleString())}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Closed At</div>
                <div class="info-value">${safeHtml(closedAt.toLocaleString())}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Total Messages</div>
                <div class="info-value">${messages.length}</div>
            </div>
        </div>
    </div>
    
    <div class="messages">
        <h2>📝 Messages</h2>`;

        for (const message of messages) {
            const timestamp = new Date(message.createdTimestamp).toLocaleString();
            const isBot = message.author.bot;
            const avatarInitial = message.author.username.charAt(0).toUpperCase();

            htmlContent += `
        <div class="message">
            <div class="avatar">${safeHtml(avatarInitial)}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="username ${isBot ? 'bot-message' : ''}">${safeHtml(message.author.username)}${isBot ? ' BOT' : ''}</span>
                    <span class="timestamp">${safeHtml(timestamp)}</span>
                </div>`;

            if (message.content) {
                htmlContent += `<div class="message-text">${safeHtml(message.content).replace(/\n/g, '<br>')}</div>`;
            }

            if (message.embeds.length > 0) {
                for (const embed of message.embeds) {
                    htmlContent += `<div class="embed">`;
                    if (embed.title) {
                        htmlContent += `<div class="embed-title">${safeHtml(embed.title)}</div>`;
                    }
                    if (embed.description) {
                        htmlContent += `<div class="embed-description">${safeHtml(embed.description).replace(/\n/g, '<br>')}</div>`;
                    }
                    htmlContent += `</div>`;
                }
            }

            if (message.attachments.size > 0) {
                for (const attachment of message.attachments.values()) {
                    htmlContent += `<div class="attachment">📎 <a href="${safeHtml(attachment.url)}" class="attachment-name" target="_blank">${safeHtml(attachment.name)}</a></div>`;
                }
            }

            htmlContent += `</div></div>`;
        }

        htmlContent += `
    </div>
</body>
</html>`;

        return {
            html: htmlContent,
            totalMessages: messages.length,
            ticketType: TICKET_TYPES[ticketType]?.name || ticketType
        };

    } catch (error) {
        console.error('Error generating transcript:', error);
        return null;
    }
}

// Function to setup ticket cleanup timer
function setupTicketCleanup(channel, userId) {
    const cleanupTime = CONFIG.TICKET_CLEANUP_HOURS * 60 * 60 * 1000;

    const timer = setTimeout(async () => {
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const userMessages = messages.filter(msg => !msg.author.bot && msg.author.id === userId);

            if (userMessages.size <= 1) {
                const warningEmbed = new EmbedBuilder()
                    .setTitle('⚠️ Ticket Auto-Cleanup')
                    .setDescription(`This ticket appears to be empty and will be deleted in ${CONFIG.WARNING_TIMEOUT_MINUTES} minutes. Please send a message if you still need help.`)
                    .setColor(0xFFB347)
                    .setTimestamp();

                await channel.send({ embeds: [warningEmbed] });

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
                }, CONFIG.WARNING_TIMEOUT_MINUTES * 60 * 1000);
            }
        } catch (error) {
            console.error('Error in ticket cleanup check:', error);
        }
    }, cleanupTime);

    ticketCleanupTimers.set(channel.id, timer);
}

// Function to get staff role with caching
async function getStaffRole(guild) {
    const now = Date.now();
    if (dataCache.staffRole && now - dataCache.lastCacheUpdate < dataCache.CACHE_TTL) {
        return dataCache.staffRole;
    }

    const staffRole = guild.roles.cache.find(
        role => role.name.toLowerCase() === CONFIG.STAFF_ROLE_NAME.toLowerCase()
    );

    if (staffRole) {
        dataCache.staffRole = staffRole;
        dataCache.lastCacheUpdate = now;
    }

    return staffRole;
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

    // Clear orphaned timers
    for (const [channelId, timer] of ticketCleanupTimers) {
        clearTimeout(timer);
        ticketCleanupTimers.delete(channelId);
    }
    console.log('Cleaned up orphaned timers');

    // Setup periodic cleanup
    setInterval(() => {
        const now = Date.now();

        // Clean up active tickets
        for (const [userId, tickets] of activeTickets) {
            const validTickets = tickets.filter(channelId =>
                client.channels.cache.has(channelId)
            );
            if (validTickets.length !== tickets.length) {
                activeTickets.set(userId, validTickets);
            }
        }

        // Clean up expired cooldowns
        for (const [userId, timestamp] of userCooldowns) {
            if (now - timestamp > CONFIG.TICKET_CREATE_COOLDOWN) {
                userCooldowns.delete(userId);
            }
        }

        // Clean up orphaned metadata
        for (const [channelId, metadata] of ticketMetadata) {
            if (!client.channels.cache.has(channelId)) {
                ticketMetadata.delete(channelId);
            }
        }

        // Clean up orphaned timers
        for (const [channelId, timer] of ticketCleanupTimers) {
            if (!client.channels.cache.has(channelId)) {
                clearTimeout(timer);
                ticketCleanupTimers.delete(channelId);
            }
        }
    }, CONFIG.CLEANUP_INTERVAL_MINUTES * 60 * 1000);
});

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');

    for (const timer of ticketCleanupTimers.values()) {
        clearTimeout(timer);
    }

    client.destroy();
    process.exit(0);
});

// Listen for messages
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    const isTicketChannel = Object.keys(TICKET_TYPES).some(type =>
        message.channel.name.startsWith(`${type}-`)
    );

    if (isTicketChannel) {
        const timer = ticketCleanupTimers.get(message.channel.id);
        if (timer) {
            clearTimeout(timer);
            ticketCleanupTimers.delete(message.channel.id);
        }
    }

    if (message.content === '!setup-tickets') {
        if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permissions to use this command.');
        }

        try {
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

            const staffRole = await getStaffRole(message.guild);

            if (!staffRole) {
                return message.reply(`❌ Staff role "${CONFIG.STAFF_ROLE_NAME}" not found. Please check your configuration.`);
            }

            const ticketEmbed = new EmbedBuilder()
                .setTitle('Need Help? Open a Ticket Below!')
                .setDescription('Use the dropdown menu to select the type of ticket you\'d like to create. A private channel will be opened where staff can assist you.\n## 📝 Ticket Options\n### 1. 🤝 Partnership Inquiry\nWant to propose a partnership? Choose this option and provide all relevant details.\n-# We do not do exclusive server-to-server partnerships. We only work with established companies.\n### 2. 🛡️ Moderation Ticket\nNeed to report a member, appeal a punishment, or ask about moderation actions? Use this option to contact the Mod Team.\n### 3. ❔ Information Ticket\nHave general questions, need clarification about the server, the rules, events, roles, or anything else? This option is for you.')
                .setColor(8323327)
                .setFooter({
                    text: `Empty tickets will be deleted after ${CONFIG.TICKET_CLEANUP_HOURS} hours. Max ${CONFIG.MAX_TICKETS_PER_USER} tickets per user.`
                });

            const ticketSelect = new StringSelectMenuBuilder()
                .setCustomId('ticket_select')
                .setPlaceholder('Select a ticket type...')
                .addOptions(
                    Object.entries(TICKET_TYPES).map(([value, type]) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(type.name)
                            .setDescription(type.description)
                            .setValue(value)
                            .setEmoji(type.emoji)
                    )
                );

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

// Handle dropdown and button interactions
client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
            // Early check for ticket creation lock
            if (ticketCreationLocks.has(interaction.user.id)) {
                return interaction.reply({
                    content: '❌ Please wait until your previous ticket creation finishes',
                    ephemeral: true
                });
            }

            ticketCreationLocks.set(interaction.user.id, true);
            await interaction.deferReply({ ephemeral: true });

            try {
                if (isUserOnCooldown(interaction.user.id)) {
                    const remainingTime = Math.ceil((CONFIG.TICKET_CREATE_COOLDOWN - (Date.now() - userCooldowns.get(interaction.user.id))) / 1000);
                    return interaction.editReply({
                        content: `❌ Please wait ${remainingTime} seconds before creating another ticket.`
                    });
                }

                const ticketType = interaction.values[0];
                const cleanedUsername = cleanUsername(interaction.user.username, interaction.user.id);

                if (!canUserCreateTicket(interaction.user.id)) {
                    return interaction.editReply({
                        content: `❌ You have reached the maximum number of tickets (${CONFIG.MAX_TICKETS_PER_USER}). Please close an existing ticket before creating a new one.`
                    });
                }

                const existingTicket = interaction.guild.channels.cache.find(
                    channel => channel.name === `${ticketType}-${cleanedUsername}` &&
                        channel.type === ChannelType.GuildText
                );

                if (existingTicket) {
                    return interaction.editReply({
                        content: `❌ You already have a ${ticketType} ticket open: ${existingTicket}`
                    });
                }

                const staffRole = await getStaffRole(interaction.guild);

                if (!staffRole) {
                    return interaction.editReply({
                        content: `❌ Staff role "${CONFIG.STAFF_ROLE_NAME}" not found. Please contact an administrator.`
                    });
                }

                const ticketCategory = interaction.guild.channels.cache.get(CONFIG.TICKET_CATEGORY_ID);

                if (!ticketCategory) {
                    return interaction.editReply({
                        content: `❌ Ticket category not found. Please contact an administrator.`
                    });
                }

                const tempTicketId = `temp-${Date.now()}`;
                addTicketToTracking(interaction.user.id, tempTicketId);

                const selectedType = TICKET_TYPES[ticketType];

                let ticketChannel;
                try {
                    ticketChannel = await interaction.guild.channels.create({
                        name: `${ticketType}-${cleanedUsername}`,
                        type: ChannelType.GuildText,
                        parent: ticketCategory,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionFlagsBits.ViewChannel]
                            },
                            {
                                id: interaction.user.id,
                                allow: TICKET_PERMISSIONS.creator.allow
                            },
                            {
                                id: staffRole.id,
                                allow: TICKET_PERMISSIONS.staff.allow
                            }
                        ]
                    });

                    ticketMetadata.set(ticketChannel.id, {
                        creatorId: interaction.user.id,
                        createdAt: Date.now(),
                        type: ticketType
                    });

                    removeTicketFromTracking(interaction.user.id, tempTicketId);
                    addTicketToTracking(interaction.user.id, ticketChannel.id);

                } catch (error) {
                    removeTicketFromTracking(interaction.user.id, tempTicketId);
                    console.error('Error creating ticket channel:', error);
                    return interaction.editReply({
                        content: '❌ Failed to create ticket channel. Please check my permissions and try again.'
                    });
                }

                setCooldown(interaction.user.id);

                const welcomeEmbed = new EmbedBuilder()
                    .setTitle(`${selectedType.emoji} ${selectedType.name} Ticket Created`)
                    .setDescription(`Hello ${interaction.user}!\n\n${selectedType.description}\n\nSupport will be with you shortly. To close this ticket react with 🔒`)
                    .setColor(selectedType.color)
                    .setFooter({
                        text: `Empty tickets will be deleted after ${CONFIG.TICKET_CLEANUP_HOURS} hours`
                    })
                    .setTimestamp();

                const closeButton = new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒');

                const closeRow = new ActionRowBuilder()
                    .addComponents(closeButton);

                try {
                    await ticketChannel.send({
                        content: `${interaction.user} ${staffRole}`,
                        embeds: [welcomeEmbed],
                        components: [closeRow]
                    });
                } catch (error) {
                    console.error('Error sending welcome message:', error);
                }

                setupTicketCleanup(ticketChannel, interaction.user.id);

                await interaction.editReply({
                    content: `✅ ${selectedType.name} ticket created successfully! ${ticketChannel}`
                });

            } finally {
                ticketCreationLocks.delete(interaction.user.id);
            }
        }

        if (interaction.isButton() && interaction.customId === 'close_ticket') {
            const staffRole = await getStaffRole(interaction.guild);
            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);
            const metadata = ticketMetadata.get(interaction.channel.id);
            const isTicketCreator = metadata && metadata.creatorId === interaction.user.id;

            if (!isStaff && !isTicketCreator) {
                return interaction.reply({
                    content: '❌ You can only close your own tickets or you need to be a staff member.',
                    ephemeral: true
                });
            }

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

        if (interaction.isButton() && interaction.customId === 'confirm_close_ticket') {
            await interaction.deferUpdate();

            const timer = ticketCleanupTimers.get(interaction.channel.id);
            if (timer) {
                clearTimeout(timer);
                ticketCleanupTimers.delete(interaction.channel.id);
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

            await interaction.editReply({
                content: 'Support team ticket controls',
                embeds: [ticketClosedEmbed],
                components: [controlsRow]
            });

            try {
                const metadata = ticketMetadata.get(interaction.channel.id);
                if (metadata && metadata.creatorId) {
                    await interaction.channel.permissionOverwrites.edit(metadata.creatorId, {
                        ViewChannel: true,
                        SendMessages: false,
                        AddReactions: false
                    }).catch(error => {
                        console.error('Error updating ticket permissions (user might have left the server):', error);
                    });
                }
            } catch (error) {
                console.error('Error updating ticket permissions:', error);
            }
        }

        if (interaction.isButton() && interaction.customId === 'cancel_close_ticket') {
            await interaction.update({
                content: '❌ Ticket closure cancelled.',
                components: []
            });
        }

        if (interaction.isButton() && interaction.customId === 'delete_ticket') {
            const staffRole = await getStaffRole(interaction.guild);
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
                    const metadata = ticketMetadata.get(interaction.channel.id);
                    if (metadata && metadata.creatorId) {
                        removeTicketFromTracking(metadata.creatorId, interaction.channel.id);
                    }

                    await interaction.channel.delete('Ticket deleted by staff');
                } catch (error) {
                    console.error('Error deleting ticket channel:', error);
                }
            }, CONFIG.DELETION_DELAY_SECONDS * 1000);
        }

        if (interaction.isButton() && interaction.customId === 'open_ticket') {
            const staffRole = await getStaffRole(interaction.guild);
            const isStaff = staffRole && interaction.member.roles.cache.has(staffRole.id);

            if (!isStaff) {
                return interaction.reply({
                    content: '❌ Only staff members can reopen tickets.',
                    ephemeral: true
                });
            }

            try {
                const metadata = ticketMetadata.get(interaction.channel.id);
                if (metadata && metadata.creatorId) {
                    await interaction.channel.permissionOverwrites.edit(metadata.creatorId, TICKET_PERMISSIONS.creator)
                        .catch(error => console.error('Error updating ticket permissions:', error));
                }
            } catch (error) {
                console.error('Error updating ticket permissions:', error);
            }

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

        if (interaction.isButton() && interaction.customId === 'transcript_ticket') {
            const staffRole = await getStaffRole(interaction.guild);
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
                const metadata = ticketMetadata.get(interaction.channel.id);
                let ticketCreator;

                if (metadata && metadata.creatorId) {
                    try {
                        ticketCreator = await interaction.guild.members.fetch(metadata.creatorId);
                        ticketCreator = ticketCreator.user;
                    } catch (error) {
                        console.error('Error fetching ticket creator:', error);
                        ticketCreator = { username: 'Unknown', discriminator: '0000' };
                    }
                } else {
                    const channelName = interaction.channel.name;
                    const usernameFromChannel = channelName.split('-').slice(1).join('-');
                    const member = interaction.guild.members.cache.find(m =>
                        cleanUsername(m.user.username, m.user.id) === usernameFromChannel
                    );
                    ticketCreator = member ? member.user : { username: 'Unknown', discriminator: '0000' };
                }

                const transcriptData = await generateTranscript(interaction.channel, ticketCreator);

                if (!transcriptData) {
                    return interaction.editReply({
                        content: '❌ Failed to generate transcript. Please try again.'
                    });
                }

                const logsChannel = interaction.guild.channels.cache.get(CONFIG.TICKET_LOGS_CHANNEL_ID);

                if (!logsChannel) {
                    return interaction.editReply({
                        content: '❌ Ticket logs channel not found. Please check the configuration.'
                    });
                }

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

                await interaction.editReply({
                    content: '✅ Transcript generated and sent to the logs channel.'
                });

            } catch (error) {
                console.error('Error generating transcript:', error);
                await interaction.editReply({
                    content: '❌ An error occurred while generating the transcript.'
                });
            }
        }
    } catch (error) {
        console.error('Interaction error:', error);
        const errorMessage = '❌ An unexpected error occurred. Please try again later.';

        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else if (!interaction.replied) {
                await interaction.reply({
                    content: errorMessage,
                    ephemeral: true
                });

            }
        } catch (replyError) {
            console.error('Error sending error message:', replyError);
        }
    }
});

client.on('warn', warning => {
    console.warn('Discord client warning:', warning);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});




// nice?