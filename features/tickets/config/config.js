// features/tickets/config/config.js
//
// IDs that were previously hard-coded are now read from environment variables,
// with the original values as fallbacks so existing deployments keep working
// without changes to .env.
//
// Add these to your .env (or hosting env vars) to override the defaults:
//   TICKET_CHANNEL_ID
//   TICKET_CATEGORY_ID
//   TICKET_LOGS_CHANNEL_ID

module.exports = {
    TICKET_CHANNEL_ID:          process.env.TICKET_CHANNEL_ID          || '1195346394748301382',
    TICKET_CATEGORY_ID:         process.env.TICKET_CATEGORY_ID         || '1385995916812484638',
    STAFF_ROLE_NAME:            'Staff',
    MAX_TICKETS_PER_USER:       3,
    TICKET_CLEANUP_HOURS:       48,
    TICKET_CLOSE_DELAY:         10000,
    TICKET_LOGS_CHANNEL_ID:     process.env.TICKET_LOGS_CHANNEL_ID     || '1195349555391250522',
    CLEANUP_INTERVAL_MINUTES:   5,
    DELETION_DELAY_SECONDS:     10,
    WARNING_TIMEOUT_MINUTES:    15,
    TICKET_CREATE_COOLDOWN:     30000,   // 30 seconds
    RATE_LIMIT_REQUESTS:        5,
    RATE_LIMIT_DELAY_MS:        1000,
    MESSAGE_FETCH_LIMIT:        100,
    CACHE_CLEANUP_INTERVAL:     3600000, // 1 hour
    MAX_INACTIVE_TIME:          86400000 // 24 hours
};