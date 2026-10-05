const cluster = require('cluster');
const os = require('os');

const numCPUs = os.cpus().length;

if (cluster.isPrimary || cluster.isMaster) {
  console.log('───────────────────────────────────────────────────');
  console.log(`🔥  SaaS Cluster Manager Active`);
  console.log(`💻  Detected ${numCPUs} CPU Cores on Host`);
  console.log(`⚡  Spinning up ${numCPUs} High-Concurrency Workers...`);
  console.log('───────────────────────────────────────────────────');

  // Fork a worker for each CPU core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Auto-heal: If any worker dies, immediately resurrect a new one
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`⚠️  Worker PID ${worker.process.pid} died (signal: ${signal || code}). Resurrecting worker...`);
    cluster.fork();
  });
} else {
  // Worker process runs the server
  require('./server');
}
