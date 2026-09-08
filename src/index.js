import { startWorkspace } from './workspace.js';
import { isCdpDisconnect } from './engine/cdp.js';

function ignoreDisconnect(error) {
  if (isCdpDisconnect(error)) return true;
  return false;
}

process.on('unhandledRejection', (error) => {
  if (ignoreDisconnect(error)) return;
  console.error(error);
});

process.on('uncaughtException', (error) => {
  if (ignoreDisconnect(error)) return;
  console.error(error);
  process.exit(1);
});

const started = await startWorkspace();
console.log(`workspace rail ${started.railUrl}`);
console.log(`engine ${started.engineKind} cdp :${started.enginePort}`);
