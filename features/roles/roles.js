// features/roles/roles.js
const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const roleConfigs = require('./config/roleConfigs');

// Common embed color (purple from location roles)
const EMBED_COLOR = 0x5037CF;

// Image URLs for each category
const CATEGORY_IMAGES = {
    location: 'https://media.discordapp.net/attachments/1200439850013298780/1392884868207087666/Location_Roles_Banner.png?ex=6871289f&is=686fd71f&hm=fb4074f459ee8d44322705e1c2a47826f34bd2ebc90e0c05c620be7fffcdf458&=&format=webp&quality=lossless&width=1730&height=576',
    interest: 'https://media.discordapp.net/attachments/1200439850013298780/1392884867603103805/Interest_Roles_Banner.png?ex=6871289e&is=686fd71e&hm=009fdb9818569f6d2ce9e47220bdb8295a26cb0d7b27d1366282718516b37b80&=&format=webp&quality=lossless&width=1730&height=576',
    ping: 'https://media.discordapp.net/attachments/1200439850013298780/1392884868916183191/Ping_Roles_Banner.png?ex=6871289f&is=686fd71f&hm=1f4192bb98e4e21d6f9ff3b4888cdd91cfa0425c174e5b98d281fdd190475d21&=&format=webp&quality=lossless&width=1730&height=576'
};

// Helper function to create select menu
function createSelectMenu(roleType, config, selectedValues = []) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`role_select_${roleType}`)
        .setPlaceholder(config.placeholder)
        .setMinValues(config.multiSelect ? 0 : 1)
        .setMaxValues(config.multiSelect ? config.options.length : 1)
        .addOptions(config.options.map(option => ({
            label: option.label,
            value: option.value,
            description: option.description,
            emoji: option.emoji,
            default: config.multiSelect ? selectedValues.includes(option.value) : (option.default || false)
        })));

    return selectMenu;
}

// Helper function to clean up old role panels
async function cleanupOldRolePanels(channel, botId) {
    try {
        // Fetch messages from the channel
        const messages = await channel.messages.fetch({ limit: 100 });

        // Filter for bot messages that contain role panels (have embeds and components)
        const rolePanelMessages = messages.filter(msg =>
            msg.author.id === botId &&
            msg.embeds.length > 0 &&
            msg.components.length > 0 &&
            msg.embeds[0].title &&
            (msg.embeds[0].title.includes('Roles') || msg.embeds[0].title.includes('Location') || msg.embeds[0].title.includes('Interest') || msg.embeds[0].title.includes('Ping'))
        );

        if (rolePanelMessages.size > 0) {
            // Delete old role panel messages
            for (const message of rolePanelMessages.values()) {
                await message.delete();
            }
            console.log(`🧹 Cleaned up ${rolePanelMessages.size} old role panel messages`);
        }
    } catch (error) {
        console.error('❌ Error cleaning up old role panels:', error);
        // Don't throw error - continue with setup even if cleanup fails
    }
}

module.exports = (client) => {
    // Handle prefix command for setting up role panels
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.content.startsWith('!roles-setup')) return;

        // Check if user has admin permissions
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permissions to use this command.');
        }

        try {
            // Send confirmation message
            const confirmationMsg = await message.reply('🔄 Setting up role panels... (Cleaning up old panels first)');

            // Clean up old role panels
            await cleanupOldRolePanels(message.channel, client.user.id);

            // Delete the command message and confirmation message
            await message.delete();
            await confirmationMsg.delete();

            // Send all role panels with a small delay between each
            for (const [roleType, config] of Object.entries(roleConfigs)) {
                const embed = new EmbedBuilder()
                    .setTitle(config.title)
                    .setColor(EMBED_COLOR)
                    .setDescription(config.description || null)
                    .setImage(CATEGORY_IMAGES[roleType]);

                const selectMenu = createSelectMenu(roleType, config);
                const row = new ActionRowBuilder().addComponents(selectMenu);

                await message.channel.send({
                    embeds: [embed],
                    components: [row]
                });

                console.log(`✅ Role panel "${roleType}" set up by ${message.author.tag}`);

                // Small delay to prevent rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('🎭 All role panels set up successfully');
        } catch (error) {
            console.error('❌ Error setting up role panels:', error);
            await message.reply('❌ There was an error setting up the role panels.');
        }
    });

    // Handle dropdown selections
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu()) return;

        if (interaction.customId.startsWith('role_select_')) {
            const roleType = interaction.customId.replace('role_select_', '');
            const config = roleConfigs[roleType];

            if (!config) {
                return interaction.reply({
                    content: '❌ Invalid role configuration.',
                    ephemeral: true
                });
            }

            try {
                const selectedValues = interaction.values;
                const member = interaction.member;
                const guild = interaction.guild;

                // Get all role IDs for this category
                const allRoleIds = config.options
                    .filter(opt => opt.roleId)
                    .map(opt => opt.roleId);

                // Get current roles from this category
                const currentRoles = member.roles.cache.filter(role =>
                    allRoleIds.includes(role.id)
                );

                if (config.multiSelect) {
                    // Handle multiple selection categories (interest and ping)
                    const selectedOptions = config.options.filter(opt =>
                        selectedValues.includes(opt.value) && opt.roleId
                    );

                    // Remove all current roles from this category
                    if (currentRoles.size > 0) {
                        await member.roles.remove(currentRoles);
                    }

                    // Add selected roles
                    if (selectedOptions.length > 0) {
                        const rolesToAdd = selectedOptions.map(opt => opt.roleId);
                        await member.roles.add(rolesToAdd);
                    }

                    // Update the dropdown to show current selections
                    const updatedSelectMenu = createSelectMenu(roleType, config, selectedValues);
                    const updatedRow = new ActionRowBuilder().addComponents(updatedSelectMenu);

                    // Send feedback message
                    let feedbackContent;
                    if (selectedOptions.length > 0) {
                        const roleNames = selectedOptions.map(opt => opt.label).join(', ');
                        feedbackContent = `✅ Successfully updated your ${config.title.toLowerCase()}! You now have: **${roleNames}**`;
                    } else {
                        feedbackContent = `✅ Successfully removed all ${config.title.toLowerCase()}!`;
                    }

                    await interaction.update({
                        components: [updatedRow]
                    });

                    await interaction.followUp({
                        content: feedbackContent,
                        ephemeral: true
                    });

                    console.log(`🎭 ${member.user.tag} updated ${roleType} roles: ${selectedOptions.map(opt => opt.label).join(', ')}`);
                } else {
                    // Handle single selection categories (location)
                    const selectedValue = selectedValues[0];
                    const selectedOption = config.options.find(opt => opt.value === selectedValue);

                    if (!selectedOption) {
                        return interaction.reply({
                            content: '❌ Invalid selection.',
                            ephemeral: true
                        });
                    }

                    // If selecting a role they already have, remove it and reset to default
                    if (selectedOption.roleId && currentRoles.has(selectedOption.roleId)) {
                        await member.roles.remove(selectedOption.roleId);

                        // Reset dropdown to default (Global)
                        const updatedSelectMenu = createSelectMenu(roleType, config);
                        const updatedRow = new ActionRowBuilder().addComponents(updatedSelectMenu);

                        await interaction.update({
                            components: [updatedRow]
                        });

                        await interaction.followUp({
                            content: `✅ Successfully removed the **${selectedOption.label}** role!`,
                            ephemeral: true
                        });

                        console.log(`🎭 ${member.user.tag} removed "${selectedOption.label}" role for ${roleType}`);
                        return;
                    }

                    // Remove existing roles from this category
                    if (selectedOption.roleId && currentRoles.size > 0) {
                        await member.roles.remove(currentRoles);
                    }

                    // Add the selected role (if it has a roleId)
                    if (selectedOption.roleId) {
                        const roleToAdd = guild.roles.cache.get(selectedOption.roleId);

                        if (!roleToAdd) {
                            return interaction.reply({
                                content: '❌ The selected role could not be found.',
                                ephemeral: true
                            });
                        }

                        await member.roles.add(roleToAdd);

                        // Keep the dropdown showing the selected option
                        const updatedSelectMenu = createSelectMenu(roleType, config, [selectedValue]);
                        const updatedRow = new ActionRowBuilder().addComponents(updatedSelectMenu);

                        await interaction.update({
                            components: [updatedRow]
                        });

                        await interaction.followUp({
                            content: `✅ Successfully assigned you the **${selectedOption.label}** role!`,
                            ephemeral: true
                        });
                    } else {
                        // Handle Global option - remove all location roles
                        if (currentRoles.size > 0) {
                            await member.roles.remove(currentRoles);
                        }

                        // Reset dropdown to default (Global)
                        const updatedSelectMenu = createSelectMenu(roleType, config);
                        const updatedRow = new ActionRowBuilder().addComponents(updatedSelectMenu);

                        await interaction.update({
                            components: [updatedRow]
                        });

                        await interaction.followUp({
                            content: `✅ Successfully updated your ${config.title.toLowerCase()} preference to **${selectedOption.label}**!`,
                            ephemeral: true
                        });
                    }

                    console.log(`🎭 ${member.user.tag} selected "${selectedOption.label}" for ${roleType}`);
                }
            } catch (error) {
                console.error('❌ Error handling role selection:', error);
                await interaction.reply({
                    content: '❌ There was an error updating your roles.',
                    ephemeral: true
                });
            }
        }
    });

    console.log('🎭 Roles feature loaded');
};