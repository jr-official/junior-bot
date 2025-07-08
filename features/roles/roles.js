// features/roles/roles.js
const { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const roleConfigs = require('./config/roleConfigs');

module.exports = (client) => {
    // Handle prefix command for setting up role panels
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.content.startsWith('!role-setup')) return;
        
        // Check if user has admin permissions
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permissions to use this command.');
        }
        
        try {
            // Send all role panels
            for (const [roleType, config] of Object.entries(roleConfigs)) {
                const embed = new EmbedBuilder()
                    .setTitle(config.title)
                    .setColor(config.color)
                    .setDescription(config.description || null);
                
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`role_select_${roleType}`)
                    .setPlaceholder(config.placeholder)
                    .addOptions(config.options.map(option => ({
                        label: option.label,
                        value: option.value,
                        description: option.description,
                        emoji: option.emoji,
                        default: option.default || false
                    })));
                
                const row = new ActionRowBuilder().addComponents(selectMenu);
                
                await message.channel.send({
                    embeds: [embed],
                    components: [row]
                });
                
                console.log(`✅ Role panel "${roleType}" set up by ${message.author.tag}`);
            }
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
                const selectedValue = interaction.values[0];
                const selectedOption = config.options.find(opt => opt.value === selectedValue);
                
                if (!selectedOption) {
                    return interaction.reply({
                        content: '❌ Invalid selection.',
                        ephemeral: true
                    });
                }
                
                const member = interaction.member;
                const guild = interaction.guild;
                
                // Get all role IDs for this category to remove them first
                const allRoleIds = config.options
                    .filter(opt => opt.roleId)
                    .map(opt => opt.roleId);
                
                // Check if user currently has any roles from this category
                const currentRoles = member.roles.cache.filter(role => 
                    allRoleIds.includes(role.id)
                );
                
                // If selecting a role they already have, remove it and reset to default
                if (selectedOption.roleId && currentRoles.has(selectedOption.roleId)) {
                    await member.roles.remove(selectedOption.roleId);
                    
                    // Update the dropdown to show default selection
                    const updatedOptions = config.options.map(option => ({
                        label: option.label,
                        value: option.value,
                        description: option.description,
                        emoji: option.emoji,
                        default: option.default || false
                    }));
                    
                    const updatedSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`role_select_${roleType}`)
                        .setPlaceholder(config.placeholder)
                        .addOptions(updatedOptions);
                    
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
                
                // Remove existing roles from this category (but don't remove all if selecting Global)
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
                    
                    // Update the dropdown to show default selection
                    const updatedOptions = config.options.map(option => ({
                        label: option.label,
                        value: option.value,
                        description: option.description,
                        emoji: option.emoji,
                        default: option.default || false
                    }));
                    
                    const updatedSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`role_select_${roleType}`)
                        .setPlaceholder(config.placeholder)
                        .addOptions(updatedOptions);
                    
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
                    const allRoleIds = config.options
                        .filter(opt => opt.roleId)
                        .map(opt => opt.roleId);
                    
                    const rolesToRemove = member.roles.cache.filter(role => 
                        allRoleIds.includes(role.id)
                    );
                    
                    if (rolesToRemove.size > 0) {
                        await member.roles.remove(rolesToRemove);
                    }
                    
                    // Update the dropdown to show default selection
                    const updatedOptions = config.options.map(option => ({
                        label: option.label,
                        value: option.value,
                        description: option.description,
                        emoji: option.emoji,
                        default: option.default || false
                    }));
                    
                    const updatedSelectMenu = new StringSelectMenuBuilder()
                        .setCustomId(`role_select_${roleType}`)
                        .setPlaceholder(config.placeholder)
                        .addOptions(updatedOptions);
                    
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