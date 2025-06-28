// services/cacheService.js
module.exports = class CacheService {
    constructor() {
        this.staffRole = null;
        this.lastCacheUpdate = 0;
        this.CACHE_TTL = 300000; // 5 minutes
    }

    async getStaffRole(guild, staffRoleName) {
        const now = Date.now();
        if (this.staffRole && now - this.lastCacheUpdate < this.CACHE_TTL) {
            return this.staffRole;
        }

        const staffRole = guild.roles.cache.find(
            role => role.name.toLowerCase() === staffRoleName.toLowerCase()
        );

        if (staffRole) {
            this.staffRole = staffRole;
            this.lastCacheUpdate = now;
        }

        return staffRole;
    }
};