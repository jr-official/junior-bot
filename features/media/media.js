// features/media/media.js
// Private personal media library for a fixed allow-list of users.
// See README.md in this folder.
const {
    Events, SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType
} = require('discord.js');
const config = require('./config/mediaConfig');
const accessService = require('./services/accessService');
const mediaService = require('./services/mediaService');
const interactionHandler = require('./handlers/interactionHandler');
const prefixHandler = require('./handlers/prefixHandler');
const { TYPES } = require('./utils/mediaUtils');

const slashCommand = new SlashCommandBuilder()
    .setName('media')
    .setDescription('Your private media library — browse, send and manage your stickers, images and GIFs')
    .addAttachmentOption(o => o.setName('file')
        .setDescription('Optional: upload a file to add it to your library')
        .setRequired(false))
    .addStringOption(o => o.setName('name')
        .setDescription('Name for the new item (used as !sticker_<name>)')
        .setMaxLength(config.NAME_MAX_LENGTH)
        .setRequired(false))
    .addStringOption(o => o.setName('type')
        .setDescription('Kind of item (stickers are resized to 320x320). Default: auto-detect')
        .addChoices(...TYPES.map(t => ({ name: t, value: t })))
        .setRequired(false))
    .addBooleanOption(o => o.setName('shared')
        .setDescription('True = add to / open the SHARED library that all allowed users can use')
        .setRequired(false))
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    )
    // GuildInstall: works where the bot is a member (servers, DM with the bot).
    // UserInstall: lets an allowed user add the app to their own account so /media
    // works in any DM / group DM / server (slash command only — bots get no message
    // events there, so !sticker_x cannot work in those places).
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);

const stickerCommand = new SlashCommandBuilder()
    .setName('sticker')
    .setDescription('Send one of your saved stickers/images/GIFs (works in any DM, even without the bot)')
    .addStringOption(o => o.setName('name')
        .setDescription('Name of the item to send')
        .setMaxLength(config.NAME_MAX_LENGTH)
        .setAutocomplete(true)
        .setRequired(true))
    .addStringOption(o => o.setName('library')
        .setDescription('Which library to send from (default: your own)')
        .addChoices({ name: 'my library', value: 'personal' }, { name: 'shared library', value: 'shared' })
        .setRequired(false))
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    )
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);

module.exports = (client) => {
    if (config.INVALID_USER_IDS.length) {
        console.warn('⚠️  [media] Ignoring invalid MEDIA_ALLOWED_USER_IDS entries:', config.INVALID_USER_IDS.join(', '));
    }
    if (!accessService.isEnabled()) {
        console.warn('⚠️  [media] MEDIA_ALLOWED_USER_IDS is empty — media library is DISABLED');
        return;
    }

    // Slash commands are registered together by the moderation feature (a single
    // commands.set() call replaces ALL global commands, so they must share one list).
    // Media must therefore be initialised BEFORE moderation in main.js.
    (client.extraSlashCommands ||= []).push(slashCommand, stickerCommand);

    client.once(Events.ClientReady, async () => {
        try {
            await mediaService.ensureIndexes();
        } catch (err) {
            console.error('❌ [media] Failed to create indexes:', err);
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        try {
            if (interaction.isAutocomplete()) {
                if (interaction.commandName === 'sticker') await interactionHandler.handleAutocomplete(interaction);
                return;
            }
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === 'media') await interactionHandler.handleSlash(interaction);
                else if (interaction.commandName === 'sticker') await interactionHandler.handleSticker(interaction);
                return;
            }
            const id = interaction.customId;
            if (typeof id !== 'string' || !id.startsWith('media:')) return;

            if (interaction.isModalSubmit()) await interactionHandler.handleModal(interaction);
            else if (interaction.isMessageComponent()) await interactionHandler.handleComponent(interaction);
        } catch (err) {
            console.error('❌ [media] Interaction error:', err);
        }
    });

    client.on(Events.MessageCreate, (message) => {
        prefixHandler.handle(message).catch(err => console.error('❌ [media] Prefix error:', err));
    });

    console.log(`🖼️ Media library initialized for ${config.ALLOWED_USER_IDS.size} user(s)`);
};
