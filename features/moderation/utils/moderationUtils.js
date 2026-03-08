// features/moderation/utils/moderationUtils.js
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Hardcoded mod-logs channel ID
const MOD_LOGS_CHANNEL_ID = '1385991704670244915';

async function canModerate(moderator, target) {
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
}

async function validatePermissions(member, permission) {
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
}

async function handleProofData(proofUrl, proofFile) {
    if (!proofUrl && !proofFile) {
        return { data: null, error: null };
    }

    if (proofFile) {
        const maxFileSize = 25 * 1024 * 1024;
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'application/json',
            'video/mp4', 'video/webm'
        ];

        if (proofFile.size > maxFileSize) {
            return { data: null, error: 'File size exceeds 25MB limit' };
        }

        if (!allowedTypes.includes(proofFile.contentType)) {
            return {
                data: null,
                error: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`
            };
        }

        return {
            data: {
                type: 'file',
                url: proofFile.url,
                filename: proofFile.name,
                size: proofFile.size,
                contentType: proofFile.contentType,
                isImage: proofFile.contentType.startsWith('image/'),
                uploadedAt: new Date().toISOString()
            },
            error: null
        };
    }

    if (proofUrl) {
        try {
            const url = new URL(proofUrl);
            if (!['http:', 'https:'].includes(url.protocol)) {
                return { data: null, error: 'Only HTTP and HTTPS URLs are allowed' };
            }
            return {
                data: {
                    type: 'url',
                    url: proofUrl,
                    domain: url.hostname,
                    addedAt: new Date().toISOString()
                },
                error: null
            };
        } catch {
            return { data: null, error: 'Invalid URL format' };
        }
    }

    return { data: null, error: null };
}

// ─── formatModeratorField ────────────────────────────────────────────────────
// Returns a consistent "tag (ID)" string for DM embeds.
// Accepts either (tag, id) separately or a single user object.
function formatModeratorField(tagOrUser, id) {
    if (tagOrUser && typeof tagOrUser === 'object') {
        return `${tagOrUser.tag} (${tagOrUser.id})`;
    }
    return `${tagOrUser} (${id})`;
}

// ─── sendDM ──────────────────────────────────────────────────────────────────
async function sendDM(user, options) {
    try {
        const embed = new EmbedBuilder().setTimestamp();

        // All cases now show "Tag (ID)" for the moderator field
        const modField = formatModeratorField(options.moderatorTag, options.moderatorId);

        switch (options.type) {
            case 'ban':
                embed.setColor('#ff0000')
                    .setTitle('🔨 You have been banned')
                    .setDescription(`You have been banned from **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason, inline: false },
                        { name: 'Moderator', value: modField,       inline: true  }
                    );
                if (options.duration) {
                    embed.addFields({ name: 'Duration', value: options.duration, inline: true });
                }
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            case 'unban':
                embed.setColor('#00ff00')
                    .setTitle('🔓 You have been unbanned')
                    .setDescription(`You have been unbanned from **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason, inline: false },
                        { name: 'Moderator', value: modField,       inline: true  }
                    );
                break;

            case 'kick':
                embed.setColor('#ff6600')
                    .setTitle('👢 You have been kicked')
                    .setDescription(`You have been kicked from **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason, inline: false },
                        { name: 'Moderator', value: modField,       inline: true  }
                    );
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            case 'mute':
                embed.setColor('#ffa500')
                    .setTitle('🔇 You have been muted')
                    .setDescription(`You have been timed out in **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason,              inline: false },
                        { name: 'Duration',  value: options.duration || 'Unknown', inline: true  },
                        { name: 'Moderator', value: modField,                    inline: true  }
                    );
                if (options.expiresAt) {
                    embed.addFields({
                        name: 'Expires',
                        value: `<t:${Math.floor(options.expiresAt.getTime() / 1000)}:F>`,
                        inline: false
                    });
                }
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            case 'unmute':
                embed.setColor('#00ff99')
                    .setTitle('🔊 You have been unmuted')
                    .setDescription(`Your timeout has been removed in **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason, inline: false },
                        { name: 'Moderator', value: modField,       inline: true  }
                    );
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            case 'warn':
                embed.setColor('#ffcc00')
                    .setTitle('⚠️ You have received a warning')
                    .setDescription(`You have been warned in **${options.guild}**`)
                    .addFields(
                        { name: 'Reason',    value: options.reason, inline: false },
                        { name: 'Moderator', value: modField,       inline: true  }
                    );
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            case 'warn_remove':
                embed.setColor('#00ccff')
                    .setTitle('🗑️ A warning has been removed')
                    .setDescription(`A warning was removed from your record in **${options.guild}**`)
                    .addFields(
                        { name: 'Removal Reason',   value: options.reason,         inline: false },
                        { name: 'Original Warning', value: options.originalReason, inline: false },
                        { name: 'Moderator',        value: modField,               inline: true  },
                        { name: 'Remaining Warnings', value: `${options.remaining}`, inline: true }
                    );
                if (options.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForDM(options.proof), inline: false });
                    if (options.proof.type === 'file' && options.proof.isImage) embed.setImage(options.proof.url);
                }
                break;

            default:
                return;
        }

        await user.send({ embeds: [embed] });
    } catch (error) {
        console.error(`Failed to send DM to ${user.tag}:`, error);
    }
}

// ─── logModeration ───────────────────────────────────────────────────────────
async function logModeration(guild, action) {
    try {
        let logChannel = guild.channels.cache.get(MOD_LOGS_CHANNEL_ID);

        if (!logChannel) {
            console.warn(`Mod-logs channel (${MOD_LOGS_CHANNEL_ID}) not found, searching by name...`);
            logChannel = guild.channels.cache.find(ch =>
                ch.name.includes('mod-log') ||
                ch.name.includes('modlog') ||
                ch.name.includes('audit-log') ||
                ch.name.includes('logs')
            );
        }

        if (!logChannel || !logChannel.isTextBased()) {
            console.warn('No usable mod-logs channel found, skipping log.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTimestamp()
            .setFooter({ text: `Case ID: ${Date.now().toString(36)}` });

        const modValue = `${action.moderator.tag} (${action.moderator.id})`;
        const targetValue = `${action.target.tag} (${action.target.id})`;

        switch (action.type) {
            case 'ban':
                embed.setColor('#ff0000').setTitle('🔨 Member Banned')
                    .addFields(
                        { name: 'User',      value: targetValue, inline: true },
                        { name: 'Moderator', value: modValue,    inline: true },
                        { name: 'Reason',    value: action.reason, inline: false }
                    );
                if (action.duration)  embed.addFields({ name: 'Duration', value: action.duration, inline: true });
                if (action.expiresAt) embed.addFields({ name: 'Expires',  value: `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:F>`, inline: true });
                if (action.purge_days > 0) embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'softban':
                embed.setColor('#ff9500').setTitle('🔨 Member Soft Banned')
                    .addFields(
                        { name: 'User',      value: targetValue,   inline: true },
                        { name: 'Moderator', value: modValue,      inline: true },
                        { name: 'Reason',    value: action.reason, inline: false }
                    );
                if (action.purge_days > 0) embed.addFields({ name: 'Messages Deleted', value: `${action.purge_days} days`, inline: true });
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'unban':
                embed.setColor('#00ff00').setTitle('🔓 Member Unbanned')
                    .addFields(
                        { name: 'User',      value: targetValue,   inline: true },
                        { name: 'Moderator', value: modValue,      inline: true },
                        { name: 'Reason',    value: action.reason, inline: false }
                    );
                break;

            case 'kick':
                embed.setColor('#ff6600').setTitle('👢 Member Kicked')
                    .addFields(
                        { name: 'User',      value: targetValue,   inline: true },
                        { name: 'Moderator', value: modValue,      inline: true },
                        { name: 'Reason',    value: action.reason, inline: false }
                    );
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'mute':
                embed.setColor('#ffa500').setTitle('🔇 Member Muted')
                    .addFields(
                        { name: 'User',      value: targetValue,                 inline: true },
                        { name: 'Moderator', value: modValue,                    inline: true },
                        { name: 'Reason',    value: action.reason,               inline: false },
                        { name: 'Duration',  value: action.duration || 'Unknown', inline: true }
                    );
                if (action.expiresAt) embed.addFields({ name: 'Expires', value: `<t:${Math.floor(action.expiresAt.getTime() / 1000)}:F>`, inline: true });
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'unmute':
                embed.setColor('#00ff99').setTitle('🔊 Member Unmuted')
                    .addFields(
                        { name: 'User',      value: targetValue,   inline: true },
                        { name: 'Moderator', value: modValue,      inline: true },
                        { name: 'Reason',    value: action.reason, inline: false }
                    );
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'warn':
                embed.setColor('#ffcc00').setTitle('⚠️ Member Warned')
                    .addFields(
                        { name: 'User',             value: targetValue,               inline: true  },
                        { name: 'Moderator',        value: modValue,                  inline: true  },
                        { name: 'Reason',           value: action.reason,             inline: false },
                        { name: 'Total Warnings',   value: `${action.totalWarnings}`, inline: true  },
                        { name: 'DM Sent',          value: action.dmSent ? '✅ Yes' : '❌ No', inline: true }
                    );
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;

            case 'warn_remove':
                embed.setColor('#00ccff').setTitle('🗑️ Warning Removed')
                    .addFields(
                        { name: 'User',              value: targetValue,               inline: true  },
                        { name: 'Moderator',         value: modValue,                  inline: true  },
                        { name: 'Removal Reason',    value: action.reason,             inline: false },
                        { name: 'Original Warning',  value: action.originalReason,     inline: false },
                        { name: 'Remaining Warnings',value: `${action.remaining}`,     inline: true  },
                        { name: 'DM Sent',           value: action.dmSent ? '✅ Yes' : '❌ No', inline: true }
                    );
                if (action.proof) {
                    embed.addFields({ name: 'Evidence', value: formatProofForLog(action.proof), inline: false });
                    if (action.proof.type === 'file' && action.proof.isImage) embed.setThumbnail(action.proof.url);
                }
                break;
        }

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Failed to log moderation action:', error);
    }
}

// ─── parseMembers ────────────────────────────────────────────────────────────
async function parseMembers(guild, input, allowHackBan = false) {
    const ids = input.split(/[\s,]+/).filter(Boolean);
    if (!ids.length) return { success: false, message: 'No users provided', targets: [] };

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

            if (!user) throw new Error('User not found');
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

// ─── Proof formatters ────────────────────────────────────────────────────────
function formatProofForDM(proofData) {
    if (!proofData) return 'None provided';
    if (proofData.type === 'file') {
        const emoji = proofData.isImage ? '🖼️' : '📄';
        return `${emoji} **${proofData.filename}**\n[Download](${proofData.url})`;
    }
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})`;
    return 'None provided';
}

function formatProofForLog(proofData) {
    if (!proofData) return 'None provided';
    if (proofData.type === 'file') {
        const emoji = proofData.isImage ? '🖼️' : '📄';
        const size = formatFileSize(proofData.size);
        return `${emoji} **${proofData.filename}** (${size})\n[View File](${proofData.url})\nUploaded: <t:${Math.floor(new Date(proofData.uploadedAt).getTime() / 1000)}:R>`;
    }
    if (proofData.type === 'url') return `🔗 [View Evidence](${proofData.url})\nDomain: ${proofData.domain}\nAdded: <t:${Math.floor(new Date(proofData.addedAt).getTime() / 1000)}:R>`;
    return 'None provided';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
    canModerate,
    validatePermissions,
    sendDM,
    logModeration,
    parseMembers,
    handleProofData,
    formatProofForDM,
    formatProofForLog
};