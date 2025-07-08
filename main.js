// main.js
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

// Import database service
const databaseService = require('./features/tickets/services/databaseService');

// Import features
const ticketsFeature = require('./features/tickets/tickets');
const moderationFeature = require('./features/moderation/moderation');
const rolesFeature = require('./features/roles/roles');

// Create client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildBans // Add this for ban events
    ]
});

// Database and bot initialization
async function initializeBot() {
    try {
        // Connect to database first
        await databaseService.connect();
        
        // Initialize features after database connection
        ticketsFeature(client);
        moderationFeature(client);
        rolesFeature(client);
        
        console.log('🤖 Bot features initialized');
    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);
        process.exit(1);
    }
}

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
    
    // Verify database connection
    const dbHealthy = await databaseService.ping();
    console.log(`🗄️ Database status: ${dbHealthy ? 'Healthy' : 'Unhealthy'}`);
});

// Global error handling
client.on('warn', warning => console.warn('⚠️ Discord client warning:', warning));

client.on('error', error => {
    console.error('❌ Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    await databaseService.disconnect();
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    await databaseService.disconnect();
    client.destroy();
    process.exit(0);
});

// Initialize and login
async function startBot() {
    try {
        await initializeBot();
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

startBot();