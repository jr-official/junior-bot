// features/tickets/services/cacheService.js
//
// Previously stored a single staffRole for *all* guilds, meaning the first
// guild's role would be returned for any subsequent guild lookup. Now keyed
// by guildId so each guild has its own cached entry.
//
// NOTE: invalidate(guildId) must be called if the Staff role is renamed or
// deleted. Hook this into a roleUpdate / roleDelete event listener if your
// bot handles those events. Until then, cache staleness lasts at most CACHE_TTL
// (5 minutes), after which the role is re-fetched automatically.

const { Events } = require('discord.js');

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

    // FIX: registerRoleListeners wires up automatic cache invalidation when the
    // Staff role is renamed or deleted. Call this once during bot initialisation
    // (e.g. in tickets.js, after constructing the CacheService instance) and
    // pass the discord.js Client. Without this, stale cache entries persist for
    // up to CACHE_TTL after a role change, causing incorrect permission checks.
    //
    // Usage in tickets.js:
    //   const cacheService = new CacheService();
    //   cacheService.registerRoleListeners(client);
    registerRoleListeners(client) {
        client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
            // If the name changed, the cached role object may now be wrong.
            if (oldRole.name !== newRole.name) {
                this.invalidate(newRole.guild.id);
            }
        });

        client.on(Events.GuildRoleDelete, (role) => {
            this.invalidate(role.guild.id);
        });
    }
};