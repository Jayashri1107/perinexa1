// Starts or stops the local MongoDB database used for development.
// Data lives in ./.mongo-data (ignored by git) and only accepts connections from this computer.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = `${root}.mongo-data`;
const PORT = 27017;

const isRunning = () =>
  new Promise((resolve) => {
    const socket = net.connect(PORT, '127.0.0.1');
    socket.once('connect', () => (socket.end(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

const command = process.argv[2];

if (command === 'start') {
  if (await isRunning()) {
    console.log('✅ Database already running.');
  } else {
    mkdirSync(dataDir, { recursive: true });
    try {
      // maxNumActiveUserIndexBuilds: MongoDB builds only 3 indexes at a time by default. Every test file creates the
      // indexes of ~45 collections on a fresh test database, which then took longer than the tests' 20-second setup
      // limit (and queued for hours when several copies ran tests). 64 lets them build together.
      execFileSync(
        'mongod',
        [
          '--dbpath', dataDir, '--bind_ip', '127.0.0.1', '--port', String(PORT), '--fork', '--logpath', `${dataDir}/mongod.log`,
          '--setParameter', 'maxNumActiveUserIndexBuilds=64',
        ],
        { stdio: 'ignore' },
      );
      console.log('✅ Database started.');
    } catch {
      console.error(`❌ Could not start the database. Details are in ${dataDir}/mongod.log`);
      process.exit(1);
    }
  }
} else if (command === 'stop') {
  if (!(await isRunning())) {
    console.log('Database is not running.');
  } else {
    try {
      execFileSync('mongosh', ['--quiet', 'admin', '--eval', 'db.shutdownServer()'], { stdio: 'ignore' });
    } catch {
      /* mongosh reports a lost connection when the server shuts down; that is expected */
    }
    console.log('✅ Database stopped.');
  }
} else {
  console.log('Usage: node scripts/db.mjs start|stop');
}
