// features/moderation/commands/ban.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseDuration, formatDuration } = require('../utils/durationParser');
const { 
    canModerate, 
    sendDM, 
    logModeration, 
    parseMembers,
    validatePermissions 
} = require('../utils/moderationUtils');

module.exports = {
    name: 'ban',
    description: 'Ban one or multiple members from the server',
    
    slashCommand: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Ban one or multiple members')
                .addStringOption(option =>
                    option.setName('user')
                        .setDescription('User(s) to ban (mention, ID, or username)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Reason for the ban')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Duration of ban (e.g., 1d, 1w, 1m, permanent)')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('soft')
                        .setDescription('Soft ban (ban then immediately unban to delete messages)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('purge_days')
                        .setDescription('Days of messages to delete (0-7)')
                        .setMinValue(0)
                        .setMaxValue(7)
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('hack')
                        .setDescription('Force ban user not in server')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('dm')
                        .setDescription('Send DM to user about ban')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('proof')
                        .setDescription('Evidence/proof URL')
                        .setRequired(false)))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async executeSlash(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'add') {
            await this.executeBan(interaction, {
                users: interaction.options.getString('user'),
                reason: interaction.options.getString('reason'),
                duration: interaction.options.getString('duration'),
                soft: interaction.options.getBoolean('soft') || false,
                purge_days: interaction.options.getInteger('purge_days') || 0,
                hack: interaction.options.getBoolean('hack') || false,
                dm: interaction.options.getBoolean('dm') !== false, // Default true
                proof: interaction.options.getString('proof')
            });
        }
    },

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply('❌ **Usage:** `!ban <user(s)> <reason> [duration] [--soft] [--purge-days=N] [--hack] [--no-dm] [--proof=URL]`');
        }

        // Parse arguments
        const options = {
            users: args[0],
            reason: '',
            duration: null,
            soft: false,
            purge_days: 0,
            hack: false,
            dm: true,
            proof: null
        };

        let reasonIndex = 1;
        let reasonParts = [];

        // Parse flags and collect reason
        for (let i = 1; i < args.length; i++) {
            const arg = args[i];
            
            if (arg.startsWith('--')) {
                // Handle flags
                if (arg === '--soft') {
                    options.soft = true;
                } else if (arg === '--hack') {
                    options.hack = true;
                } else if (arg === '--no-dm') {
                    options.dm = false;
                } else if (arg.startsWith('--purge-days=')) {
                    const days = parseInt(arg.split('=')[1]);
                    if (!isNaN(days) && days >= 0 && days <= 7) {
                        options.purge_days = days;
                    }
                } else if (arg.startsWith('--proof=')) {
                    options.proof = arg.split('=')[1];
                }
            } else {
                // Check if it's a duration (contains time units)
                if (i === reasonIndex && /^(\d+[smhdwmy])+$/i.test(arg)) {
                    options.duration = arg;
                    reasonIndex++;
                } else {
                    reasonParts.push(arg);
                }
            }
        }

        options.reason = reasonParts.join(' ');
        
        if (!options.reason) {
            return message.reply('❌ **Usage:** `!ban <user(s)> <reason> [duration] [--soft] [--purge-days=N] [--hack] [--no-dm] [--proof=URL]`');
        }

        await this.executeBan(message, options);
    },

    async executeBan(context, options) {
        const guild = context.guild;
        const moderator = context.member || context.author;
        const isInteraction = context.replied !== undefined;

        // Validate permissions
        const permissionCheck = await validatePermissions(moderator, 'BAN_MEMBERS');
        if (!permissionCheck.success) {
            const reply = `❌ ${permissionCheck.message}`;
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }

        // Parse duration
        let duration = null;
        let durationMs = null;
        let expiresAt = null;

        if (options.duration) {
            const parsed = parseDuration(options.duration);
            if (!parsed.success) {
                const reply = `❌ Invalid duration format. Use formats like: 1d, 1w, 1m, permanent`;
                return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
            }
            duration = parsed.duration;
            durationMs = parsed.ms;
            expiresAt = parsed.ms ? new Date(Date.now() + parsed.ms) : null;
        }

        // Parse members
        const memberResult = await parseMembers(guild, options.users, options.hack);
        if (!memberResult.success) {
            const reply = `❌ ${memberResult.message}`;
            return isInteraction ? context.reply({ content: reply, ephemeral: true }) : context.reply(reply);
        }

        const targets = memberResult.targets;
        const results = {
            successful: [],
            failed: []
        };

        // Defer reply for interactions
        if (isInteraction) {
            await context.deferReply();
        }

        // Process each target
        for (const target of targets) {
            try {
                // Check if we can moderate this user
                if (target.member) {
                    const canMod = await canModerate(moderator, target.member);
                    if (!canMod.success) {
                        results.failed.push({
                            user: target.user,
                            reason: canMod.message
                        });
                        continue;
                    }
                }

                // Send DM before ban
                if (options.dm && target.user) {
                    await sendDM(target.user, {
                        type: 'ban',
                        guild: guild.name,
                        reason: options.reason,
                        duration: duration,
                        moderator: moderator.user.username,
                        proof: options.proof
                    });
                }

                // Perform ban
                await guild.members.ban(target.user, {
                    reason: `${options.reason} | Moderator: ${moderator.user.tag}`,
                    deleteMessageDays: options.purge_days
                });

                // Handle soft ban
                if (options.soft) {
                    await guild.members.unban(target.user, `Soft ban completed | Moderator: ${moderator.user.tag}`);
                }

                results.successful.push({
                    user: target.user,
                    member: target.member
                });

                // Log moderation action
                await logModeration(guild, {
                    type: options.soft ? 'softban' : 'ban',
                    target: target.user,
                    moderator: moderator.user,
                    reason: options.reason,
                    duration: duration,
                    expiresAt: expiresAt,
                    proof: options.proof,
                    purge_days: options.purge_days
                });

            } catch (error) {
                console.error(`Failed to ban ${target.user?.tag || target.id}:`, error);
                results.failed.push({
                    user: target.user,
                    reason: error.message
                });
            }
        }

        // Create response embed
        const embed = new EmbedBuilder()
            .setColor(options.soft ? '#ff9500' : '#ff0000')
            .setTitle(options.soft ? '🔨 Soft Ban Results' : '🔨 Ban Results')
            .setTimestamp()
            .setFooter({ text: `Moderator: ${moderator.user.tag}`, iconURL: moderator.user.displayAvatarURL() });

        if (results.successful.length > 0) {
            const successList = results.successful.map(r => 
                `✅ **${r.user.tag}** (${r.user.id})`
            ).join('\n');
            
            embed.addFields({
                name: `${options.soft ? 'Soft Banned' : 'Banned'} (${results.successful.length})`,
                value: successList,
                inline: false
            });
        }

        if (results.failed.length > 0) {
            const failedList = results.failed.map(r => 
                `❌ **${r.user?.tag || 'Unknown'}** - ${r.reason}`
            ).join('\n');
            
            embed.addFields({
                name: `Failed (${results.failed.length})`,
                value: failedList,
                inline: false
            });
        }

        // Add details
        const details = [];
        details.push(`**Reason:** ${options.reason}`);
        if (duration) details.push(`**Duration:** ${formatDuration(duration)}`);
        if (options.purge_days > 0) details.push(`**Messages Deleted:** ${options.purge_days} days`);
        if (options.proof) details.push(`**Proof:** [View Evidence](${options.proof})`);

        embed.addFields({
            name: 'Details',
            value: details.join('\n'),
            inline: false
        });

        const reply = { embeds: [embed] };
        return isInteraction ? context.editReply(reply) : context.reply(reply);
    }
};