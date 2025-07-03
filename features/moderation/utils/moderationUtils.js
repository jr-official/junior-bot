const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    async canModerate(moderator, target) {
        try {
            if (moderator.id === target.id) {
                return { success: false, message: "You cannot moderate yourself." };
            }

            if (target.id === target.guild.ownerId) {
                return { success: false, message: "Cannot moderate the server owner." };
            }

            if (moderator.roles.highest.position <= target.roles.highest.position) {
                return { success: false, message: "You cannot moderate someone with a higher or equal role." };
            }

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

    async validatePermissions(member, permission) {
        try {
            const permissionFlag = PermissionFlagsBits[permission] || permission;

            if (!member.permissions.has(permissionFlag)) {
                return { success: false, message: "You do not have permission to use this command." };
            }

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

    async sendDM(user, options) {
        try {
            const embed = new EmbedBuilder().setTimestamp();

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
        }
    },

    async logModeration(guild, action) {
        try {
            const logChannel = guild.channels.cache.find(channel =>
                channel.name.includes('mod-log') ||
                channel.name.includes('modlog') ||
                channel.name.includes('audit-log') ||
                channel.name.includes('logs')
            );

            if (!logChannel || !logChannel.isTextBased()) return;

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
        }
    },

    async parseMembers(guild, input, allowHackBan = false) {
        const ids = input.split(/[\s,]+/).filter(Boolean);
        if (!ids.length) return { success: false, message: "No users provided", targets: [] };

        const targets = [];

        for (const idOrTag of ids) {
            try {
                let user = null;
                let member = null;

                if (/^\d{17,19}$/.test(idOrTag)) {
                    user = await guild.client.users.fetch(idOrTag);
                    member = await guild.members.fetch(idOrTag).catch(() => null);
                } else if (idOrTag.match(/^<@!?(\d+)>$/)) {
                    const id = idOrTag.match(/^<@!?(\d+)>$/)[1];
                    user = await guild.client.users.fetch(id);
                    member = await guild.members.fetch(id).catch(() => null);
                } else {
                    return { success: false, message: `Invalid user format: ${idOrTag}` };
                }

                if (!user) throw new Error("User not found");
                if (!member && !allowHackBan) {
                    return { success: false, message: `${user.tag} is not in the server.` };
                }

                targets.push({ user, member });
            } catch (error) {
                return { success: false, message: `Failed to resolve user: ${idOrTag}` };
            }
        }

        return { success: true, targets };
    }
};
