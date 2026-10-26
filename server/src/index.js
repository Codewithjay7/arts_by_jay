import env, { configWarnings } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import createApp from './app.js';

const log = (message) => console.log(`[server] ${message}`);

const start = async () => {
  if (configWarnings.length) {
    console.warn('\n[config] Review these before deploying:');
    configWarnings.forEach((warning) => console.warn(`  - ${warning}`));
    console.warn('');
  }

  await connectDatabase();

  // An in-memory database starts empty every time, so seed it on boot —
  // otherwise `npm run dev` would hand you a marketplace with nothing in it.
  if (env.db.useMemory) {
    const { User } = await import('./models/index.js');
    if (!(await User.exists({}))) {
      log('seeding the in-memory database');
      const { seedAll, printCredentials } = await import('../scripts/seed.js');
      await seedAll();
      printCredentials();
    }
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] Arts by Jay API listening on http://localhost:${env.port}`);
    console.log(`[server] environment: ${env.nodeEnv}  payments: ${env.payments.provider}  storage: ${env.storage.driver}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down.`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
