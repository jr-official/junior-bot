// features/media/services/mediaService.js
//
// Data layer for the media libraries.
//
// Two scopes:
//   personal – private to one allowed user (ownerId = that user's id)
//   shared   – one library visible/usable by every allowed user (ownerId = 'shared').
//              Anyone allowed can add; only the person who added an item can
//              rename or delete it.
//
// Security model: EVERY method takes the caller's user id and asserts it is on the
// allow-list. Personal queries are always scoped by the caller's own id, so a user
// can never read or modify another user's personal items, even with a forged id.
// Metadata lives in `media_items`, file bytes in `media_files` (separate so listing
// never loads binary data). Both live in the bot's existing MongoDB.
const { ObjectId, Binary } = require('mongodb');
const databaseService = require('../../tickets/services/databaseService');
const config = require('../config/mediaConfig');
const { assertAllowed } = require('./accessService');
const { MediaError } = require('../utils/errors');
const { normalizeName, formatBytes } = require('../utils/mediaUtils');

const NOT_FOUND = 'That item no longer exists.';

function toObjectId(id) {
    if (id instanceof ObjectId) return id;
    if (typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)) return new ObjectId(id);
    return null;
}

class MediaService {
    _items() { return databaseService.getCollection(config.COLLECTIONS.items); }
    _files() { return databaseService.getCollection(config.COLLECTIONS.files); }

    // Resolves which owner key a query runs against (after the allow-list check).
    _owner(userId, scope = 'personal') {
        assertAllowed(userId);
        return scope === 'shared' ? config.SHARED_OWNER : userId;
    }

    _limits(scope) {
        return scope === 'shared'
            ? { maxCount: config.MAX_SHARED_ITEMS, maxBytes: config.MAX_SHARED_BYTES }
            : { maxCount: config.MAX_ITEMS_PER_USER, maxBytes: config.MAX_USER_BYTES };
    }

    async ensureIndexes() {
        await this._items().createIndexes([
            { key: { ownerId: 1, name: 1 }, unique: true },
            { key: { ownerId: 1, type: 1, name: 1 } }
        ]);
        await this._files().createIndexes([{ key: { ownerId: 1 } }]);
    }

    async getUsage(userId, scope = 'personal') {
        const ownerId = this._owner(userId, scope);
        const [row] = await this._items().aggregate([
            { $match: { ownerId } },
            { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }
        ]).toArray();
        return { count: row?.count ?? 0, bytes: row?.bytes ?? 0, ...this._limits(scope) };
    }

    async addItem(userId, { scope = 'personal', addedByName, name, type, buffer, mime, ext, width, height, animated }) {
        const ownerId = this._owner(userId, scope);

        const n = normalizeName(name);
        if (!n.ok) throw new MediaError(n.error);

        const where = scope === 'shared' ? 'The shared library' : 'Your library';
        const usage = await this.getUsage(userId, scope);
        if (usage.count >= usage.maxCount) {
            throw new MediaError(`${where} is full (${usage.maxCount} items). Delete something first.`, 'QUOTA');
        }
        if (usage.bytes + buffer.length > usage.maxBytes) {
            throw new MediaError(
                `Not enough space: this file is ${formatBytes(buffer.length)} and ${where.toLowerCase()} has ` +
                `${formatBytes(Math.max(0, usage.maxBytes - usage.bytes))} left of ${formatBytes(usage.maxBytes)}.`,
                'QUOTA'
            );
        }

        const now = new Date();
        const fileRes = await this._files().insertOne({ ownerId, data: new Binary(buffer), createdAt: now });

        const item = {
            ownerId, name: n.name, type, fileId: fileRes.insertedId,
            addedById: userId, addedByName: String(addedByName || 'unknown').slice(0, 40),
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
                throw new MediaError(
                    `${scope === 'shared' ? 'The shared library' : 'You'} already ${scope === 'shared' ? 'has' : 'have'} an item named \`${n.name}\`. Pick another name.`,
                    'NAME_TAKEN');
            }
            throw err;
        }
    }

    async list(userId, { type = 'all', page = 0, scope = 'personal' } = {}) {
        const ownerId = this._owner(userId, scope);
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

    async getItem(userId, id, scope = 'personal') {
        const ownerId = this._owner(userId, scope);
        const _id = toObjectId(id);
        if (!_id) throw new MediaError(NOT_FOUND, 'NOT_FOUND');
        const item = await this._items().findOne({ _id, ownerId });
        if (!item) throw new MediaError(NOT_FOUND, 'NOT_FOUND');
        return item;
    }

    // Returns null when not found (used by prefix commands / /sticker).
    async findByName(userId, name, scope = 'personal') {
        const ownerId = this._owner(userId, scope);
        const n = normalizeName(name);
        if (!n.ok) return null;
        return this._items().findOne({ ownerId, name: n.name });
    }

    // Autocomplete helper: names containing the typed text (max 25, Discord's limit).
    async searchNames(userId, text, scope = 'personal') {
        const ownerId = this._owner(userId, scope);
        const escaped = String(text || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 64);
        const filter = escaped ? { ownerId, name: { $regex: escaped } } : { ownerId };
        const rows = await this._items().find(filter).sort({ name: 1 }).limit(25).toArray();
        return rows.map(r => ({ name: r.name, type: r.type, addedByName: r.addedByName }));
    }

    async getFileBuffer(userId, item) {
        assertAllowed(userId);
        // Allowed: your own personal item, or any shared item. Never someone else's personal item.
        const readable = item && (item.ownerId === userId || item.ownerId === config.SHARED_OWNER);
        if (!readable) throw new MediaError(NOT_FOUND, 'NOT_FOUND');
        const doc = await this._files().findOne({ _id: item.fileId, ownerId: item.ownerId });
        if (!doc) throw new MediaError('The file for that item is missing. Please delete and re-add it.', 'NOT_FOUND');
        const bin = doc.data;
        return Buffer.from(bin.buffer.subarray(0, bin.position ?? bin.buffer.length));
    }

    // Shared items can only be changed by the person who added them.
    async _getMutable(userId, id, scope) {
        const item = await this.getItem(userId, id, scope);
        if (scope === 'shared' && item.addedById !== userId) {
            throw new MediaError(`Only ${item.addedByName}, who added this, can change or delete it.`, 'FORBIDDEN');
        }
        return item;
    }

    async rename(userId, id, newName, scope = 'personal') {
        const n = normalizeName(newName);
        if (!n.ok) throw new MediaError(n.error);
        const item = await this._getMutable(userId, id, scope);

        try {
            const res = await this._items().findOneAndUpdate(
                { _id: item._id, ownerId: item.ownerId },
                { $set: { name: n.name, updatedAt: new Date() } },
                { returnDocument: 'after' }
            );
            const doc = res && res.value !== undefined ? res.value : res;   // driver v5 vs v6 shape
            if (!doc) throw new MediaError(NOT_FOUND, 'NOT_FOUND');
            return doc;
        } catch (err) {
            if (err.code === 11000) {
                throw new MediaError(`An item named \`${n.name}\` already exists there.`, 'NAME_TAKEN');
            }
            throw err;
        }
    }

    async remove(userId, id, scope = 'personal') {
        const item = await this._getMutable(userId, id, scope);
        await this._items().deleteOne({ _id: item._id, ownerId: item.ownerId });
        await this._files().deleteOne({ _id: item.fileId, ownerId: item.ownerId }).catch(err =>
            console.error('[MediaService] orphaned file after delete:', item.fileId, err.message));
        return item;
    }
}

module.exports = new MediaService();
