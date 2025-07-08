// features/roles/config/roleConfigs.js

module.exports = {
    location: {
        title: "Location Roles",
        color: 0x5037CF, // Purple color (#5037cf)
        description: "Select your location to connect with other members from your region!",
        placeholder: "Where in the world are you from?",
        options: [
            {
                label: "Global",
                value: "global",
                description: "Remove all location roles",
                emoji: { name: "🌎" },
                default: true
                // No roleId - this option just removes other roles
            },
            {
                label: "North America",
                value: "north_america",
                description: "For members from North America",
                emoji: { name: "🐻" },
                roleId: "1185214085080551575"
            },
            {
                label: "South America",
                value: "south_america",
                description: "For members from South America",
                emoji: { name: "🦜" },
                roleId: "1185214257302876211"
            },
            {
                label: "Europe",
                value: "europe",
                description: "For members from Europe",
                emoji: { name: "🦊" },
                roleId: "1185214343273529394"
            },
            {
                label: "Asia",
                value: "asia",
                description: "For members from Asia",
                emoji: { name: "🐼" },
                roleId: "1185214403767967815"
            },
            {
                label: "Africa",
                value: "africa",
                description: "For members from Africa",
                emoji: { name: "🦁" },
                roleId: "1185214634656006174"
            },
            {
                label: "Australia",
                value: "australia",
                description: "For users from Australia and the broader Oceania region",
                emoji: { name: "🐨" },
                roleId: "1185214515848151100"
            }
        ]
    },
    
    interest: {
        title: "Interest Roles",
        color: 0x00FF7F, // Spring green color
        description: "Pick topics you're into",
        placeholder: "What are you interested in?",
        options: [
            {
                label: "None",
                value: "none",
                description: "Remove all interest roles",
                emoji: { name: "❌" },
                default: true
                // No roleId - this option just removes other roles
            },
            {
                label: "Programming",
                value: "programming",
                description: "Discuss all things programming and development",
                emoji: { name: "💻" },
                roleId: "1392176682529591417"
            },
            {
                label: "AI & ML",
                value: "ai_ml",
                description: "Discuss AI and Machine Learning",
                emoji: { name: "🧠" },
                roleId: "1392176799965909043"
            },
            {
                label: "Art & Design",
                value: "art_design",
                description: "Share art, graphics, UI/UX ideas",
                emoji: { name: "🎨" },
                roleId: "1392176822648832062"
            },
            {
                label: "Writing",
                value: "writing",
                description: "Share stories, poems, and creative writing",
                emoji: { name: "✍️" },
                roleId: "1392176855813193918"
            },
            {
                label: "Gaming",
                value: "gaming",
                description: "Talk games, updates, or play together",
                emoji: { name: "🕹️" },
                roleId: "1392176899454926888"
            },
            {
                label: "Chill",
                value: "chill",
                description: "Just vibing? This one's for you",
                emoji: { name: "🗣️" },
                roleId: "1392176923303612457"
            }
        ]
    },
    
    ping: {
        title: "Ping Roles",
        color: 0xFF4500, // Orange red color
        description: "Choose what pings you want to receive!",
        placeholder: "What would you like to be pinged for?",
        options: [
            {
                label: "None",
                value: "none",
                description: "Remove all ping roles",
                emoji: { name: "🔕" },
                default: true
                // No roleId - this option just removes other roles
            },
            {
                label: "Announcements",
                value: "announcements",
                description: "Major server-wide news and alerts",
                emoji: { name: "📢" },
                roleId: "1185223626530766848"
            },
            {
                label: "JR. News",
                value: "jr_news",
                description: "Updates from the JR. team and projects",
                emoji: { name: "📰" },
                roleId: "1199342367531085835"
            },
            {
                label: "Events",
                value: "events",
                description: "Be notified about game nights, Q&As, and more",
                emoji: { name: "📅" },
                roleId: "1185223819825266798"
            },
            {
                label: "Collabs",
                value: "collabs",
                description: "Get pinged when we're open for team-ups",
                emoji: { name: "🤝" },
                roleId: "1185223933771911168"
            },
            {
                label: "Challenges",
                value: "challenges",
                description: "Join or vote in art/coding challenges",
                emoji: { name: "🏆" },
                roleId: "1185224140886654996"
            }
        ]
    }
};