// services/ticketService.js
const { PermissionFlagsBits } = require('discord.js');
const { ChannelType } = require('discord.js');
const { cleanUsername } = require('../utils/cleanup');
const TICKET_TYPES = require('../data/ticketTypes');
const ticketPermissions = require('../utils/permissions');
const CONFIG = require('../config/config');
const databaseService = require('./databaseService');

class TicketService {
    constructor() {
        this.activeTickets = new Map();
        this.ticketMetadata = new Map();
        this.userCooldowns = new Map();
        this.ticketCleanupTimers = new Map();
        this.ticketCreationLocks = new Map();
        
        // Start memory cleanup interval
        this.startMemoryCleanup();
    }

    startMemoryCleanup() {
        setInterval(() => {
            this.cleanupInactiveData();
        }, CONFIG.CACHE_CLEANUP_INTERVAL);
    }

    cleanupInactiveData() {
        const now = Date.now();
        
        // Clean up old cooldowns
        for (const [userId, timestamp] of this.userCooldowns.entries()) {
            if (now - timestamp > CONFIG.MAX_INACTIVE_TIME) {
                this.userCooldowns.delete(userId);
            }
        }

        // Clean up old metadata for non-existent channels
        for (const [channelId, metadata] of this.ticketMetadata.entries()) {
            if (metadata.lastActivity && now - metadata.lastActivity > CONFIG.MAX_INACTIVE_TIME) {
                this.ticketMetadata.delete(channelId);
            }
        }

        console.log(`Memory cleanup completed. Active tickets: ${this.activeTickets.size}, Metadata: ${this.ticketMetadata.size}, Cooldowns: ${this.userCooldowns.size}`);
    }

    updateMetadataActivity(channelId) {
        const metadata = this.ticketMetadata.get(channelId) || {};
        metadata.lastActivity = Date.now();
        this.ticketMetadata.set(channelId, metadata);
        
        // Also update in database
        this.updateTicketActivity(channelId);
    }

    canUserCreateTicket(userId, maxTickets) {
        const userTickets = this.activeTickets.get(userId) || [];
        return userTickets.length < maxTickets;
    }

    addTicketToTracking(userId, channelId) {
        const userTickets = this.activeTickets.get(userId) || [];
        userTickets.push(channelId);
        this.activeTickets.set(userId, userTickets);
        this.updateMetadataActivity(channelId);
    }

    removeTicketFromTracking(userId, channelId) {
        const timer = this.ticketCleanupTimers.get(channelId);
        if (timer) {
            clearTimeout(timer);
            this.ticketCleanupTimers.delete(channelId);
        }

        this.ticketMetadata.delete(channelId);

        const userTickets = this.activeTickets.get(userId) || [];
        const updatedTickets = userTickets.filter(id => id !== channelId);
        if (updatedTickets.length > 0) {
            this.activeTickets.set(userId, updatedTickets);
        } else {
            this.activeTickets.delete(userId);
        }

        // Update database
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
        const channelName = `${ticketType}-${cleanedUsername}`;

        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: ticketCategoryId,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: user.id,
                    allow: ticketPermissions.creator.allow
                },
                {
                    id: staffRole.id,
                    allow: ticketPermissions.staff.allow
                }
            ]
        });

        // Store initial metadata
        const metadata = {
            type: ticketType,
            createdAt: Date.now(),
            creatorId: user.id,
            lastActivity: Date.now()
        };
        
        this.ticketMetadata.set(channel.id, metadata);

        // Save to database
        await this.saveTicketToDatabase(channel.id, {
            channelId: channel.id,
            guildId: guild.id,
            userId: user.id,
            username: user.username,
            ticketType: ticketType,
            status: 'open',
            createdAt: new Date(),
            lastActivity: new Date()
        });

        return channel;
    }

    // Database methods
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
                { 
                    $set: { 
                        status: 'closed',
                        closedAt: new Date()
                    }
                }
            );
            console.log(`✅ Ticket closed in database: ${channelId}`);
        } catch (error) {
            console.error('❌ Error closing ticket in database:', error);
        }
    }

    async getUserTickets(userId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            return await tickets.find({ 
                userId, 
                status: 'open' 
            }).toArray();
        } catch (error) {
            console.error('❌ Error getting user tickets:', error);
            return [];
        }
    }

    async getGuildTickets(guildId) {
        try {
            const tickets = databaseService.getCollection('tickets');
            return await tickets.find({ 
                guildId, 
                status: 'open' 
            }).toArray();
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
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();
            
            return stats.reduce((acc, stat) => {
                acc[stat._id] = stat.count;
                return acc;
            }, {});
        } catch (error) {
            console.error('❌ Error getting ticket stats:', error);
            return {};
        }
    }
}

module.exports = TicketService;