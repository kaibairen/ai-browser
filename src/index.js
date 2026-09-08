import { startWorkspace } from './workspace.js';

const started = await startWorkspace();
console.log(`workspace rail ${started.railUrl}`);
console.log(`engine ${started.engineKind} cdp :${started.enginePort}`);
