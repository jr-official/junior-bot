// features/tickets/utils/htmlUtils.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

class HtmlUtils {
    constructor() {
        this.window    = new JSDOM('').window;
        this.dompurify = DOMPurify(this.window);
    }

    sanitize(unsafe) {
        if (typeof unsafe !== 'string') {
            return '';
        }
        return this.dompurify.sanitize(unsafe);
    }

    parseUserMention(mention, guild) {
        const userId = mention.match(/<@!?(\d+)>/)?.[1];
        if (!userId || !guild) return mention;
        const member = guild.members.cache.get(userId);
        if (member) {
            return `<span class="mention user-mention">@${this.sanitize(member.displayName || member.user.username)}</span>`;
        }
        return mention;
    }

    parseRoleMention(mention, guild) {
        const roleId = mention.match(/<@&(\d+)>/)?.[1];
        if (!roleId || !guild) return mention;
        const role = guild.roles.cache.get(roleId);
        if (role) {
            const roleColor = role.hexColor !== '#000000' ? role.hexColor : '#99aab5';
            return `<span class="mention role-mention" style="background-color: ${roleColor}20; color: ${roleColor}; border: 1px solid ${roleColor}40;">@${this.sanitize(role.name)}</span>`;
        }
        return mention;
    }

    parseChannelMention(mention, guild) {
        const channelId = mention.match(/<#(\d+)>/)?.[1];
        if (!channelId || !guild) return mention;
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
            return `<span class="mention channel-mention">#${this.sanitize(channel.name)}</span>`;
        }
        return mention;
    }

    parseCustomEmojis(content) {
        return content.replace(/<(a?):(\w+):(\d+)>/g, (match, animated, name, id) => {
            const extension = animated ? 'gif' : 'png';
            return `<img class="emoji custom-emoji" src="https://cdn.discordapp.com/emojis/${id}.${extension}" alt=":${name}:" title=":${name}:">`;
        });
    }

    formatDiscordMarkdown(content) {
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
        content = content.replace(/_(.*?)_/g, '<em>$1</em>');
        content = content.replace(/__(.*?)__/g, '<u>$1</u>');
        content = content.replace(/~~(.*?)~~/g, '<del>$1</del>');
        content = content.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre class="code-block${lang ? ` language-${lang}` : ''}"><code>${this.sanitize(code.trim())}</code></pre>`;
        });
        content = content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        content = content.replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" data-spoiler>$1</span>');
        return content;
    }

    formatUrls(content) {
        const urlRegex = /(https?:\/\/[^\s<>]+)/g;
        return content.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    formatMessage(message, guild = null) {
        if (!message || typeof message !== 'string') {
            return '';
        }

        let formatted = message;

        if (guild) {
            formatted = formatted.replace(/<@!?(\d+)>/g,  (match) => this.parseUserMention(match, guild));
            formatted = formatted.replace(/<@&(\d+)>/g,   (match) => this.parseRoleMention(match, guild));
            formatted = formatted.replace(/<#(\d+)>/g,    (match) => this.parseChannelMention(match, guild));
        }

        formatted = this.parseCustomEmojis(formatted);
        formatted = this.formatDiscordMarkdown(formatted);
        formatted = this.formatUrls(formatted);
        formatted = formatted.replace(/\n/g, '<br>');

        // FIX: removed 'onclick' from ALLOWED_ATTR. Allowing inline event handlers
        // in a DOMPurify allowlist is a well-known XSS vector. The lightbox in the
        // transcript template now uses delegated event listeners (data-lightbox
        // attribute + a single document-level listener) instead of inline onclick,
        // so this attribute is no longer needed. The spoiler toggle similarly uses
        // data-spoiler + a delegated listener.
        return this.dompurify.sanitize(formatted, {
            ALLOWED_TAGS: ['br', 'strong', 'em', 'u', 'del', 'code', 'pre', 'a', 'span', 'img'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'title',
                           'data-spoiler', 'data-lightbox']
        });
    }
}

module.exports = new HtmlUtils();