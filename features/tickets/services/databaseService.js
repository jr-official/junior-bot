// services/databaseService.js
const { MongoClient } = require('mongodb');

// Only load .env in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

class DatabaseService {
    constructor() {
        // Check if MongoDB URI is available
        if (!process.env.MONGODB_URI) {
            console.error('❌ MONGODB_URI environment variable is not set!');
            console.error('Please set your MongoDB connection string in Railway variables');
            process.exit(1);
        }
        
        // Configure MongoDB client options for Railway deployment
        const clientOptions = {
            // SSL/TLS options for Railway compatibility
            ssl: true,
            sslValidate: false, // Allow invalid certificates
            tlsAllowInvalidCertificates: true,
            tlsInsecure: true,
            
            // Connection options
            useNewUrlParser: true,
            useUnifiedTopology: true,
            
            // Timeout options
            serverSelectionTimeoutMS: 10000, // 10 seconds
            connectTimeoutMS: 10000, // 10 seconds
            socketTimeoutMS: 45000, // 45 seconds
            
            // Retry options
            retryWrites: true,
            retryReads: true,
            maxPoolSize: 10,
            minPoolSize: 1,
            
            // Heartbeat options
            heartbeatFrequencyMS: 10000,
            
            // Additional options for Railway
            bufferMaxEntries: 0,
            bufferCommands: false,
        };

        this.client = new MongoClient(process.env.MONGODB_URI, clientOptions);
        this.db = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            console.log('🔗 Attempting to connect to MongoDB...');
            console.log('🔗 Using SSL/TLS configuration for Railway deployment');
            
            await this.client.connect();
            this.db = this.client.db('junior-bot'); // Your database name
            this.isConnected = true;
            console.log('✅ Connected to MongoDB Atlas');

            // Test the connection
            await this.ping();
            console.log('✅ MongoDB connection verified');

            // Create indexes for better performance
            await this.createIndexes();
        } catch (error) {
            console.error('❌ MongoDB connection error:', error);
            console.error('Connection string preview:', process.env.MONGODB_URI ? 'mongodb://***:***@***' : 'NOT SET');
            this.isConnected = false;
            
            // Log specific SSL errors
            if (error.message.includes('SSL') || error.message.includes('TLS')) {
                console.error('🔧 SSL/TLS Error detected. Try these solutions:');
                console.error('1. Ensure your MongoDB URI includes ssl=true parameter');
                console.error('2. Check if your MongoDB cluster allows connections from all IPs (0.0.0.0/0)');
                console.error('3. Verify your MongoDB Atlas network access settings');
            }
            
            throw error; // Re-throw to handle in main.js
        }
    }

    async createIndexes() {
        try {
            const tickets = this.db.collection('tickets');

            // Create indexes for better query performance
            await tickets.createIndex({ channelId: 1 }, { unique: true });
            await tickets.createIndex({ userId: 1 });
            await tickets.createIndex({ guildId: 1 });
            await tickets.createIndex({ status: 1 });
            await tickets.createIndex({ createdAt: 1 });

            console.log('✅ Database indexes created');
        } catch (error) {
            console.error('❌ Error creating indexes:', error);
        }
    }

    getCollection(name) {
        if (!this.isConnected || !this.db) {
            console.error('❌ Database not connected');
            return null;
        }
        return this.db.collection(name);
    }

    async disconnect() {
        try {
            await this.client.close();
            this.isConnected = false;
            console.log('✅ Disconnected from MongoDB');
        } catch (error) {
            console.error('❌ Error disconnecting from MongoDB:', error);
        }
    }

    // Health check method
    async ping() {
        try {
            await this.db.admin().ping();
            return true;
        } catch (error) {
            console.error('❌ Database ping failed:', error);
            return false;
        }
    }

    // Connection status check
    isHealthy() {
        return this.isConnected && this.client.topology && this.client.topology.isConnected();
    }

    // Reconnection method
    async reconnect() {
        console.log('🔄 Attempting to reconnect to MongoDB...');
        try {
            await this.disconnect();
            await this.connect();
            console.log('✅ Successfully reconnected to MongoDB');
        } catch (error) {
            console.error('❌ Reconnection failed:', error);
            throw error;
        }
    }
}

module.exports = new DatabaseService();