import app from './src/app.js';
import { env } from './src/config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`🚀 Attendance System Backend running in [${env.NODE_ENV}] mode on port ${env.PORT}`);
});

// Handle termination signals
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}. Gracefully closing server...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
