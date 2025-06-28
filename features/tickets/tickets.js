// features/tickets/tickets.js
const { setupMessageHandler } = require('./handlers/messageHandler');
const { setupInteractionHandler } = require('./handlers/interactionHandler');

module.exports = function initializeTicketsFeature(client) {
    // Setup handlers
    setupMessageHandler(client);
    setupInteractionHandler(client);
    
    console.log('✅ Tickets feature initialized');
};