// features/tickets/services/ticketService.js
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { cleanUsername } = require('../utils/cleanup');
const TICKET_TYPES = require('../data/ticketTypes');
const ticketPermissions = require('../utils/permissions');
const CONFIG = require('../config/config');
const databaseService = require('./databaseService');

class TicketService {
    constructor() {
        this.ticketMetadata      = new Map();
        this.userCooldowns       = new Map();
        this.ticketCleanupTimers = new Map();

        this.startMemoryCleanup();
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.cleanupInactiveData();
        }, CONFIG.CACHE_CLEANUP_INTERVAL);
    }

    async cleanupInactiveData() {
        const now = Date.now();

        for (const [userId, timestamp] of this.userCooldowns.entries()) {
            if (now - timestamp > CONFIG.MAX_INACTIVE_TIME) {
                this.userCooldowns.delete(userId);
            }
        }

        const toDelete = [];
        for (const [channelId, metadata] of this.ticketMetadata.entries()) {
            if (metadata.lastActivity && now - metadata.lastActivity > CONFIG.MAX_INACTIVE_TIME) {
                toDelete.push(channelId);
            }
        }

        for (const channelId of toDelete) {
            try {
                const ticket = await this.getTicketFromDatabase(channelId);
                if (!ticket || ticket.status === 'closed') {
                    this.ticketMetadata.delete(channelId);
                } else {
                    const existing = this.ticketMetadata.get(channelId) || {};
                    this.ticketMetadata.set(channelId, { ...existing, lastActivity: now });
                }
            } catch {
                // If the DB check fails, leave the entry in place — safe default
            }
        }

        console.log(
            `Memory cleanup completed. Metadata: ${this.ticketMetadata.size}, ` +
            `Cooldowns: ${this.userCooldowns.size}`
        );
    }

    updateMetadataActivity(channelId) {
        const metadata = this.ticketMetadata.get(channelId) || {};
        metadata.lastActivity = Date.now();
        this.ticketMetadata.set(channelId, metadata);
        this.updateTicketActivity(channelId);
    }

    async canUserCreateTicket(userId, maxTickets) {
        try {
            const tickets = databaseService.getCollection('tickets');
            const openCount = await tickets.countDocuments({ userId, status: 'open' });
            return openCount < maxTickets;
        } catch (error) {
            console.error('❌ Error checking user ticket count:', error);
            return true;
        }
    }

    // FIX (Bug 3): the userId parameter was silently dropped — ticket counts
    // moved to MongoDB during a refactor, but the signature was never cleaned up.
    // This is confusing because callers pass interaction.user.id expecting it
    // to be used, and it isn't. The parameter has been removed. The one call
    // site in ticketCreationHandler.js must be updated to match:
    //
    //   BEFORE: ticketService.addTicketToTracking(interaction.user.id, ticketChannel.id)
    //   AFTER:  ticketService.addTicketToTracking(ticketChannel.id)
    addTicketToTracking(channelId) {
        this.updateMetadataActivity(channelId);
    }

    removeTicketFromTracking(userId, channelId) {
        const timer = this.ticketCleanupTimers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.ticketCleanupTimers.delete(channelId);
        }

        this.ticketMetadata.delete(channelId);
        this.closeTicket(channelId);
    }

    isUserOnCooldown(userId, cooldownTime) {
        const lastCreated = this.userCooldowns.get(userId);
        if (!lastCreated) return false;
        return Date.now() - lastCreated < cooldownTime;
    }

    setCooldown(userId) {
        this.userCooldowns.set(userId, Date.now());
    }

    async createTicketChannel(guild, ticketType, user, ticketCategoryId, staffRole) {
        const cleanedUsername = cleanUsername(user.username, user.id);
        const channelName     = `${ticketType}-${cleanedUsername}`;

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: ticketCategoryId,
            permissionOverwrites: [
                { id: guild.id,      deny:  [PermissionFlagsBits.ViewChannel] },
                { id: user.id,       allow: ticketPermissions.creator.allow   },
                { id: staffRole.id,  allow: ticketPermissions.staff.allow     }
            ]
        });

        const metadata = {
            type:         ticketType,
            createdAt:    Date.now(),
            creatorId:    user.id,
            lastActivity: Date.now()
        };
        this.ticketMetadata.set(channel.id, metadata);

        await this.saveTicketToDatabase(channel.id, {
            channelId:    channel.id,
            guildId:      guild.id,
            userId:       user.id,
            username:     user.username,
            ticketType:   ticketType,
            status:       'open',
            createdAt:    new Date(),
            lastActivity: new Date()
        });

        return channel;
    }

    // ── Database helpers ──────────────────────────────────────────────────────

    async saveTicketToDatabase(channelId, ticketData) {
        try {
            const tickets = databaseService.getCollection('tickets');
            await tickets.insertOne(ticketData);
            console.log(`✅ Ticket saved to database: ${channelId}`);
        } catch (error) {
            console.error('❌ Error saving ticket to database:', error);
        }
    }

    async getTicketFromDatabase(channelId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            return await tickets.findOne({ channelId });
        } catch (error) {
            console.error('❌ Error getting ticket from database:', error);
            return null;
        }
    }

    async updateTicketActivity(channelId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            await tickets.updateOne(
                { channelId },
                { $set: { lastActivity: new Date() } }
            );
        } catch (error) {
            console.error('❌ Error updating ticket activity:', error);
        }
    }

    async closeTicket(channelId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            await tickets.updateOne(
                { channelId },
                { $set: { status: 'closed', closedAt: new Date() } }
            );
            console.log(`✅ Ticket closed in database: ${channelId}`);
        } catch (error) {
            console.error('❌ Error closing ticket in database:', error);
        }
    }

    async getUserTickets(userId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            return await tickets.find({ userId, status: 'open' }).toArray();
        } catch (error) {
            console.error('❌ Error getting user tickets:', error);
            return [];
        }
    }

    async getGuildTickets(guildId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            return await tickets.find({ guildId, status: 'open' }).toArray();
        } catch (error) {
            console.error('❌ Error getting guild tickets:', error);
            return [];
        }
    }

    async getTicketStats(guildId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            const stats = await tickets.aggregate([
                { $match: { guildId } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]).toArray();
            return stats.reduce((acc, stat) => { acc[stat._id] = stat.count; return acc; }, {});
        } catch (error) {
            console.error('❌ Error getting ticket stats:', error);
            return {};
        }
    }
}

module.exports = TicketService;