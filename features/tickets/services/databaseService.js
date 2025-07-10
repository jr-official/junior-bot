const { MongoClient } = require('mongodb');

// Load .env in development
if (process.env.NODE_ENV !== 'production') require('dotenv').config();

class DatabaseService {
    constructor() {
        if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
        
        // Updated connection options (removed deprecated ones)
        this.client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            connectTimeoutMS: 10000
        });
        this.db = null;
    }

    async connect() {
        try {
            console.log('🔗 Connecting to MongoDB...');
            await this.client.connect();
            this.db = this.client.db('junior-bot');
            await this.testConnection();
            console.log('✅ Database connected successfully');
        } catch (error) {
            console.error('❌ Connection failed:', error.message);
            throw error;
        }
    }

    async testConnection() {
        const collections = await this.db.listCollections().toArray();
        console.log('📂 Available collections:', collections.map(c => c.name));
        
        // Create indexes if needed
        await this.db.collection('tickets').createIndexes([
            { key: { channelId: 1 }, unique: true },
            { key: { userId: 1 } },
            { key: { status: 1 } }
        ]);
    }

    async ping() {
        try {
            await this.db.command({ ping: 1 });
            return true;
        } catch {
            return false;
        }
    }

    getCollection(name) {
        if (!this.db) throw new Error('Not connected to database');
        return this.db.collection(name);
    }

    async disconnect() {
        await this.client.close();
        console.log('✅ Database disconnected');
    }
}

module.exports = new DatabaseService();