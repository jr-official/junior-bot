// features/media/services/mediaService.js
//
// Data layer for the personal media library.
//
// Security model: EVERY method takes the caller's user id, asserts it is on the
// allow-list, and scopes every query by ownerId. A user can therefore never read
// or modify another user's items, even with a forged item id.
//
// Storage: metadata in `media_items`, file bytes in `media_files` (kept separate
// so listing never loads binary data). Both live in the bot's existing MongoDB.
const { ObjectId, Binary } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const config = require('../config/mediaConfig');
const { assertAllowed } = require('./accessService');
const { MediaError } = require('../utils/errors');
const { normalizeName, formatBytes } = require('../utils/mediaUtils');

function toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) return new ObjectId(id);
    return null;
}

class MediaService {
    _items() { return databaseService.getCollection(config.COLLECTIONS.items); }
    _files() { return databaseService.getCollection(config.COLLECTIONS.files); }

    async ensureIndexes() {
        await this._items().createIndexes([
            { key: { ownerId: 1, name: 1 }, unique: true },
            { key: { ownerId: 1, type: 1, name: 1 } }
        ]);
        await this._files().createIndexes([{ key: { ownerId: 1 } }]);
    }

    async getUsage(ownerId) {
        assertAllowed(ownerId);
        const [row] = await this._items().aggregate([
            { $match: { ownerId } },
            { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }
        ]).toArray();
        return {
            count: row?.count ?? 0,
            bytes: row?.bytes ?? 0,
            maxCount: config.MAX_ITEMS_PER_USER,
            maxBytes: config.MAX_USER_BYTES
        };
    }

    async addItem(ownerId, { name, type, buffer, mime, ext, width, height, animated }) {
        assertAllowed(ownerId);

        const n = normalizeName(name);
        if (!n.ok) throw new MediaError(n.error);

        const usage = await this.getUsage(ownerId);
        if (usage.count >= usage.maxCount) {
            throw new MediaError(`Your library is full (${usage.maxCount} items). Delete something first.`, 'QUOTA');
        }
        if (usage.bytes + buffer.length > usage.maxBytes) {
            throw new MediaError(
                `Not enough space: this file is ${formatBytes(buffer.length)} and you have ` +
                `${formatBytes(Math.max(0, usage.maxBytes - usage.bytes))} left of ${formatBytes(usage.maxBytes)}.`,
                'QUOTA'
            );
        }

        const now = new Date();
        const fileRes = await this._files().insertOne({
            ownerId, data: new Binary(buffer), createdAt: now
        });

        const item = {
            ownerId, name: n.name, type, fileId: fileRes.insertedId,
            mime, ext, size: buffer.length,
            width: width ?? null, height: height ?? null, animated: !!animated,
            createdAt: now, updatedAt: now
        };

        try {
            const res = await this._items().insertOne(item);
            return { ...item, _id: res.insertedId };
        } catch (err) {
            await this._files().deleteOne({ _id: fileRes.insertedId, ownerId }).catch(() => {});
            if (err.code === 11000) {
                throw new MediaError(`You already have an item named \`${n.name}\`. Pick another name.`, 'NAME_TAKEN');
            }
            throw err;
        }
    }

    async list(ownerId, { type = 'all', page = 0 } = {}) {
        assertAllowed(ownerId);
        const filter = { ownerId };
        if (type !== 'all') filter.type = type;

        const total = await this._items().countDocuments(filter);
        const pages = Math.max(1, Math.ceil(total / config.PAGE_SIZE));
        const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);

        const items = await this._items().find(filter)
            .sort({ name: 1 })
            .skip(safePage * config.PAGE_SIZE)
            .limit(config.PAGE_SIZE)
            .toArray();

        return { items, total, pages, page: safePage };
    }

    async getItem(ownerId, id) {
        assertAllowed(ownerId);
        const _id = toObjectId(id);
        if (!_id) throw new MediaError('That item no longer exists.', 'NOT_FOUND');
        const item = await this._items().findOne({ _id, ownerId });
        if (!item) throw new MediaError('That item no longer exists.', 'NOT_FOUND');
        return item;
    }

    // Returns null when not found (used by prefix commands).
    async findByName(ownerId, name) {
        assertAllowed(ownerId);
        const n = normalizeName(name);
        if (!n.ok) return null;
        return this._items().findOne({ ownerId, name: n.name });
    }

    async getFileBuffer(ownerId, item) {
        assertAllowed(ownerId);
        if (!item || item.ownerId !== ownerId) throw new MediaError('That item no longer exists.', 'NOT_FOUND');
        const doc = await this._files().findOne({ _id: item.fileId, ownerId });
        if (!doc) throw new MediaError('The file for that item is missing. Please delete and re-add it.', 'NOT_FOUND');
        const bin = doc.data;
        return Buffer.from(bin.buffer.subarray(0, bin.position ?? bin.buffer.length));
    }

    async rename(ownerId, id, newName) {
        assertAllowed(ownerId);
        const n = normalizeName(newName);
        if (!n.ok) throw new MediaError(n.error);
        const _id = toObjectId(id);
        if (!_id) throw new MediaError('That item no longer exists.', 'NOT_FOUND');

        try {
            const res = await this._items().findOneAndUpdate(
                { _id, ownerId },
                { $set: { name: n.name, updatedAt: new Date() } },
                { returnDocument: 'after' }
            );
            const doc = res && res.value !== undefined ? res.value : res;   // driver v5 vs v6 shape
            if (!doc) throw new MediaError('That item no longer exists.', 'NOT_FOUND');
            return doc;
        } catch (err) {
            if (err.code === 11000) {
                throw new MediaError(`You already have an item named \`${n.name}\`.`, 'NAME_TAKEN');
            }
            throw err;
        }
    }

    async remove(ownerId, id) {
        assertAllowed(ownerId);
        const _id = toObjectId(id);
        if (!_id) throw new MediaError('That item no longer exists.', 'NOT_FOUND');
        const item = await this._items().findOne({ _id, ownerId });
        if (!item) throw new MediaError('That item no longer exists.', 'NOT_FOUND');

        await this._items().deleteOne({ _id, ownerId });
        await this._files().deleteOne({ _id: item.fileId, ownerId }).catch(err =>
            console.error('[MediaService] orphaned file after delete:', item.fileId, err.message));
        return item;
    }
}

module.exports = new MediaService();
