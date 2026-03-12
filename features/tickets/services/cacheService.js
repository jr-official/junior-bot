// features/tickets/services/cacheService.js
//
// Previously stored a single staffRole for *all* guilds, meaning the first
// guild's role would be returned for any subsequent guild lookup.  Now keyed
// by guildId so each guild has its own cached entry.

module.exports = class CacheService {
    constructor() {
        // Map<guildId, { role, cachedAt }>
        this._cache     = new Map();
        this.CACHE_TTL  = 300_000; // 5 minutes
    }

    async getStaffRole(guild, staffRoleName) {
        const now    = Date.now();
        const cached = this._cache.get(guild.id);

        if (cached && now - cached.cachedAt < this.CACHE_TTL) {
            return cached.role;
        }

        const staffRole = guild.roles.cache.find(
            role => role.name.toLowerCase() === staffRoleName.toLowerCase()
        );

        // Cache even if null so we don't hammer the API on every interaction
        // when the role genuinely doesn't exist.
        this._cache.set(guild.id, { role: staffRole ?? null, cachedAt: now });

        return staffRole ?? null;
    }

    /** Manually invalidate a guild's cached role (e.g. after a role rename). */
    invalidate(guildId) {
        this._cache.delete(guildId);
    }
};