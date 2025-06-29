// services/transcriptService.js
const { Buffer } = require('buffer');
const { EmbedBuilder } = require('discord.js');
const htmlUtils = require('../utils/htmlUtils');
const CONFIG = require('../config/config');

class TranscriptService {
    constructor(ticketTypes) {
        this.TICKET_TYPES = ticketTypes;
        this.ticketMetadata = new Map();
    }

    // Helper method to check if attachment is an image
    isImageAttachment(attachment) {
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
        return imageExtensions.some(ext =>
            attachment.name.toLowerCase().endsWith(ext) ||
            attachment.contentType?.startsWith('image/')
        );
    }

    // Helper method to check if attachment is a video
    isVideoAttachment(attachment) {
        const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
        return videoExtensions.some(ext =>
            attachment.name.toLowerCase().endsWith(ext) ||
            attachment.contentType?.startsWith('video/')
        );
    }

    // Helper method to format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async downloadAndEncodeImage(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');
            const contentType = response.headers.get('content-type') || 'image/png';
            return `data:${contentType};base64,${base64}`;
        } catch (error) {
            console.error('Failed to download image:', error);
            return null;
        }
    }

    // Helper method to get user avatar URL
    getUserAvatarUrl(user) {
        if (user.displayAvatarURL) {
            return user.displayAvatarURL({ format: 'png', size: 128 });
        }
        // Fallback to default Discord avatar
        const discriminator = user.discriminator === '0' ?
            ((BigInt(user.id) >> 22n) % 6n).toString() :
            parseInt(user.discriminator) % 5;
        return `https://cdn.discordapp.com/embed/avatars/${discriminator}.png`;
    }

    // Helper method to convert Discord color to hex
    discordColorToHex(color) {
        if (!color) return '#7289da';
        if (typeof color === 'string') return color;
        return `#${color.toString(16).padStart(6, '0')}`;
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
    <title>Ticket Transcript - ${htmlUtils.sanitize(channel.name)}</title>
    <style>
        * {
            box-sizing: border-box;
        }
        
        body { 
            font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: #313338; 
            color: #dbdee1; 
            margin: 0; 
            padding: 20px;
            line-height: 1.375;
        }
        
        .header { 
            background: #2b2d31; 
            padding: 24px; 
            border-radius: 8px; 
            margin-bottom: 20px;
            border: 1px solid #1e1f22;
        }
        
        .header h1 { 
            color: #5865f2; 
            margin: 0 0 16px 0;
            font-size: 24px;
            font-weight: 600;
        }
        
        .info-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 16px; 
        }
        
        .info-item { 
            background: #1e1f22; 
            padding: 16px; 
            border-radius: 6px;
            border: 1px solid #26282c;
        }
        
        .info-label { 
            font-weight: 600; 
            color: #b5bac1; 
            font-size: 12px; 
            text-transform: uppercase; 
            margin-bottom: 6px;
            letter-spacing: 0.5px;
        }
        
        .info-value { 
            color: #dbdee1;
            font-size: 14px;
            font-weight: 500;
        }
        
        .messages { 
            background: #2b2d31; 
            border-radius: 8px; 
            padding: 20px;
            border: 1px solid #1e1f22;
        }
        
        .messages h2 {
            color: #dbdee1;
            margin: 0 0 20px 0;
            font-size: 20px;
            font-weight: 600;
        }
        
        .message { 
            margin-bottom: 17px; 
            display: flex;
            position: relative;
            padding-left: 72px;
            min-height: 44px;
        }
        
        .message:hover {
            background: rgba(4, 4, 5, 0.07);
            border-radius: 4px;
            margin-left: -8px;
            margin-right: -8px;
            padding-left: 80px;
            padding-top: 2px;
            padding-bottom: 2px;
        }
        
        .avatar { 
            position: absolute;
            left: 16px;
            top: 0;
            width: 40px; 
            height: 40px; 
            border-radius: 50%;
            cursor: pointer;
            flex-shrink: 0;
        }
        
        .avatar img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
        }
        
        .avatar-fallback {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #5865f2;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 16px;
        }
        
        .message-content { 
            flex: 1;
            min-width: 0;
        }
        
        .message-header { 
            display: flex; 
            align-items: center; 
            margin-bottom: 2px;
            line-height: 1.375;
        }
        
        .username { 
            font-weight: 600; 
            color: #dbdee1; 
            margin-right: 8px;
            cursor: pointer;
            font-size: 16px;
        }
        
        .username:hover {
            text-decoration: underline;
        }
        
        .bot-tag {
            background: #5865f2;
            color: #ffffff;
            font-size: 10px;
            font-weight: 600;
            padding: 1px 4px;
            border-radius: 3px;
            text-transform: uppercase;
            margin-left: 4px;
            margin-right: 8px;
            letter-spacing: 0.02em;
            line-height: 1.3;
        }
        
        .timestamp { 
            color: #949ba4; 
            font-size: 12px;
            font-weight: 500;
            margin-left: 8px;
        }
        
        .message-text { 
            color: #dbdee1; 
            line-height: 1.375;
            font-size: 16px;
            margin-bottom: 0;
            word-wrap: break-word;
        }
        
        .system-message { 
            background: #1e1f22; 
            padding: 12px 16px; 
            border-radius: 6px; 
            margin: 16px 0; 
            font-style: italic; 
            color: #b5bac1;
            border-left: 4px solid #949ba4;
            font-size: 14px;
        }
        
        .embed { 
            background: #2b2d31; 
            border-left: 4px solid #5865f2; 
            padding: 16px; 
            margin: 8px 0; 
            border-radius: 4px;
            max-width: 520px;
            position: relative;
        }
        
        .embed-author {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .embed-author-icon {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .embed-author-name {
            font-size: 14px;
            font-weight: 600;
            color: #dbdee1;
        }
        
        .embed-title { 
            font-weight: 600; 
            color: #00aff4; 
            margin-bottom: 8px;
            font-size: 16px;
            line-height: 1.375;
        }
        
        .embed-title a {
            color: #00aff4;
            text-decoration: none;
        }
        
        .embed-title a:hover {
            text-decoration: underline;
        }
        
        .embed-description { 
            color: #dbdee1;
            font-size: 14px;
            line-height: 1.375;
            margin-bottom: 8px;
        }
        
        .embed-fields {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .embed-field {
            min-width: 0;
            font-size: 14px;
        }
        
        .embed-field.inline {
            flex: 1;
            min-width: 150px;
        }
        
        .embed-field-name {
            font-weight: 600;
            color: #dbdee1;
            margin-bottom: 2px;
            font-size: 14px;
        }
        
        .embed-field-value {
            color: #dbdee1;
            line-height: 1.375;
            font-size: 14px;
        }
        
        .embed-footer {
            display: flex;
            align-items: center;
            margin-top: 8px;
        }
        
        .embed-footer-icon {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 8px;
        }
        
        .embed-footer-text {
            color: #b5bac1;
            font-size: 12px;
        }
        
        /* Enhanced attachment styles */
        .attachment { 
            background: #1e1f22; 
            padding: 8px; 
            border-radius: 6px; 
            margin: 8px 0;
            border: 1px solid #26282c;
        }
        
        .attachment-name { 
            color: #00aff4; 
            text-decoration: none;
            font-size: 14px;
        }
        
        .attachment-name:hover {
            text-decoration: underline;
        }
        
        .attachment-info { 
            font-size: 12px; 
            color: #b5bac1; 
            margin-top: 4px; 
        }
        
        /* Image styles */
        .image-attachment { 
            background: transparent; 
            padding: 0; 
            border-radius: 8px; 
            margin: 8px 0; 
            max-width: 100%;
        }
        
.image-attachment img { 
    max-width: 100%;
    max-height: 400px; /* Increased from 300px */
    width: auto;
    height: auto;
    border-radius: 8px; 
    cursor: pointer;
    transition: transform 0.1s ease-out;
}
        
        .image-attachment img:hover {
            transform: translateY(-1px);
        }
        
        .image-caption {
            margin-top: 8px;
            font-size: 12px;
            color: #b5bac1;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        /* Video styles */
        .video-attachment {
            background: transparent;
            padding: 0;
            border-radius: 8px;
            margin: 8px 0;
            max-width: 100%;
        }
        
        .video-attachment video {
            max-width: 400px;
            max-height: 300px;
            border-radius: 8px;
            background: #000;
        }
        
        /* File attachment styles */
        .file-attachment {
            background: #1e1f22;
            padding: 16px;
            border-radius: 8px;
            margin: 8px 0;
            border: 1px solid #26282c;
            transition: background-color 0.1s ease-out;
        }
        
        .file-attachment:hover {
            background: #232428;
        }
        
        .file-icon {
            display: inline-block;
            margin-right: 12px;
            font-size: 24px;
        }
        
        .file-details {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .file-name {
            color: #00aff4;
            text-decoration: none;
            font-weight: 500;
            font-size: 16px;
        }
        
        .file-name:hover {
            text-decoration: underline;
        }
        
        .file-size {
            color: #949ba4;
            font-size: 12px;
        }
        
        /* Button styles */
        .embed-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 8px;
        }
        
        .embed-button {
            background: #4752c4;
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: background-color 0.17s ease;
        }
        
        .embed-button:hover {
            background: #3c45a5;
        }
        
        .embed-button.secondary {
            background: #4e5058;
        }
        
        .embed-button.secondary:hover {
            background: #5c5e66;
        }
        
        .embed-button.success {
            background: #248046;
        }
        
        .embed-button.success:hover {
            background: #1a6334;
        }
        
        .embed-button.danger {
            background: #da373c;
        }
        
        .embed-button.danger:hover {
            background: #a12828;
        }
        
        /* Lightbox for images */
        .lightbox {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.85);
            cursor: pointer;
        }
        
        .lightbox img {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            max-width: 90%;
            max-height: 90%;
            border-radius: 8px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        }
        
        .lightbox-close {
            position: absolute;
            top: 20px;
            right: 30px;
            color: #fff;
            font-size: 30px;
            font-weight: bold;
            cursor: pointer;
            z-index: 1001;
        }
        
        .lightbox-close:hover {
            opacity: 0.7;
        }
        
        /* Responsive design */
        @media (max-width: 768px) {
            body {
                padding: 12px;
            }
            
            .message {
                padding-left: 60px;
            }
            
            .message:hover {
                padding-left: 68px;
            }
            
            .avatar {
                left: 12px;
                width: 32px;
                height: 32px;
            }
            
            .avatar-fallback {
                width: 32px;
                height: 32px;
                font-size: 14px;
            }
            
            .info-grid {
                grid-template-columns: 1fr;
            }
        }

        /* Mention styles */
.mention {
    padding: 0 2px;
    border-radius: 3px;
    font-weight: 500;
    text-decoration: none;
}

.user-mention {
    background-color: rgba(88, 101, 242, 0.1);
    color: #5865f2;
}

.role-mention {
    border-radius: 11px;
    padding: 0 4px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.375;
}

.channel-mention {
    background-color: rgba(88, 101, 242, 0.1);
    color: #5865f2;
}

/* Custom emoji styles */
.emoji.custom-emoji {
    width: 22px;
    height: 22px;
    vertical-align: middle;
    margin: 0 1px;
}

/* Code styles */
.code-block {
    background: #1e1f22;
    border: 1px solid #26282c;
    border-radius: 4px;
    padding: 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.125;
}

.inline-code {
    background: #1e1f22;
    border-radius: 3px;
    padding: 2px 4px;
    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
    font-size: 14px;
}

/* Spoiler styles */
.spoiler {
    background: #202225;
    color: transparent;
    border-radius: 3px;
    cursor: pointer;
    user-select: none;
}

.spoiler:hover,
.spoiler.revealed {
    background: #484b51;
    color: #dcddde;
}

    </style>
    <script>
        function openLightbox(src) {
            const lightbox = document.getElementById('lightbox');
            const lightboxImg = document.getElementById('lightbox-img');
            lightboxImg.src = src;
            lightbox.style.display = 'block';
        }
        
        function closeLightbox() {
            document.getElementById('lightbox').style.display = 'none';
        }
        
        // Close lightbox when clicking outside the image or pressing escape
        document.addEventListener('DOMContentLoaded', function() {
            const lightbox = document.getElementById('lightbox');
            if (lightbox) {
                lightbox.addEventListener('click', function(e) {
                    if (e.target === lightbox) {
                        closeLightbox();
                    }
                });
            }
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    closeLightbox();
                }
            });
        });
    </script>
</head>
<body>
    <div class="header">
        <h1>🎫 Ticket Transcript</h1>
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Ticket Owner</div>
                <div class="info-value">${htmlUtils.sanitize(safeCreator.username)}#${htmlUtils.sanitize(safeCreator.discriminator)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Ticket Name</div>
                <div class="info-value">${htmlUtils.sanitize(channel.name)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Panel Name</div>
                <div class="info-value">${htmlUtils.sanitize(this.TICKET_TYPES[ticketType]?.name || ticketType)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Created At</div>
                <div class="info-value">${htmlUtils.sanitize(createdAt.toLocaleString())}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Closed At</div>
                <div class="info-value">${htmlUtils.sanitize(closedAt.toLocaleString())}</div>
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
                const avatarUrl = this.getUserAvatarUrl(message.author);
                const avatarInitial = message.author.username.charAt(0).toUpperCase();

                htmlContent += `
        <div class="message">
            <div class="avatar">
                <img src="${htmlUtils.sanitize(avatarUrl)}" 
                     alt="${htmlUtils.sanitize(message.author.username)}" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="avatar-fallback" style="display: none;">${htmlUtils.sanitize(avatarInitial)}</div>
            </div>
            <div class="message-content">
                <div class="message-header">
                    <span class="username">${htmlUtils.sanitize(message.author.username)}</span>
                    ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
                    <span class="timestamp">${htmlUtils.sanitize(timestamp)}</span>
                </div>`;

                if (message.content) {
                    htmlContent += `<div class="message-text">${htmlUtils.formatMessage(message.content, channel.guild)}</div>`;
                }

                if (message.embeds.length > 0) {
                    for (const embed of message.embeds) {
                        const embedColor = this.discordColorToHex(embed.color);
                        htmlContent += `<div class="embed" style="border-left-color: ${embedColor};">`;

                        // Embed author
                        if (embed.author) {
                            htmlContent += `<div class="embed-author">`;
                            if (embed.author.iconURL) {
                                htmlContent += `<img src="${htmlUtils.sanitize(embed.author.iconURL)}" alt="Author" class="embed-author-icon">`;
                            }
                            if (embed.author.name) {
                                if (embed.author.url) {
                                    htmlContent += `<a href="${htmlUtils.sanitize(embed.author.url)}" class="embed-author-name" target="_blank">${htmlUtils.sanitize(embed.author.name)}</a>`;
                                } else {
                                    htmlContent += `<span class="embed-author-name">${htmlUtils.sanitize(embed.author.name)}</span>`;
                                }
                            }
                            htmlContent += `</div>`;
                        }

                        // Embed title
                        if (embed.title) {
                            htmlContent += `<div class="embed-title">`;
                            if (embed.url) {
                                htmlContent += `<a href="${htmlUtils.sanitize(embed.url)}" target="_blank">${htmlUtils.sanitize(embed.title)}</a>`;
                            } else {
                                htmlContent += htmlUtils.sanitize(embed.title);
                            }
                            htmlContent += `</div>`;
                        }

                        // Embed description
                        if (embed.description) {
                            htmlContent += `<div class="embed-description">${htmlUtils.formatMessage(embed.description, channel.guild)}</div>`;
                        }

                        // Embed fields
                        if (embed.fields && embed.fields.length > 0) {
                            htmlContent += `<div class="embed-fields">`;
                            for (const field of embed.fields) {
                                htmlContent += `<div class="embed-field ${field.inline ? 'inline' : ''}">`;
                                htmlContent += `<div class="embed-field-name">${htmlUtils.sanitize(field.name)}</div>`;
                                htmlContent += `<div class="embed-field-value">${htmlUtils.formatMessage(field.value, channel.guild)}</div>`;
                                htmlContent += `</div>`;
                            }
                            htmlContent += `</div>`;
                        }

                        // Embed images
                        if (embed.image) {
                            htmlContent += `
                                <div class="image-attachment">
                                    <img src="${htmlUtils.sanitize(embed.image.url)}" 
                                         alt="Embed Image" 
                                         onclick="openLightbox('${htmlUtils.sanitize(embed.image.url)}')"
                                         onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                    <div style="display:none; color: #f23f43;">❌ Image failed to load</div>
                                </div>`;
                        }

                        if (embed.thumbnail) {
                            htmlContent += `
                                <div class="image-attachment">
                                    <img src="${htmlUtils.sanitize(embed.thumbnail.url)}" 
                                         alt="Embed Thumbnail" 
                                         style="max-width: 80px; max-height: 80px; float: right;"
                                         onclick="openLightbox('${htmlUtils.sanitize(embed.thumbnail.url)}')"
                                         onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                    <div style="display:none; color: #f23f43;">❌ Thumbnail failed to load</div>
                                </div>`;
                        }

                        // Embed footer
                        if (embed.footer) {
                            htmlContent += `<div class="embed-footer">`;
                            if (embed.footer.iconURL) {
                                htmlContent += `<img src="${htmlUtils.sanitize(embed.footer.iconURL)}" alt="Footer" class="embed-footer-icon">`;
                            }
                            if (embed.footer.text) {
                                let footerText = embed.footer.text;
                                if (embed.timestamp) {
                                    footerText += ` • ${new Date(embed.timestamp).toLocaleString()}`;
                                }
                                htmlContent += `<span class="embed-footer-text">${htmlUtils.sanitize(footerText)}</span>`;
                            }
                            htmlContent += `</div>`;
                        }

                        htmlContent += `</div>`;
                    }
                }

                // Enhanced attachment handling
                if (message.attachments.size > 0) {
                    for (const attachment of message.attachments.values()) {
                        if (this.isImageAttachment(attachment)) {
                            // Download and encode image as base64
                            const imageDataUrl = await this.downloadAndEncodeImage(attachment.url);
                            if (imageDataUrl) {
// Replace the image handling section with:
htmlContent += `
    <div class="image-attachment">
        <img src="${htmlUtils.sanitize(attachment.url)}" 
             alt="${htmlUtils.sanitize(attachment.name)}"
             onclick="openLightbox('${htmlUtils.sanitize(attachment.url)}')"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
        <div style="display:none; color: #f23f43;">❌ Image failed to load: ${htmlUtils.sanitize(attachment.name)}</div>
                                        <div class="image-caption">
                                            📸 ${htmlUtils.sanitize(attachment.name)} 
                                            <span class="file-size">(${this.formatFileSize(attachment.size)})</span>
                                        </div>
                                    </div>`;
                            } else {
                                // Fallback if image download fails
                                htmlContent += `
                                    <div class="file-attachment">
                                        <div class="file-details">
                                            <div>
                                                <span class="file-icon">🖼️</span>
                                                <span class="file-name">❌ Failed to load image: ${htmlUtils.sanitize(attachment.name)}</span>
                                            </div>
                                            <span class="file-size">${this.formatFileSize(attachment.size)}</span>
                                        </div>
                                    </div>`;
                            }
                        } else if (this.isVideoAttachment(attachment)) {
                            // For videos, we'll keep the URL since they're typically too large for base64
                            htmlContent += `
                                <div class="video-attachment">
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
                            // Display other files as download links
                            const fileIcon = this.getFileIcon(attachment.name);
                            htmlContent += `
                                <div class="file-attachment">
                                    <div class="file-details">
                                        <div>
                                            <span class="file-icon">${fileIcon}</span>
                                            <a href="${htmlUtils.sanitize(attachment.url)}" class="file-name" target="_blank">
                                                ${htmlUtils.sanitize(attachment.name)}
                                            </a>
                                        </div>
                                        <span class="file-size">${this.formatFileSize(attachment.size)}</span>
                                    </div>
                                </div>`;
                        }
                    }
                }

                htmlContent += `</div></div>`;
            }

            htmlContent += `
    </div>

    <!-- Lightbox for images -->
    
    <div id="lightbox" class="lightbox" onclick="closeLightbox()">
        <span class="lightbox-close" onclick="closeLightbox()">&times;</span>
        <img id="lightbox-img" src="" alt="Lightbox Image">
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

    // Helper method to get file icon based on extension
    getFileIcon(filename) {
        const ext = filename.toLowerCase().split('.').pop();
        const iconMap = {
            'pdf': '📄',
            'doc': '📝', 'docx': '📝',
            'xls': '📊', 'xlsx': '📊',
            'ppt': '📈', 'pptx': '📈',
            'txt': '📝',
            'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️',
            'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
            'exe': '⚙️', 'msi': '⚙️',
            'json': '📋', 'xml': '📋', 'csv': '📋',
            'js': '💻', 'html': '💻', 'css': '💻', 'py': '💻',
            'default': '📎'
        };
        return iconMap[ext] || iconMap['default'];
    }

    async sendTranscriptToLogs(interaction, transcriptData, ticketCreator) {
        try {
            const logsChannel = interaction.guild.channels.cache.get(CONFIG.TICKET_LOGS_CHANNEL_ID);

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