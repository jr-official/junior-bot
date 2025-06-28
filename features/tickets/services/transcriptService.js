// services/transcriptService.js
const { Buffer } = require('buffer');
const { EmbedBuilder } = require('discord.js');

// HTML sanitization setup
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const dompurify = DOMPurify(window);

class TranscriptService {
    constructor(ticketTypes) {
        this.TICKET_TYPES = ticketTypes;
        this.ticketMetadata = new Map(); // Initialize metadata map
        this.RATE_LIMIT_REQUESTS = 5;
        this.RATE_LIMIT_DELAY_MS = 1000;
        this.MESSAGE_FETCH_LIMIT = 100;
        this.WARNING_TIMEOUT_MINUTES = 5;
    }

    safeHtml(unsafe) {
        return dompurify.sanitize(unsafe);
    }

    async generateTranscript(channel, ticketCreator) {
        if (!channel || !channel.messages) {
            console.error('Invalid channel provided for transcript generation');
            return null;
        }

        try {
            const messages = [];
            let lastMessageId;
            let requestCount = 0;

            while (true) {
                if (requestCount > 0 && requestCount % this.RATE_LIMIT_REQUESTS === 0) {
                    await new Promise(resolve => setTimeout(resolve, this.RATE_LIMIT_DELAY_MS));
                }

                const options = { limit: this.MESSAGE_FETCH_LIMIT };
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

            const metadata = this.ticketMetadata.get(channel.id) || {};
            const ticketType = metadata.type || channel.name.split('-')[0];
            const createdAt = new Date(metadata.createdAt || channel.createdTimestamp);
            const closedAt = new Date();

            // Ensure ticketCreator has required properties
            const safeCreator = {
                username: ticketCreator?.username || 'Unknown',
                discriminator: ticketCreator?.discriminator || '0000'
            };

            let htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Ticket Transcript - ${this.safeHtml(channel.name)}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #36393f; color: #dcddde; margin: 0; padding: 20px; }
        .header { background: #2f3136; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .header h1 { color: #7289da; margin: 0 0 10px 0; }
        .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .info-item { background: #40444b; padding: 15px; border-radius: 6px; }
        .info-label { font-weight: bold; color: #b9bbbe; font-size: 12px; text-transform: uppercase; margin-bottom: 5px; }
        .info-value { color: #dcddde; }
        .messages { background: #2f3136; border-radius: 8px; padding: 20px; }
        .message { margin-bottom: 20px; display: flex; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 15px; background: #7289da; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; }
        .message-content { flex: 1; }
        .message-header { display: flex; align-items: center; margin-bottom: 5px; }
        .username { font-weight: bold; color: #dcddde; margin-right: 10px; }
        .timestamp { color: #72767d; font-size: 12px; }
        .message-text { color: #dcddde; line-height: 1.4; }
        .bot-message .username { color: #7289da; }
        .system-message { background: #40444b; padding: 10px; border-radius: 6px; margin: 10px 0; font-style: italic; color: #b9bbbe; }
        .embed { background: #2f3136; border-left: 4px solid #7289da; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .embed-title { font-weight: bold; color: #ffffff; margin-bottom: 8px; }
        .embed-description { color: #dcddde; }
        .attachment { background: #40444b; padding: 10px; border-radius: 6px; margin: 5px 0; }
        .attachment-name { color: #00aff4; text-decoration: none; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎫 Ticket Transcript</h1>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Ticket Owner</div>
                <div class="info-value">${this.safeHtml(safeCreator.username)}#${this.safeHtml(safeCreator.discriminator)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Ticket Name</div>
                <div class="info-value">${this.safeHtml(channel.name)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Panel Name</div>
                <div class="info-value">${this.safeHtml(this.TICKET_TYPES[ticketType]?.name || ticketType)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Created At</div>
                <div class="info-value">${this.safeHtml(createdAt.toLocaleString())}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Closed At</div>
                <div class="info-value">${this.safeHtml(closedAt.toLocaleString())}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Total Messages</div>
                <div class="info-value">${messages.length}</div>
            </div>
        </div>
    </div>
    
    <div class="messages">
        <h2>📝 Messages</h2>`;

            for (const message of messages) {
                const timestamp = new Date(message.createdTimestamp).toLocaleString();
                const isBot = message.author.bot;
                const avatarInitial = message.author.username.charAt(0).toUpperCase();

                htmlContent += `
        <div class="message">
            <div class="avatar">${this.safeHtml(avatarInitial)}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="username ${isBot ? 'bot-message' : ''}">${this.safeHtml(message.author.username)}${isBot ? ' BOT' : ''}</span>
                    <span class="timestamp">${this.safeHtml(timestamp)}</span>
                </div>`;

                if (message.content) {
                    htmlContent += `<div class="message-text">${this.safeHtml(message.content).replace(/\n/g, '<br>')}</div>`;
                }

                if (message.embeds.length > 0) {
                    for (const embed of message.embeds) {
                        htmlContent += `<div class="embed">`;
                        if (embed.title) {
                            htmlContent += `<div class="embed-title">${this.safeHtml(embed.title)}</div>`;
                        }
                        if (embed.description) {
                            htmlContent += `<div class="embed-description">${this.safeHtml(embed.description).replace(/\n/g, '<br>')}</div>`;
                        }
                        htmlContent += `</div>`;
                    }
                }

                if (message.attachments.size > 0) {
                    for (const attachment of message.attachments.values()) {
                        htmlContent += `<div class="attachment">📎 <a href="${this.safeHtml(attachment.url)}" class="attachment-name" target="_blank">${this.safeHtml(attachment.name)}</a></div>`;
                    }
                }

                htmlContent += `</div></div>`;
            }

            htmlContent += `
    </div>
</body>
</html>`;

            return {
                html: htmlContent,
                totalMessages: messages.length,
                ticketType: this.TICKET_TYPES[ticketType]?.name || ticketType
            };

        } catch (error) {
            console.error('Error generating transcript:', error);
            return null;
        }
    }

    async sendTranscriptToLogs(interaction, transcriptData, ticketCreator) {
        try {
            const logsChannel = interaction.guild.channels.cache.get(interaction.client.config.TICKET_LOGS_CHANNEL_ID);

            if (!logsChannel) {
                return {
                    success: false,
                    message: '❌ Ticket logs channel not found. Please check the configuration.'
                };
            }

            const safeCreator = {
                username: ticketCreator?.username || 'Unknown',
                discriminator: ticketCreator?.discriminator || '0000'
            };

            const transcriptEmbed = new EmbedBuilder()
                .setTitle('📄 Ticket Transcript Saved')
                .setColor(0x7289da)
                .addFields(
                    { name: 'Ticket Owner', value: `${safeCreator.username}#${safeCreator.discriminator}`, inline: true },
                    { name: 'Ticket Name', value: interaction.channel.name, inline: true },
                    { name: 'Panel Name', value: transcriptData.ticketType, inline: true },
                    { name: 'Total Messages', value: transcriptData.totalMessages.toString(), inline: true },
                    { name: 'Closed By', value: interaction.user.toString(), inline: true },
                    { name: 'Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
                );

            await logsChannel.send({
                content: `Transcript for ${interaction.channel.name}`,
                embeds: [transcriptEmbed],
                files: [{
                    attachment: Buffer.from(transcriptData.html, 'utf8'),
                    name: `transcript-${interaction.channel.name}.html`
                }]
            });

            return {
                success: true,
                message: '✅ Transcript generated and sent to the logs channel.'
            };
        } catch (error) {
            console.error('Error sending transcript to logs:', error);
            return {
                success: false,
                message: '❌ An error occurred while sending the transcript to logs.'
            };
        }
    }
}

module.exports = TranscriptService;