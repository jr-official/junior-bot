// services/ticketService.js
const { PermissionFlagsBits } = require('discord.js');
const { ChannelType } = require('discord.js');
const { cleanUsername } = require('../utils/cleanup');
const TICKET_TYPES = require('../data/ticketTypes');
const ticketPermissions = require('../utils/permissions');

class TicketService {
    constructor() {
        this.activeTickets = new Map();
        this.ticketMetadata = new Map();
        this.userCooldowns = new Map();
        this.ticketCleanupTimers = new Map();
        this.ticketCreationLocks = new Map();
    }

    canUserCreateTicket(userId, maxTickets) {
        const userTickets = this.activeTickets.get(userId) || [];
        return userTickets.length < maxTickets;
    }

    addTicketToTracking(userId, channelId) {
        const userTickets = this.activeTickets.get(userId) || [];
        userTickets.push(channelId);
        this.activeTickets.set(userId, userTickets);
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
        
        return guild.channels.create({
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
    }
}

module.exports = TicketService;