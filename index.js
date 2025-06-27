// index.js
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

// Import handlers
const { setupMessageHandler } = require('./handlers/messageHandler');
const { setupInteractionHandler } = require('./handlers/interactionHandler');

// Create client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Setup handlers
setupMessageHandler(client);
setupInteractionHandler(client);

// Error handling
client.on('warn', warning => console.warn('Discord client warning:', warning));
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});