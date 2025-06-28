// index.js
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

// Import features
const ticketsFeature = require('./features/tickets/tickets');
// const moderationFeature = require('./features/moderation/moderation');

// Create client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize features
ticketsFeature(client);
// moderationFeature(client);

// Global error handling
client.on('warn', warning => console.warn('Discord client warning:', warning));
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});