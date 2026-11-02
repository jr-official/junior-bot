// features/roles/roles.js
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const roleConfigs = require('./config/roleConfigs');

const EMBED_COLOR = 0x5037CF;

// FIX: a unique footer tag stamped on every role panel embed so cleanup can
// identify them precisely without relying on title-word matching (which could
// accidentally delete unrelated bot embeds whose titles contain "Roles",
// "Location", "Interest", or "Ping").
const ROLE_PANEL_FOOTER_TAG = 'role-panel-v1';

const CATEGORY_IMAGES = {
    location: 'https://media.discordapp.net/attachments/1200439850013298780/1392884868207087666/Location_Roles_Banner.png?ex=6871289f&is=686fd71f&hm=fb4074f459ee8d44322705e1c2a47826f34bd2ebc90e0c05c620be7fffcdf458&=&format=webp&quality=lossless&width=1730&height=576',
    interest: 'https://media.discordapp.net/attachments/1200439850013298780/1392884867603103805/Interest_Roles_Banner.png?ex=6871289e&is=686fd71e&hm=009fdb9818569f6d2ce9e47220bdb8295a26cb0d7b27d1366282718516b37b80&=&format=webp&quality=lossless&width=1730&height=576',
    ping: 'https://media.discordapp.net/attachments/1200439850013298780/1392884868916183191/Ping_Roles_Banner.png?ex=6871289f&is=686fd71f&hm=1f4192bb98e4e21d6f9ff3b4888cdd91cfa0425c174e5b98d281fdd190475d21&=&format=webp&quality=lossless&width=1730&height=576'
};

function createSelectMenu(roleType, config) {
    return new StringSelectMenuBuilder()
        .setCustomId(`role_select_${roleType}`)
        .setPlaceholder(config.placeholder)
        .setMinValues(config.multiSelect ? 0 : 1)
        .setMaxValues(config.multiSelect ? config.options.length : 1)
        .addOptions(config.options.map(option => ({
            label: option.label,
            value: option.value,
            description: option.description,
            emoji: option.emoji,
            default: !config.multiSelect && (option.default || false)
        })));
}

async function cleanupOldRolePanels(channel, botId) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });

        // FIX: previously matched on embed title keywords ("Roles", "Location", etc.)
        // which could delete any bot embed with those words in its title. Now we match
        // on the ROLE_PANEL_FOOTER_TAG stamped into the footer of every panel we send.
        // Old panels (pre-tag) are identified by the select menu customId pattern as a
        // fallback so a single !roles-setup cleans up legacy panels too.
        const rolePanelMessages = messages.filter(msg => {
            if (msg.author.id !== botId) return false;
            if (!msg.embeds.length || !msg.components.length) return false;

            // Primary: match the footer tag we stamp on all new panels
            const hasFooterTag = msg.embeds.some(e => e.footer?.text === ROLE_PANEL_FOOTER_TAG);
            if (hasFooterTag) return true;

            // Fallback: legacy panels (no footer tag) identified by select menu customId
            const hasRoleSelectMenu = msg.components.some(row =>
                row.components?.some(c => c.customId?.startsWith('role_select_'))
            );
            return hasRoleSelectMenu;
        });

        if (rolePanelMessages.size === 0) return;

        let deleted = 0;
        for (const message of rolePanelMessages.values()) {
            try {
                await message.delete();
                deleted++;
                if (deleted < rolePanelMessages.size) {
                    await new Promise(resolve => setTimeout(resolve, 600));
                }
            } catch (err) {
                console.error(`❌ Failed to delete old role panel message ${message.id}:`, err.message);
            }
        }

        console.log(`🧹 Cleaned up ${deleted} old role panel messages`);
    } catch (error) {
        console.error('❌ Error cleaning up old role panels:', error);
    }
}

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return; // guild-only; DMs are enabled for other features
        if (!message.content.startsWith('!roles-setup')) return;

        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permissions to use this command.');
        }

        try {
            const confirmationMsg = await message.reply('🔄 Setting up role panels... (Cleaning up old panels first)');
            await cleanupOldRolePanels(message.channel, client.user.id);
            await message.delete();
            await confirmationMsg.delete();

            for (const [roleType, config] of Object.entries(roleConfigs)) {
                const embed = new EmbedBuilder()
                    .setTitle(config.title)
                    .setColor(EMBED_COLOR)
                    .setDescription(config.description || null)
                    .setImage(CATEGORY_IMAGES[roleType])
                    // FIX: stamp every panel with our unique footer tag so future
                    // cleanup runs can identify them without title-word guessing.
                    .setFooter({ text: ROLE_PANEL_FOOTER_TAG });

                const row = new ActionRowBuilder().addComponents(createSelectMenu(roleType, config));
                await message.channel.send({ embeds: [embed], components: [row] });
                console.log(`✅ Role panel "${roleType}" set up by ${message.author.tag}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('🎭 All role panels set up successfully');
        } catch (error) {
            console.error('❌ Error setting up role panels:', error);
            await message.channel.send('❌ There was an error setting up the role panels.').catch(console.error);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu()) return;
        if (!interaction.customId.startsWith('role_select_')) return;

        const roleType = interaction.customId.replace('role_select_', '');
        const config   = roleConfigs[roleType];

        if (!config) {
            return interaction.reply({
                content: '❌ Invalid role configuration.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const selectedValues = interaction.values;
            const member         = interaction.member;
            const guild          = interaction.guild;

            const allRoleIds   = config.options.filter(opt => opt.roleId).map(opt => opt.roleId);
            const currentRoles = member.roles.cache.filter(role => allRoleIds.includes(role.id));

            if (config.multiSelect) {
                const selectedOptions = config.options.filter(opt => selectedValues.includes(opt.value) && opt.roleId);
                const selectedRoleIds = selectedOptions.map(opt => opt.roleId);

                const rolesToRemove = currentRoles.filter(role => !selectedRoleIds.includes(role.id));
                if (rolesToRemove.size > 0) await member.roles.remove(rolesToRemove);

                const currentRoleIds = currentRoles.map(role => role.id);
                const rolesToAdd     = selectedRoleIds.filter(roleId => !currentRoleIds.includes(roleId));
                if (rolesToAdd.length > 0) await member.roles.add(rolesToAdd);

                const feedbackContent = selectedOptions.length > 0
                    ? `✅ Successfully updated your ${config.title.toLowerCase()}! You now have: **${selectedOptions.map(opt => opt.label).join(', ')}**`
                    : `✅ Successfully removed all ${config.title.toLowerCase()}!`;

                await interaction.editReply({ content: feedbackContent });
                console.log(`🎭 ${member.user.tag} updated ${roleType} roles: ${selectedOptions.map(opt => opt.label).join(', ')}`);

            } else {
                const selectedValue  = selectedValues[0];
                const selectedOption = config.options.find(opt => opt.value === selectedValue);

                if (!selectedOption) {
                    return interaction.editReply({ content: '❌ Invalid selection.' });
                }

                if (selectedOption.roleId && currentRoles.has(selectedOption.roleId)) {
                    await member.roles.remove(selectedOption.roleId);
                    await interaction.editReply({ content: `✅ Successfully removed the **${selectedOption.label}** role!` });
                    console.log(`🎭 ${member.user.tag} removed "${selectedOption.label}" role for ${roleType}`);
                    return;
                }

                if (selectedOption.roleId && currentRoles.size > 0) {
                    await member.roles.remove(currentRoles);
                }

                if (selectedOption.roleId) {
                    const roleToAdd = guild.roles.cache.get(selectedOption.roleId);
                    if (!roleToAdd) {
                        return interaction.editReply({ content: '❌ The selected role could not be found.' });
                    }
                    await member.roles.add(roleToAdd);
                    await interaction.editReply({ content: `✅ Successfully assigned you the **${selectedOption.label}** role!` });
                } else {
                    if (currentRoles.size > 0) await member.roles.remove(currentRoles);
                    await interaction.editReply({
                        content: `✅ Successfully updated your ${config.title.toLowerCase()} preference to **${selectedOption.label}**!`
                    });
                }

                console.log(`🎭 ${member.user.tag} selected "${selectedOption.label}" for ${roleType}`);
            }
        } catch (error) {
            console.error('❌ Error handling role selection:', error);
            await interaction.editReply({ content: '❌ There was an error updating your roles.' });
        }
    });

    console.log('🎭 Roles feature loaded!');
};