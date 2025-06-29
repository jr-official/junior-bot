// utils/htmlUtils.js
const DOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

class HtmlUtils {
    constructor() {
        this.window = new JSDOM('').window;
        this.dompurify = DOMPurify(this.window);
    }

    sanitize(unsafe) {
        if (typeof unsafe !== 'string') {
            return '';
        }
        return this.dompurify.sanitize(unsafe);
    }

    // Helper function to parse user mentions
    parseUserMention(mention, guild) {
        const userId = mention.match(/<@!?(\d+)>/)?.[1];
        if (!userId || !guild) return mention;
        
        const member = guild.members.cache.get(userId);
        if (member) {
            return `<span class="mention user-mention">@${this.sanitize(member.displayName || member.user.username)}</span>`;
        }
        return mention;
    }

    // Helper function to parse role mentions
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

    // Helper function to parse channel mentions
    parseChannelMention(mention, guild) {
        const channelId = mention.match(/<#(\d+)>/)?.[1];
        if (!channelId || !guild) return mention;
        
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
            return `<span class="mention channel-mention">#${this.sanitize(channel.name)}</span>`;
        }
        return mention;
    }

    // Helper function to parse custom emojis
    parseCustomEmojis(content) {
        return content.replace(/<(a?):(\w+):(\d+)>/g, (match, animated, name, id) => {
            const extension = animated ? 'gif' : 'png';
            return `<img class="emoji custom-emoji" src="https://cdn.discordapp.com/emojis/${id}.${extension}" alt=":${name}:" title=":${name}:">`;
        });
    }

    // Helper function to format Discord markdown
    formatDiscordMarkdown(content) {
        // Bold
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Italic
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
        content = content.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // Underline
        content = content.replace(/__(.*?)__/g, '<u>$1</u>');
        
        // Strikethrough
        content = content.replace(/~~(.*?)~~/g, '<del>$1</del>');
        
        // Code blocks
        content = content.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
            return `<pre class="code-block${lang ? ` language-${lang}` : ''}"><code>${this.sanitize(code.trim())}</code></pre>`;
        });
        
        // Inline code
        content = content.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        
        // Spoilers
        content = content.replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
        
        return content;
    }

    // Helper function to format URLs
    formatUrls(content) {
        const urlRegex = /(https?:\/\/[^\s<>]+)/g;
        return content.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    formatMessage(message, guild = null) {
        if (!message || typeof message !== 'string') {
            return '';
        }

        let formatted = message;

        // Parse Discord mentions if guild is provided
        if (guild) {
            // Replace user mentions
            formatted = formatted.replace(/<@!?(\d+)>/g, (match) => {
                return this.parseUserMention(match, guild);
            });
            
            // Replace role mentions
            formatted = formatted.replace(/<@&(\d+)>/g, (match) => {
                return this.parseRoleMention(match, guild);
            });
            
            // Replace channel mentions
            formatted = formatted.replace(/<#(\d+)>/g, (match) => {
                return this.parseChannelMention(match, guild);
            });
        }

        // Parse custom emojis
        formatted = this.parseCustomEmojis(formatted);

        // Format Discord markdown
        formatted = this.formatDiscordMarkdown(formatted);

        // Format URLs
        formatted = this.formatUrls(formatted);

        // Replace line breaks
        formatted = formatted.replace(/\n/g, '<br>');

        // Sanitize the final result (but preserve our HTML formatting)
        return this.dompurify.sanitize(formatted, {
            ALLOWED_TAGS: ['br', 'strong', 'em', 'u', 'del', 'code', 'pre', 'a', 'span', 'img'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt', 'title', 'onclick']
        });
    }
}

// Export singleton instance
module.exports = new HtmlUtils();