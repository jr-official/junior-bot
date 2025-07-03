// features/moderation/utils/moderationUtils.js
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    /**
     * Check if a moderator can moderate a target member
     */
    async canModerate(moderator, target) {
        try {
            // Can't moderate yourself
            if (moderator.id === target.id) {
                return { success: false, message: "You cannot moderate yourself." };
            }

            // Can't moderate the server owner
            if (target.id === target.guild.ownerId) {
                return { success: false, message: "Cannot moderate the server owner." };
            }

            // Can't moderate if target has higher or equal role
            if (moderator.roles.highest.position <= target.roles.highest.position) {
                return { success: false, message: "You cannot moderate someone with a higher or equal role." };
            }

            // Can't moderate if bot can't moderate target
            const botMember = target.guild.members.me;
            if (botMember.roles.highest.position <= target.roles.highest.position) {
                return { success: false, message: "I cannot moderate someone with a higher or equal role than me." };
            }

            return { success: true };
        } catch (error) {
            console.error('Error checking moderation permissions:', error);
            return { success: false, message: "Error checking permissions." };
        }
    },

    /**
     * Validate basic permissions for moderation commands
     */
    async validatePermissions(member, permission) {
        try {
            // Convert string permission to PermissionFlagsBits
            const permissionFlag = PermissionFlagsBits[permission] || permission;
            
            // Check if user has the required permission
            if (!member.permissions.has(permissionFlag)) {
                return { success: false, message: "You do not have permission to use this command." };
            }

            // Check if bot has the required permission
            const botMember = member.guild.members.me;
            if (!botMember.permissions.has(permissionFlag)) {
                return { success: false, message: "I do not have the required permissions to execute this command." };
            }

            return { success: true };
        } catch (error) {
            console.error('Error validating permissions:', error);
            return { success: false, message: "Error validating permissions." };
        }
    },

    /**
     * Parse member mentions, IDs, and usernames
     */
    async parseMembers(guild, userString, hackBan = false) {
        try {
            const userIdentifiers = userString.split(/[,\s]+/).filter(id => id.length > 0);
            const targets = [];

            for (const identifier of userIdentifiers) {
                let user = null;
                let member = null;

                // Try to parse mention
                const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
                if (mentionMatch) {
                    const userId = mentionMatch[1];
                    try {
                        member = await guild.members.fetch(userId);
                        user = member.user;
                    } catch {
                        if (hackBan) {
                            try {
                                user = await guild.client.users.fetch(userId);
                            } catch {
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }
                }
                // Try to parse ID
                else if (/^\d{17,19}$/.test(identifier)) {
                    try {
                        member = await guild.members.fetch(identifier);
                        user = member.user;
                    } catch {
                        if (hackBan) {
                            try {
                                user = await guild.client.users.fetch(identifier);
                            } catch {
                                continue;
                            }
                        } else {
                            continue;
                        }
                    }
                }
                // Try to parse username
                else {
                    try {
                        const members = await guild.members.fetch({ query: identifier, limit: 1 });
                        if (members.size > 0) {
                            member = members.first();
                            user = member.user;
                        } else {
                            // Fallback to searching all members (less efficient)
                            const allMembers = await guild.members.fetch();
                            member = allMembers.find(m => 
                                m.user.username.toLowerCase() === identifier.toLowerCase() || 
                                m.user.tag.toLowerCase() === identifier.toLowerCase() ||
                                m.displayName.toLowerCase() === identifier.toLowerCase()
                            );
                            if (member) {
                                user = member.user;
                            }
                        }
                    } catch (error) {
                        console.error('Error searching for member:', error);
                        continue;
                    }
                }

                if (user) {
                    targets.push({ user, member });
                }
            }

            if (targets.length === 0) {
                return { success: false, message: "No valid users found." };
            }

            return { success: true, targets };
        } catch (error) {
            console.error('Error parsing members:', error);
            return { success: false, message: "Error parsing user identifiers." };
        }
    },

    /**
     * Send DM to user about moderation action
     */
    async sendDM(user, options) {
        try {
            const embed = new EmbedBuilder()
                .setTimestamp();

            switch (options.type) {
                case 'ban':
                    embed.setColor('#ff0000')
                        .setTitle('🔨 You have been banned')
                        .setDescription(`You have been banned from **${options.guild}**`)
                        .addFields(
                            { name: 'Reason', value: options.reason, inline: false },
                            { name: 'Moderator', value: options.moderator, inline: true }
                        );
                    
                    if (options.duration) {
                        embed.addFields({ name: 'Duration', value: options.duration, inline: true });
                    }
                    
                    if (options.proof) {
                        embed.addFields({ name: 'Evidence', value: `[View Proof](${options.proof})`, inline: false });
                    }
                    break;

                case 'unban':
                    embed.setColor('#00ff00')
                        .setTitle('🔓 You have been unbanned')
                        .setDescription(`You have been unbanned from **${options.guild}**`)
                        .addFields(
                            { name: 'Reason', value: options.reason, inline: false },
                            { name: 'Moderator', value: options.moderator, inline: true }
                        );
                    break;
            }

            await user.send({ embeds: [embed] });
        } catch (error) {
            console.error(`Failed to send DM to ${user.tag}:`, error);
            // Don't throw error - DM failure shouldn't stop the moderation action
        }
    },

    /**
     * Log moderation action to a designated channel
     */
    async logModeration(guild, action) {
        try {
            // Try to find a moderation log channel
            const logChannel = guild.channels.cache.find(channel => 
                channel.name.includes('mod-log') || 
                channel.name.includes('modlog') ||
                channel.name.includes('audit-log') ||
                channel.name.includes('logs')
            );

            if (!logChannel || !logChannel.isTextBased()) {
                return; // No log channel found
            }

            const embed = new EmbedBuilder()
                .setTimestamp()
                .setFooter({ text: `Case ID: ${Date.now().toString(36)}` });

            switch (action.type) {
                case 'ban':
                    embed.setColor('#ff0000')
                        .setTitle('🔨 Member Banned')
                        .addFields(
                            { name: 'User', value: `${action.target.tag} (${action.target.id})`, inline: true },
                            { name: 'Moderator', value: `${action.moderator.tag} (${action.moderator.id})`, inline: true },
                            { name: 'Reason', value: action.reason, inline: false }
                        );
                    
                    if (action.duration) {
                        embed.addFields({ name: 'Duration', value: action.duration, inline: true });
                    }
                    
                    if (action.expiresAt) {
                        embed.addFields({ name: 'Expires', value: `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:F>`, inline: true });
                    }
                    
                    if (action.purge_days > 0) {
                        embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                    }
                    
                    if (action.proof) {
                        embed.addFields({ name: 'Evidence', value: `[View Proof](${action.proof})`, inline: false });
                    }
                    break;

                case 'softban':
                    embed.setColor('#ff9500')
                        .setTitle('🔨 Member Soft Banned')
                        .addFields(
                            { name: 'User', value: `${action.target.tag} (${action.target.id})`, inline: true },
                            { name: 'Moderator', value: `${action.moderator.tag} (${action.moderator.id})`, inline: true },
                            { name: 'Reason', value: action.reason, inline: false }
                        );
                    
                    if (action.purge_days > 0) {
                        embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                    }
                    
                    if (action.proof) {
                        embed.addFields({ name: 'Evidence', value: `[View Proof](${action.proof})`, inline: false });
                    }
                    break;

                case 'unban':
                    embed.setColor('#00ff00')
                        .setTitle('🔓 Member Unbanned')
                        .addFields(
                            { name: 'User', value: `${action.target.tag} (${action.target.id})`, inline: true },
                            { name: 'Moderator', value: `${action.moderator.tag} (${action.moderator.id})`, inline: true },
                            { name: 'Reason', value: action.reason, inline: false }
                        );
                    break;
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to log moderation action:', error);
            // Don't throw error - logging failure shouldn't stop the moderation action
        }
    }
};