import mongoose from 'mongoose';
import env from './env.js';

let memoryServer = null;

mongoose.set('strictQuery', true);

/**
 * Resolves the connection string. When USE_MEMORY_DB is on we spin up an
 * ephemeral mongod via mongodb-memory-server, which lets the whole stack run
 * (and be tested) on a machine with no MongoDB installed. Data is wiped on
 * every restart, so it is development-only — env.js refuses it in production.
 */
const resolveUri = async () => {
  if (!env.db.useMemory) return env.db.uri;

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create({ instance: { dbName: 'arts_by_jay' } });
  const uri = memoryServer.getUri();
  console.warn('[db] Using an IN-MEMORY MongoDB. All data is discarded when the server stops.');
  return uri;
};

let transactionsSupported = false;

/**
 * Multi-document transactions need a replica set or a mongos. A standalone
 * mongod accepts `startTransaction()` without complaint and only fails on the
 * first operation inside it, so the capability has to be probed up front
 * rather than discovered by try/catch at use time.
 */
const probeTransactionSupport = async () => {
  try {
    const info = await mongoose.connection.db.admin().command({ hello: 1 });
    // `setName` means a replica set; `isdbgrid` means we are talking to mongos.
    transactionsSupported = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
};

export const supportsTransactions = () => transactionsSupported;

export const connectDatabase = async () => {
  const uri = await resolveUri();

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] disconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: env.db.useMemory ? 30000 : 8000,
    maxPoolSize: 10,
  });

  const { host, name } = mongoose.connection;
  await probeTransactionSupport();

  console.log(`[db] connected to ${name} at ${host}`);
  if (!transactionsSupported) {
    console.warn(
      '[db] this deployment is standalone, so order settlement runs without a transaction. Use a replica set or Atlas in production.',
    );
  }

  return mongoose.connection;
};

export const disconnectDatabase = async () => {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
};

export const isDatabaseReady = () => mongoose.connection.readyState === 1;

export default mongoose;
