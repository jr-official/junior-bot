// features/tickets/services/transcriptService.js
//
// Fixes vs previous version:
//
// 1. Image downloads are now concurrency-limited (max 5 simultaneous fetches)
//    so a ticket with many images cannot exhaust memory or hit CDN rate limits.
//
// 2. ticketMetadata is accepted as an optional external argument from the caller
//    (TicketService.ticketMetadata) with the private map kept as a fallback.

const { Buffer } = require('buffer');
const { EmbedBuilder } = require('discord.js');
const htmlUtils = require('../utils/htmlUtils');
const CONFIG    = require('../config/config');

// Maximum simultaneous image downloads per transcript generation
const IMAGE_DOWNLOAD_CONCURRENCY = 5;

/**
 * Runs an array of async tasks with a maximum concurrency limit.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} limit
 * @returns {Promise<Array<any>>}
 */
async function runWithConcurrencyLimit(tasks, limit) {
    const results  = new Array(tasks.length);
    const iterator = tasks.entries();
    let done       = false;

    async function worker() {
        while (!done) {
            const next = iterator.next();
            if (next.done) { done = true; return; }
            const [index, task] = next.value;
            try {
                results[index] = await task();
            } catch (err) {
                results[index] = null;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

class TranscriptService {
    constructor(ticketTypes) {
        this.TICKET_TYPES   = ticketTypes;
        this._localMetadata = new Map();
    }

    // ── Attachment helpers ────────────────────────────────────────────────────

    isImageAttachment(attachment) {
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
        return imageExts.some(ext =>
            attachment.name.toLowerCase().endsWith(ext) ||
            attachment.contentType?.startsWith('image/')
        );
    }

    isVideoAttachment(attachment) {
        const videoExts = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
        return videoExts.some(ext =>
            attachment.name.toLowerCase().endsWith(ext) ||
            attachment.contentType?.startsWith('video/')
        );
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Downloads an image and returns a base64 data URI so that the transcript
     * HTML file is fully self-contained and does not depend on Discord CDN links
     * that will expire.
     */
    async downloadAndEncodeImage(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer      = await response.arrayBuffer();
            const base64      = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'image/png';
            return `data:${contentType};base64,${base64}`;
        } catch (error) {
            console.error('Failed to download/encode image:', error);
            return null;
        }
    }

    getUserAvatarUrl(user) {
        if (user.displayAvatarURL) return user.displayAvatarURL({ format: 'png', size: 128 });
        const discriminator = user.discriminator === '0'
            ? ((BigInt(user.id) >> 22n) % 6n).toString()
            : parseInt(user.discriminator) % 5;
        return `https://cdn.discordapp.com/embed/avatars/${discriminator}.png`;
    }

    discordColorToHex(color) {
        if (!color) return '#7289da';
        if (typeof color === 'string') return color;
        return `#${color.toString(16).padStart(6, '0')}`;
    }

    // ── Main transcript generator ─────────────────────────────────────────────

    /**
     * @param {import('discord.js').TextChannel} channel
     * @param {object} ticketCreator      – Discord User object
     * @param {Map}    [externalMetadata] – TicketService.ticketMetadata
     */
    async generateTranscript(channel, ticketCreator, externalMetadata) {
        if (!channel?.messages) {
            console.error('Invalid channel provided for transcript generation');
            return null;
        }

        try {
            // ── Fetch all messages ────────────────────────────────────────────
            const messages = [];
            let lastMessageId;
            let requestCount = 0;

            while (true) {
                if (requestCount > 0 && requestCount % CONFIG.RATE_LIMIT_REQUESTS === 0) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY_MS));
                }

                const options = { limit: CONFIG.MESSAGE_FETCH_LIMIT };
                if (lastMessageId) options.before = lastMessageId;

                const batch = await channel.messages.fetch(options).catch(err => {
                    console.error('Error fetching messages:', err);
                    return new Map();
                });

                if (batch.size === 0) break;
                messages.push(...batch.values());
                lastMessageId = batch.lastKey();
                requestCount++;
            }

            messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

            // ── Pre-download all images with concurrency limit ────────────────
            // Collect every image attachment URL in order so we can resolve them
            // all up-front (bounded concurrency) before building the HTML string.
            const imageAttachments = []; // { messageId, attachmentId, url }
            for (const message of messages) {
                for (const attachment of message.attachments.values()) {
                    if (this.isImageAttachment(attachment)) {
                        imageAttachments.push({
                            messageId:    message.id,
                            attachmentId: attachment.id,
                            url:          attachment.url
                        });
                    }
                }
            }

            const downloadTasks  = imageAttachments.map(a => () => this.downloadAndEncodeImage(a.url));
            const downloadedUris = await runWithConcurrencyLimit(downloadTasks, IMAGE_DOWNLOAD_CONCURRENCY);

            // Build a lookup: attachmentId → data URI (or null if download failed)
            const imageDataUris = new Map();
            for (let i = 0; i < imageAttachments.length; i++) {
                imageDataUris.set(imageAttachments[i].attachmentId, downloadedUris[i]);
            }

            // ── Resolve metadata ──────────────────────────────────────────────
            const metaMap  = externalMetadata || this._localMetadata;
            const metadata = metaMap.get(channel.id) || {};

            const ticketType = metadata.type    || channel.name.split('-')[0];
            const createdAt  = new Date(metadata.createdAt || channel.createdTimestamp);
            const closedAt   = new Date();

            const safeCreator = {
                username:      ticketCreator?.username      || 'Unknown',
                discriminator: ticketCreator?.discriminator || '0000'
            };

            // ── Build HTML ────────────────────────────────────────────────────
            let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ticket Transcript - ${htmlUtils.sanitize(channel.name)}</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'gg sans', 'Noto Sans', Helvetica, Arial, sans-serif; background: #313338; color: #dbdee1; margin: 0; padding: 20px; line-height: 1.375; }
        .header { background: #2b2d31; padding: 24px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #1e1f22; }
        .header h1 { color: #5865f2; margin: 0 0 16px 0; font-size: 24px; font-weight: 600; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .info-item { background: #1e1f22; padding: 16px; border-radius: 6px; border: 1px solid #26282c; }
        .info-label { font-weight: 600; color: #b5bac1; font-size: 12px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.5px; }
        .info-value { color: #dbdee1; font-size: 14px; font-weight: 500; }
        .messages { background: #2b2d31; border-radius: 8px; padding: 20px; border: 1px solid #1e1f22; }
        .messages h2 { color: #dbdee1; margin: 0 0 20px 0; font-size: 20px; font-weight: 600; }
        .message { margin-bottom: 17px; display: flex; position: relative; padding-left: 72px; min-height: 44px; }
        .message:hover { background: rgba(4,4,5,.07); border-radius: 4px; margin-left: -8px; margin-right: -8px; padding-left: 80px; padding-top: 2px; padding-bottom: 2px; }
        .avatar { position: absolute; left: 16px; top: 0; width: 40px; height: 40px; border-radius: 50%; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .avatar-fallback { width: 40px; height: 40px; border-radius: 50%; background: #5865f2; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 16px; }
        .message-content { flex: 1; min-width: 0; }
        .message-header { display: flex; align-items: center; margin-bottom: 2px; line-height: 1.375; }
        .username { font-weight: 600; color: #dbdee1; margin-right: 8px; font-size: 16px; }
        .bot-tag { background: #5865f2; color: #fff; font-size: 10px; font-weight: 600; padding: 1px 4px; border-radius: 3px; text-transform: uppercase; margin-left: 4px; margin-right: 8px; }
        .timestamp { color: #949ba4; font-size: 12px; font-weight: 500; margin-left: 8px; }
        .message-text { color: #dbdee1; line-height: 1.375; font-size: 16px; word-wrap: break-word; }
        .embed { background: #2b2d31; border-left: 4px solid #5865f2; padding: 16px; margin: 8px 0; border-radius: 4px; max-width: 520px; }
        .embed-author { display: flex; align-items: center; margin-bottom: 8px; }
        .embed-author-icon { width: 20px; height: 20px; border-radius: 50%; margin-right: 8px; }
        .embed-author-name { font-size: 14px; font-weight: 600; color: #dbdee1; }
        .embed-title { font-weight: 600; color: #00aff4; margin-bottom: 8px; font-size: 16px; }
        .embed-title a { color: #00aff4; text-decoration: none; }
        .embed-description { color: #dbdee1; font-size: 14px; line-height: 1.375; margin-bottom: 8px; }
        .embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
        .embed-field { min-width: 0; font-size: 14px; }
        .embed-field.inline { flex: 1; min-width: 150px; }
        .embed-field-name { font-weight: 600; color: #dbdee1; margin-bottom: 2px; }
        .embed-field-value { color: #dbdee1; line-height: 1.375; }
        .embed-footer { display: flex; align-items: center; margin-top: 8px; }
        .embed-footer-icon { width: 20px; height: 20px; border-radius: 50%; margin-right: 8px; }
        .embed-footer-text { color: #b5bac1; font-size: 12px; }
        .image-attachment { border-radius: 8px; margin: 8px 0; max-width: 100%; }
        .image-attachment img { max-width: 100%; max-height: 400px; width: auto; height: auto; border-radius: 8px; cursor: pointer; }
        .image-caption { margin-top: 8px; font-size: 12px; color: #b5bac1; display: flex; align-items: center; gap: 4px; }
        .video-attachment { border-radius: 8px; margin: 8px 0; max-width: 100%; }
        .video-attachment video { max-width: 400px; max-height: 300px; border-radius: 8px; background: #000; }
        .file-attachment { background: #1e1f22; padding: 16px; border-radius: 8px; margin: 8px 0; border: 1px solid #26282c; }
        .file-details { display: flex; justify-content: space-between; align-items: center; }
        .file-icon { display: inline-block; margin-right: 12px; font-size: 24px; }
        .file-name { color: #00aff4; text-decoration: none; font-weight: 500; font-size: 16px; }
        .file-name:hover { text-decoration: underline; }
        .file-size { color: #949ba4; font-size: 12px; }
        .mention { padding: 0 2px; border-radius: 3px; font-weight: 500; text-decoration: none; }
        .user-mention { background-color: rgba(88,101,242,.1); color: #5865f2; }
        .role-mention { border-radius: 11px; padding: 0 4px; font-size: 14px; font-weight: 500; }
        .channel-mention { background-color: rgba(88,101,242,.1); color: #5865f2; }
        .emoji.custom-emoji { width: 22px; height: 22px; vertical-align: middle; margin: 0 1px; }
        .code-block { background: #1e1f22; border: 1px solid #26282c; border-radius: 4px; padding: 12px; margin: 8px 0; overflow-x: auto; font-family: Consolas, Monaco, 'Courier New', monospace; font-size: 14px; }
        .inline-code { background: #1e1f22; border-radius: 3px; padding: 2px 4px; font-family: Consolas, Monaco, 'Courier New', monospace; font-size: 14px; }
        .spoiler { background: #202225; color: transparent; border-radius: 3px; cursor: pointer; user-select: none; }
        .spoiler:hover, .spoiler.revealed { background: #484b51; color: #dcddde; }
        .lightbox { display: none; position: fixed; z-index: 1000; left: 0; top: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,.85); cursor: pointer; }
        .lightbox img { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); max-width: 90%; max-height: 90%; border-radius: 8px; }
        .lightbox-close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 30px; font-weight: bold; cursor: pointer; z-index: 1001; }
        @media (max-width: 768px) {
            body { padding: 12px; }
            .message { padding-left: 60px; }
            .message:hover { padding-left: 68px; }
            .avatar { left: 12px; width: 32px; height: 32px; }
            .info-grid { grid-template-columns: 1fr; }
        }
    </style>
    <script>
        function openLightbox(src) { var lb = document.getElementById('lightbox'); document.getElementById('lightbox-img').src = src; lb.style.display = 'block'; }
        function closeLightbox() { document.getElementById('lightbox').style.display = 'none'; }
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('lightbox').addEventListener('click', function(e) { if (e.target === this) closeLightbox(); });
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeLightbox(); });
        });
    </script>
</head>
<body>
<div class="header">
    <h1>🎫 Ticket Transcript</h1>
    <div class="info-grid">
        <div class="info-item"><div class="info-label">Ticket Owner</div><div class="info-value">${htmlUtils.sanitize(safeCreator.username)}#${htmlUtils.sanitize(safeCreator.discriminator)}</div></div>
        <div class="info-item"><div class="info-label">Ticket Name</div><div class="info-value">${htmlUtils.sanitize(channel.name)}</div></div>
        <div class="info-item"><div class="info-label">Panel Name</div><div class="info-value">${htmlUtils.sanitize(this.TICKET_TYPES[ticketType]?.name || ticketType)}</div></div>
        <div class="info-item"><div class="info-label">Created At</div><div class="info-value">${htmlUtils.sanitize(createdAt.toLocaleString())}</div></div>
        <div class="info-item"><div class="info-label">Closed At</div><div class="info-value">${htmlUtils.sanitize(closedAt.toLocaleString())}</div></div>
        <div class="info-item"><div class="info-label">Total Messages</div><div class="info-value">${messages.length}</div></div>
    </div>
</div>
<div class="messages">
    <h2>📝 Messages</h2>`;

            // ── Per-message rendering ─────────────────────────────────────────
            for (const message of messages) {
                const timestamp     = new Date(message.createdTimestamp).toLocaleString();
                const isBot         = message.author.bot;
                const avatarUrl     = this.getUserAvatarUrl(message.author);
                const avatarInitial = message.author.username.charAt(0).toUpperCase();

                html += `
<div class="message">
    <div class="avatar">
        <img src="${htmlUtils.sanitize(avatarUrl)}" alt="${htmlUtils.sanitize(message.author.username)}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="avatar-fallback" style="display:none;">${htmlUtils.sanitize(avatarInitial)}</div>
    </div>
    <div class="message-content">
        <div class="message-header">
            <span class="username">${htmlUtils.sanitize(message.author.username)}</span>
            ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
            <span class="timestamp">${htmlUtils.sanitize(timestamp)}</span>
        </div>`;

                if (message.content) {
                    html += `<div class="message-text">${htmlUtils.formatMessage(message.content, channel.guild)}</div>`;
                }

                // Embeds
                for (const embed of message.embeds) {
                    const embedColor = this.discordColorToHex(embed.color);
                    html += `<div class="embed" style="border-left-color:${embedColor};">`;
                    if (embed.author) {
                        html += `<div class="embed-author">`;
                        if (embed.author.iconURL) html += `<img src="${htmlUtils.sanitize(embed.author.iconURL)}" class="embed-author-icon" alt="Author">`;
                        if (embed.author.name) {
                            html += embed.author.url
                                ? `<a href="${htmlUtils.sanitize(embed.author.url)}" class="embed-author-name" target="_blank">${htmlUtils.sanitize(embed.author.name)}</a>`
                                : `<span class="embed-author-name">${htmlUtils.sanitize(embed.author.name)}</span>`;
                        }
                        html += `</div>`;
                    }
                    if (embed.title) {
                        html += `<div class="embed-title">`;
                        html += embed.url
                            ? `<a href="${htmlUtils.sanitize(embed.url)}" target="_blank">${htmlUtils.sanitize(embed.title)}</a>`
                            : htmlUtils.sanitize(embed.title);
                        html += `</div>`;
                    }
                    if (embed.description) html += `<div class="embed-description">${htmlUtils.formatMessage(embed.description, channel.guild)}</div>`;
                    if (embed.fields?.length) {
                        html += `<div class="embed-fields">`;
                        for (const field of embed.fields) {
                            html += `<div class="embed-field ${field.inline ? 'inline' : ''}">`;
                            html += `<div class="embed-field-name">${htmlUtils.sanitize(field.name)}</div>`;
                            html += `<div class="embed-field-value">${htmlUtils.formatMessage(field.value, channel.guild)}</div>`;
                            html += `</div>`;
                        }
                        html += `</div>`;
                    }
                    if (embed.image) {
                        html += `<div class="image-attachment">
                            <img src="${htmlUtils.sanitize(embed.image.url)}" alt="Embed Image"
                                 onclick="openLightbox('${htmlUtils.sanitize(embed.image.url)}')"
                                 onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                            <div style="display:none;color:#f23f43;">❌ Image failed to load</div>
                        </div>`;
                    }
                    if (embed.thumbnail) {
                        html += `<div class="image-attachment">
                            <img src="${htmlUtils.sanitize(embed.thumbnail.url)}" alt="Thumbnail"
                                 style="max-width:80px;max-height:80px;float:right;"
                                 onclick="openLightbox('${htmlUtils.sanitize(embed.thumbnail.url)}')"
                                 onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                            <div style="display:none;color:#f23f43;">❌ Thumbnail failed to load</div>
                        </div>`;
                    }
                    if (embed.footer) {
                        html += `<div class="embed-footer">`;
                        if (embed.footer.iconURL) html += `<img src="${htmlUtils.sanitize(embed.footer.iconURL)}" class="embed-footer-icon" alt="Footer">`;
                        if (embed.footer.text) {
                            let footerText = embed.footer.text;
                            if (embed.timestamp) footerText += ` • ${new Date(embed.timestamp).toLocaleString()}`;
                            html += `<span class="embed-footer-text">${htmlUtils.sanitize(footerText)}</span>`;
                        }
                        html += `</div>`;
                    }
                    html += `</div>`;
                }

                // Attachments — images use the pre-downloaded data URI
                for (const attachment of message.attachments.values()) {
                    if (this.isImageAttachment(attachment)) {
                        const dataUri = imageDataUris.get(attachment.id);
                        if (dataUri) {
                            html += `<div class="image-attachment">
                                <img src="${dataUri}" alt="${htmlUtils.sanitize(attachment.name)}"
                                     onclick="openLightbox(this.src)"
                                     onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                                <div style="display:none;color:#f23f43;">❌ Image failed to load: ${htmlUtils.sanitize(attachment.name)}</div>
                                <div class="image-caption">
                                    📸 ${htmlUtils.sanitize(attachment.name)}
                                    <span class="file-size">(${this.formatFileSize(attachment.size)})</span>
                                </div>
                            </div>`;
                        } else {
                            html += `<div class="file-attachment">
                                <div class="file-details">
                                    <div><span class="file-icon">🖼️</span><span class="file-name">⚠️ Image (may expire): ${htmlUtils.sanitize(attachment.name)}</span></div>
                                    <span class="file-size">${this.formatFileSize(attachment.size)}</span>
                                </div>
                            </div>`;
                        }
                    } else if (this.isVideoAttachment(attachment)) {
                        html += `<div class="video-attachment">
                            <video controls preload="metadata">
                                <source src="${htmlUtils.sanitize(attachment.url)}" type="${htmlUtils.sanitize(attachment.contentType || 'video/mp4')}">
                                Your browser does not support the video tag.
                            </video>
                            <div class="image-caption">
                                🎥 ${htmlUtils.sanitize(attachment.name)}
                                <span class="file-size">(${this.formatFileSize(attachment.size)})</span>
                            </div>
                        </div>`;
                    } else {
                        const fileIcon = this.getFileIcon(attachment.name);
                        html += `<div class="file-attachment">
                            <div class="file-details">
                                <div>
                                    <span class="file-icon">${fileIcon}</span>
                                    <a href="${htmlUtils.sanitize(attachment.url)}" class="file-name" target="_blank">${htmlUtils.sanitize(attachment.name)}</a>
                                </div>
                                <span class="file-size">${this.formatFileSize(attachment.size)}</span>
                            </div>
                        </div>`;
                    }
                }

                html += `</div></div>`;
            }

            html += `
</div>
<div id="lightbox" class="lightbox" onclick="closeLightbox()">
    <span class="lightbox-close" onclick="closeLightbox()">&times;</span>
    <img id="lightbox-img" src="" alt="Lightbox Image">
</div>
</body>
</html>`;

            return {
                html,
                totalMessages: messages.length,
                ticketType:    this.TICKET_TYPES[ticketType]?.name || ticketType
            };

        } catch (error) {
            console.error('Error generating transcript:', error);
            return null;
        }
    }

    // ── File icon helper ──────────────────────────────────────────────────────
    getFileIcon(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const iconMap = {
            pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
            ppt: '📈', pptx: '📈', txt: '📝', zip: '🗜️', rar: '🗜️',
            '7z': '🗜️', mp3: '🎵', wav: '🎵', flac: '🎵', exe: '⚙️',
            msi: '⚙️', json: '📋', xml: '📋', csv: '📋', js: '💻',
            html: '💻', css: '💻', py: '💻', default: '📎'
        };
        return iconMap[ext] || iconMap.default;
    }

    // ── Convenience method used by ticketControlHandler ───────────────────────
    async sendTranscriptToLogs(interaction, transcriptData, ticketCreator) {
        try {
            const logsChannel = interaction.guild.channels.cache.get(CONFIG.TICKET_LOGS_CHANNEL_ID);
            if (!logsChannel) {
                return { success: false, message: '❌ Ticket logs channel not found. Please check the configuration.' };
            }

            const safeCreator = {
                username:      ticketCreator?.username      || 'Unknown',
                discriminator: ticketCreator?.discriminator || '0000'
            };

            const transcriptEmbed = new EmbedBuilder()
                .setTitle('📄 Ticket Transcript Saved')
                .setColor(0x7289da)
                .addFields(
                    { name: 'Ticket Owner',   value: `${safeCreator.username}#${safeCreator.discriminator}`, inline: true },
                    { name: 'Ticket Name',    value: interaction.channel.name,                                inline: true },
                    { name: 'Panel Name',     value: transcriptData.ticketType,                               inline: true },
                    { name: 'Total Messages', value: transcriptData.totalMessages.toString(),                 inline: true },
                    { name: 'Closed By',      value: interaction.user.toString(),                             inline: true },
                    { name: 'Closed At',      value: `<t:${Math.floor(Date.now() / 1000)}:F>`,               inline: true }
                );

            await logsChannel.send({
                content: `Transcript for ${interaction.channel.name}`,
                embeds:  [transcriptEmbed],
                files:   [{
                    attachment: Buffer.from(transcriptData.html, 'utf8'),
                    name:       `transcript-${interaction.channel.name}.html`
                }]
            });

            return { success: true, message: '✅ Transcript generated and sent to the logs channel.' };
        } catch (error) {
            console.error('Error sending transcript to logs:', error);
            return { success: false, message: '❌ An error occurred while sending the transcript to logs.' };
        }
    }
}

module.exports = TranscriptService;