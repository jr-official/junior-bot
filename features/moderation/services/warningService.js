// features/moderation/services/warningService.js
const { ObjectId } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const { generateCaseId } = require('../utils/caseID');

class WarningService {
    constructor() { this.collection = 'warnings'; }
    _col() { return databaseService.getCollection(this.collection); }

    async addWarning(guildId, targetUser, moderatorUser, reason, proof, dmSent) {
        const caseId = generateCaseId('warn');
        const warning = {
            caseId, guildId,
            userId: targetUser.id, username: targetUser.tag,
            moderatorId: moderatorUser.id, moderatorTag: moderatorUser.tag,
            reason, proof: proof || null, dmSent: dmSent ?? false,
            createdAt: new Date(), active: true
        };
        const result = await this._col().insertOne(warning);
        return { ...warning, _id: result.insertedId };
    }

    async removeWarningById(warningId) {
        let objectId;
        try { objectId = new ObjectId(warningId); } catch { return null; }
        const warning = await this._col().findOne({ _id: objectId, active: true });
        if (!warning) return null;
        await this._col().updateOne({ _id: objectId }, { $set: { active: false, removedAt: new Date() } });
        return warning;
    }

    async getUserWarnings(guildId, userId) {
        return await this._col().find({ guildId, userId, active: true }).sort({ createdAt: -1 }).toArray();
    }

    async getUserWarningCount(guildId, userId) {
        return await this._col().countDocuments({ guildId, userId, active: true });
    }

    async getGuildLeaderboard(guildId) {
        return await this._col().aggregate([
            { $match: { guildId, active: true } },
            { $group: { _id: '$userId', username: { $last: '$username' }, count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $project: { _id: 0, userId: '$_id', username: '$username', count: '$count' } }
        ]).toArray();
    }

    async ensureIndexes() {
        try {
            await this._col().createIndexes([
                { key: { guildId: 1, userId: 1, active: 1 } },
                { key: { guildId: 1, active: 1 } },
                { key: { caseId: 1 }, unique: true, sparse: true },
                { key: { createdAt: -1 } }
            ]);
            console.log('✅ Warning indexes ensured');
        } catch (error) {
            console.error('❌ Error creating warning indexes:', error);
        }
    }
}

module.exports = new WarningService();