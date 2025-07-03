// features/moderation/utils/durationParser.js

const TIME_UNITS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000, // Month (30 days)
    y: 365 * 24 * 60 * 60 * 1000 // Year (365 days)
};

module.exports = {
    /**
     * Parse duration string into milliseconds
     * @param {string} duration - Duration string like "1d", "2w", "1h30m", "permanent"
     * @returns {Object} - { success: boolean, duration: string, ms: number|null }
     */
    parseDuration(duration) {
        if (!duration) {
            return { success: false, message: "No duration provided" };
        }

        const durationStr = duration.toLowerCase().trim();

        // Handle permanent bans
        if (durationStr === 'permanent' || durationStr === 'perm' || durationStr === 'forever') {
            return { success: true, duration: 'Permanent', ms: null };
        }

        // Parse duration components
        const regex = /(\d+)([smhdwMy])/g;
        let match;
        let totalMs = 0;
        let parts = [];

        while ((match = regex.exec(durationStr)) !== null) {
            const [, amount, unit] = match;
            const value = parseInt(amount);
            
            if (isNaN(value) || value <= 0) {
                return { success: false, message: "Invalid duration amount" };
            }

            if (!TIME_UNITS[unit]) {
                return { success: false, message: `Invalid time unit: ${unit}` };
            }

            totalMs += value * TIME_UNITS[unit];
            parts.push(`${value}${unit}`);
        }

        if (totalMs === 0) {
            return { success: false, message: "No valid duration found" };
        }

        // Check if duration is too long (max 1 year)
        const maxDuration = 365 * 24 * 60 * 60 * 1000; // 1 year
        if (totalMs > maxDuration) {
            return { success: false, message: "Duration cannot exceed 1 year" };
        }

        // Format the duration nicely
        const formattedDuration = this.formatDuration(parts.join(''));

        return { 
            success: true, 
            duration: formattedDuration, 
            ms: totalMs 
        };
    },

    /**
     * Format duration string to human readable format
     * @param {string} duration - Duration string like "1d2h30m"
     * @returns {string} - Formatted duration like "1 day, 2 hours, 30 minutes"
     */
    formatDuration(duration) {
        if (!duration) return 'Unknown';

        const durationStr = duration.toLowerCase().trim();

        // Handle permanent
        if (durationStr === 'permanent' || durationStr === 'perm' || durationStr === 'forever') {
            return 'Permanent';
        }

        const regex = /(\d+)([smhdwMy])/g;
        let match;
        const parts = [];

        while ((match = regex.exec(durationStr)) !== null) {
            const [, amount, unit] = match;
            const value = parseInt(amount);
            
            const unitNames = {
                s: value === 1 ? 'second' : 'seconds',
                m: value === 1 ? 'minute' : 'minutes',
                h: value === 1 ? 'hour' : 'hours',
                d: value === 1 ? 'day' : 'days',
                w: value === 1 ? 'week' : 'weeks',
                M: value === 1 ? 'month' : 'months',
                y: value === 1 ? 'year' : 'years'
            };

            if (unitNames[unit]) {
                parts.push(`${value} ${unitNames[unit]}`);
            }
        }

        if (parts.length === 0) {
            return duration;
        }

        // Join parts with commas and "and" for the last part
        if (parts.length === 1) {
            return parts[0];
        } else if (parts.length === 2) {
            return parts.join(' and ');
        } else {
            const lastPart = parts.pop();
            return parts.join(', ') + ', and ' + lastPart;
        }
    },

    /**
     * Format milliseconds to human readable duration
     * @param {number} ms - Milliseconds
     * @returns {string} - Formatted duration
     */
    formatMilliseconds(ms) {
        if (!ms || ms <= 0) return 'Unknown';

        const units = [
            { name: 'year', value: 365 * 24 * 60 * 60 * 1000 },
            { name: 'month', value: 30 * 24 * 60 * 60 * 1000 },
            { name: 'week', value: 7 * 24 * 60 * 60 * 1000 },
            { name: 'day', value: 24 * 60 * 60 * 1000 },
            { name: 'hour', value: 60 * 60 * 1000 },
            { name: 'minute', value: 60 * 1000 },
            { name: 'second', value: 1000 }
        ];

        const parts = [];
        let remaining = ms;

        for (const unit of units) {
            const count = Math.floor(remaining / unit.value);
            if (count > 0) {
                parts.push(`${count} ${unit.name}${count > 1 ? 's' : ''}`);
                remaining -= count * unit.value;
            }
        }

        if (parts.length === 0) {
            return 'Less than a second';
        } else if (parts.length === 1) {
            return parts[0];
        } else if (parts.length === 2) {
            return parts.join(' and ');
        } else {
            const lastPart = parts.pop();
            return parts.join(', ') + ', and ' + lastPart;
        }
    }
};