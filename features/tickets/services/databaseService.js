// services/databaseService.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

class DatabaseService {
    constructor() {
        this.client = new MongoClient(process.env.MONGODB_URI);
        this.db = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            await this.client.connect();
            this.db = this.client.db('junior-bot'); // Your database name
            this.isConnected = true;
            console.log('✅ Connected to MongoDB Atlas');

            // Create indexes for better performance
            await this.createIndexes();
        } catch (error) {
            console.error('❌ MongoDB connection error:', error);
            this.isConnected = false;
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
}

module.exports = new DatabaseService();