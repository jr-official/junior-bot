// features/moderation/services/warningService.js
const { ObjectId } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const { generateCaseId } = require('../utils/caseID');

class WarningService {
    constructor() { this.collection = 'warnings'; }

    _col() { return databaseService.getCollection(this.collection); }

    // FIX (Bug 5): addWarning now catches MongoDB duplicate key errors (code 11000)
    // on the caseId unique index and retries once with a freshly generated ID.
    // Previously a collision — though rare (1-in-16.7M) — would bubble up as a
    // generic crash and show the moderator a confusing "error occurred" message
    // with no indication of what actually went wrong.
    async addWarning(guildId, targetUser, moderatorUser, reason, proof, dmSent) {
        const buildDoc = (caseId) => ({
            caseId,
            guildId,
            userId:       targetUser.id,
            username:     targetUser.tag,
            moderatorId:  moderatorUser.id,
            moderatorTag: moderatorUser.tag,
            reason,
            proof:    proof || null,
            dmSent:   dmSent ?? false,
            createdAt: new Date(),
            active:    true
        });

        let caseId  = generateCaseId('warn');
        let warning = buildDoc(caseId);

        try {
            const result = await this._col().insertOne(warning);
            return { ...warning, _id: result.insertedId };
        } catch (err) {
            // 11000 = MongoDB duplicate key — retry once with a new ID.
            // Any other error is re-thrown so the caller surfaces it correctly.
            if (err.code !== 11000) throw err;

            console.warn(`[WarningService] Duplicate caseId "${caseId}" — retrying with new ID`);
            caseId  = generateCaseId('warn');
            warning = buildDoc(caseId);
            // If this second attempt also collides, re-throw — astronomically unlikely.
            const result = await this._col().insertOne(warning);
            return { ...warning, _id: result.insertedId };
        }
    }

    // FIX (Bug 1): markDmSent no longer swallows all errors indiscriminately.
    // The old version wrapped everything in try/catch and silently returned on
    // any failure, meaning a DB outage would leave dmSent=false on a warning
    // even when the DM was successfully delivered — permanently wrong audit data.
    //
    // Now only the ObjectId conversion failure is silently ignored (same as
    // before — if the ID is malformed there's nothing useful to do). Real DB
    // errors are allowed to propagate so the call site in warn.js can log them.
    async markDmSent(warningId, sent = true) {
        let objectId;
        if (warningId instanceof ObjectId) {
            objectId = warningId;
        } else {
            try {
                objectId = new ObjectId(warningId);
            } catch {
                // Invalid ID format — nothing to update, log and bail
                console.warn('[WarningService] markDmSent: invalid warningId format:', warningId);
                return;
            }
        }
        // Real DB errors now propagate to the caller instead of being silently eaten
        await this._col().updateOne({ _id: objectId }, { $set: { dmSent: sent } });
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