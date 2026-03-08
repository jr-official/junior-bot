// features/moderation/services/warningService.js
const { ObjectId } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');

class WarningService {
    constructor() {
        this.collection = 'warnings';
    }

    _col() {
        return databaseService.getCollection(this.collection);
    }

    // Add a warning and return it with its generated _id
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
            active: true
        };

        const result = await warnings.insertOne(warning);
        return { ...warning, _id: result.insertedId };
    }

    // Remove a specific warning by its MongoDB _id string.
    // Returns the warning doc before removal, or null if not found / already inactive.
    async removeWarningById(warningId) {
        const warnings = this._col();

        let objectId;
        try {
            objectId = new ObjectId(warningId);
        } catch {
            return null; // invalid id format
        }

        const warning = await warnings.findOne({ _id: objectId, active: true });
        if (!warning) return null;

        await warnings.updateOne(
            { _id: objectId },
            { $set: { active: false, removedAt: new Date() } }
        );

        return warning;
    }

    // Get all active warnings for a specific user in a guild (newest first)
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

    // Get leaderboard: all users in a guild with ≥1 active warning,
    // sorted by count descending. Returns [{ userId, username, count }].
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

    // Ensure indexes exist — call once on bot startup
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