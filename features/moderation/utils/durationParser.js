// features/moderation/utils/durationParser.js
//
// Duration unit reference:
//   s = seconds  |  m = minutes (lowercase)  |  h = hours
//   d = days     |  w = weeks                |  M = months (uppercase — distinct from minutes)
//   y = years
//
// The case-sensitivity of 'm' vs 'M' is intentional and documented here so it
// is not accidentally "fixed" by a future editor.

const TIME_UNITS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000
};

function formatDuration(duration) {
    if (!duration) return 'Unknown';
    const durationStr = duration.toLowerCase().trim();

    if (['permanent', 'perm', 'forever'].includes(durationStr)) return 'Permanent';

    // NOTE: regex does not use the 'i' flag — unit case matters (m vs M)
    const regex = /(\d+)([smhdwMy])/g;
    let match;
    const parts = [];

    while ((match = regex.exec(duration)) !== null) {
        const [, amount, unit] = match;
        const value = parseInt(amount);

        const unitNames = {
            s: value === 1 ? 'second'  : 'seconds',
            m: value === 1 ? 'minute'  : 'minutes',
            h: value === 1 ? 'hour'    : 'hours',
            d: value === 1 ? 'day'     : 'days',
            w: value === 1 ? 'week'    : 'weeks',
            M: value === 1 ? 'month'   : 'months',
            y: value === 1 ? 'year'    : 'years'
        };

        if (unitNames[unit]) {
            parts.push(`${value} ${unitNames[unit]}`);
        }
    }

    if (parts.length === 0) return duration;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts.join(' and ');
    const lastPart = parts.pop();
    return parts.join(', ') + ', and ' + lastPart;
}

module.exports = {
    parseDuration(duration) {
        if (!duration) return { success: false, message: 'No duration provided' };

        const durationStr = duration.trim();
        if (['permanent', 'perm', 'forever'].includes(durationStr.toLowerCase())) {
            return { success: true, duration: 'Permanent', ms: null };
        }

        const regex = /(\d+)([smhdwMy])/g;
        let match, totalMs = 0;
        const parts = [];

        while ((match = regex.exec(durationStr)) !== null) {
            const [, amount, unit] = match;
            const value = parseInt(amount);
            if (isNaN(value) || value <= 0) return { success: false, message: 'Invalid duration amount' };
            if (!TIME_UNITS[unit]) return { success: false, message: `Invalid time unit: ${unit}` };
            totalMs += value * TIME_UNITS[unit];
            parts.push(`${value}${unit}`);
        }

        if (totalMs === 0) return { success: false, message: 'No valid duration found' };
        if (totalMs > TIME_UNITS.y) return { success: false, message: 'Duration cannot exceed 1 year' };

        return {
            success:  true,
            duration: formatDuration(parts.join('')),
            ms:       totalMs
        };
    },

    formatDuration,

    formatMilliseconds(ms) {
        if (!ms || ms <= 0) return 'Unknown';
        const units = [
            { name: 'year',   value: TIME_UNITS.y },
            { name: 'month',  value: TIME_UNITS.M },
            { name: 'week',   value: TIME_UNITS.w },
            { name: 'day',    value: TIME_UNITS.d },
            { name: 'hour',   value: TIME_UNITS.h },
            { name: 'minute', value: TIME_UNITS.m },
            { name: 'second', value: TIME_UNITS.s }
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

        if (parts.length === 0) return 'Less than a second';
        if (parts.length === 1) return parts[0];
        const last = parts.pop();
        return parts.join(', ') + ', and ' + last;
    }
};