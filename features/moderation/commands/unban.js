// features/moderation/commands/unban.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { validatePermissions, logModeration, sendDM } = require('../utils/moderationUtils');

module.exports = {
    name: 'unban',
    description: 'Unban one or multiple members from the server',
    
    slashCommand: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User(s) to unban (ID or username#discriminator)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the unban')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('dm')
                .setDescription('Send DM to user about unban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        await this.executeUnban(interaction, {
            users: interaction.options.getString('user'),
            reason: interaction.options.getString('reason'),
            dm: interaction.options.getBoolean('dm') !== false // Default true
        });
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply('❌ **Usage:** `!unban <user(s)> <reason> [--no-dm]`');
        }

        const options = {
            users: args[0],
            reason: args.slice(1).filter(arg => !arg.startsWith('--')).join(' '),
            dm: !args.includes('--no-dm')
        };

        if (!options.reason) {
            return message.reply('❌ **Usage:** `!unban <user(s)> <reason> [--no-dm]`');
        }

        await this.executeUnban(message, options);
    },

    async executeUnban(context, options) {
        const guild = context.guild;
        const moderator = context.member || context.author;
        const isInteraction = context.replied !== undefined;

        // Validate permissions
        const permissionCheck = await validatePermissions(moderator, 'BAN_MEMBERS');
        if (!permissionCheck.success) {
            const reply = `❌ ${permissionCheck.message}`;
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }

        // Parse user identifiers
        const userIdentifiers = options.users.split(/[,\s]+/).filter(id => id.length > 0);
        
        if (userIdentifiers.length === 0) {
            const reply = '❌ Please provide at least one user ID or username.';
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }

        const results = {
            successful: [],
            failed: []
        };

        // Defer reply for interactions
        if (isInteraction) {
            await context.deferReply();
        }

        // Get current bans
        let bans;
        try {
            bans = await guild.bans.fetch();
        } catch (error) {
            console.error('Failed to fetch bans:', error);
            const reply = '❌ Failed to fetch server bans. Please check bot permissions.';
            return isInteraction ? context.editReply(reply) : context.reply(reply);
        }

        // Process each user identifier
        for (const identifier of userIdentifiers) {
            try {
                let targetUser = null;

                // Try to find by ID first
                if (/^\d{17,19}$/.test(identifier)) {
                    const banEntry = bans.get(identifier);
                    if (banEntry) {
                        targetUser = banEntry.user;
                    }
                } else {
                    // Try to find by username#discriminator or username
                    const banEntry = bans.find(ban => {
                        const user = ban.user;
                        return user.tag === identifier || 
                               user.username === identifier ||
                               user.displayName === identifier;
                    });
                    if (banEntry) {
                        targetUser = banEntry.user;
                    }
                }

                if (!targetUser) {
                    results.failed.push({
                        identifier,
                        reason: 'User not found in ban list'
                    });
                    continue;
                }

                // Perform unban
                await guild.members.unban(targetUser, `${options.reason} | Moderator: ${moderator.user.tag}`);

                // Send DM if requested
                if (options.dm) {
                    await sendDM(targetUser, {
                        type: 'unban',
                        guild: guild.name,
                        reason: options.reason,
                        moderator: moderator.user.username
                    });
                }

                results.successful.push({
                    user: targetUser
                });

                // Log moderation action
                await logModeration(guild, {
                    type: 'unban',
                    target: targetUser,
                    moderator: moderator.user,
                    reason: options.reason
                });

            } catch (error) {
                console.error(`Failed to unban ${identifier}:`, error);
                results.failed.push({
                    identifier,
                    reason: error.message
                });
            }
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🔓 Unban Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            const successList = results.successful.map(r => 
                `✅ **${r.user.tag}** (${r.user.id})`
            ).join('\n');
            
            embed.addFields({
                name: `Unbanned (${results.successful.length})`,
                value: successList,
                inline: false
            });
        }

        if (results.failed.length > 0) {
            const failedList = results.failed.map(r => 
                `❌ **${r.identifier}** - ${r.reason}`
            ).join('\n');
            
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: failedList,
                inline: false
            });
        }

        // Add details
        embed.addFields({
            name: 'Details',
            value: `**Reason:** ${options.reason}`,
            inline: false
        });

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};