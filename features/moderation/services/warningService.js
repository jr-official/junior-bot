// features/moderation/services/warningService.js
const databaseService = require('../../tickets/services/databaseService');

class WarningService {
    constructor() {
        this.collection = 'warnings';
    }

    _col() {
        return databaseService.getCollection(this.collection);
    }

    // Add a warning and return it with its generated ID
    async addWarning(guildId, targetUser, moderatorUser, reason, proof, dmSent) {
        const warnings = this._col();

        const warning = {
            guildId,
            userId: targetUser.id,
            username: targetUser.tag,
            moderatorId: moderatorUser.id,
            moderatorTag: moderatorUser.tag,
            reason,
            proof: proof || null,
            dmSent: dmSent ?? false,
            createdAt: new Date(),
            active: true  // set to false when removed
        };

        const result = await warnings.insertOne(warning);
        return { ...warning, _id: result.insertedId };
    }

    // Remove the most recent active warning for a user in a guild.
    // Returns the removed warning doc, or null if none found.
    async removeWarning(guildId, userId) {
        const warnings = this._col();

        // Find the most recent active warning
        const warning = await warnings.findOne(
            { guildId, userId, active: true },
            { sort: { createdAt: -1 } }
        );

        if (!warning) return null;

        await warnings.updateOne(
            { _id: warning._id },
            { $set: { active: false, removedAt: new Date() } }
        );

        return warning;
    }

    // Get all active warnings for a specific user in a guild
    async getUserWarnings(guildId, userId) {
        const warnings = this._col();
        return await warnings
            .find({ guildId, userId, active: true })
            .sort({ createdAt: -1 })
            .toArray();
    }

    // Get the total active warning count for a user in a guild
    async getUserWarningCount(guildId, userId) {
        const warnings = this._col();
        return await warnings.countDocuments({ guildId, userId, active: true });
    }

    // Get leaderboard: all users in a guild with at least 1 active warning,
    // sorted by count descending. Returns array of { userId, username, count }.
    async getGuildLeaderboard(guildId) {
        const warnings = this._col();

        return await warnings.aggregate([
            { $match: { guildId, active: true } },
            {
                $group: {
                    _id: '$userId',
                    username: { $last: '$username' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1, _id: 1 } },
            {
                $project: {
                    _id: 0,
                    userId: '$_id',
                    username: '$username',
                    count: '$count'
                }
            }
        ]).toArray();
    }

    // Ensure indexes exist (call once on bot startup)
    async ensureIndexes() {
        try {
            const warnings = this._col();
            await warnings.createIndexes([
                { key: { guildId: 1, userId: 1, active: 1 } },
                { key: { guildId: 1, active: 1 } },
                { key: { createdAt: -1 } }
            ]);
            console.log('✅ Warning indexes ensured');
        } catch (error) {
            console.error('❌ Error creating warning indexes:', error);
        }
    }
}

module.exports = new WarningService();