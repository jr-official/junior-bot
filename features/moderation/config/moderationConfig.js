// features/moderation/config/moderationConfig.js
// All IDs are read from environment variables so the bot is portable
// and secrets are not hard-coded in source.
//
// Required .env keys:
//   MOD_LOGS_CHANNEL_ID   – text channel where moderation actions are logged

module.exports = {
    MOD_LOGS_CHANNEL_ID: process.env.MOD_LOGS_CHANNEL_ID || '1385991704670244915'
};