import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeLoginMethod, siteKeyFromInput } from '../sites/catalog.js';
import { engineProfileDir, secretsPath, storePath } from '../paths.js';

const EMPTY_STORE = { sites: {} };
const EMPTY_SECRETS = { sites: {} };
const WORKSPACE_CONFIRM = { caller: 'workspace', confirmed: true };

function emptyRecord() {
  return {
    phone: '',
    username: '',
    loginMethod: '',
    passwordStored: false,
    expiresAt: '',
    expiryMentionedFor: '',
    updatedAt: '',
  };
}

// Public identity only. No password text, no internal mention bookkeeping.
function publicIdentity(record) {
  const row = record || emptyRecord();
  return {
    phone: row.phone || '',
    username: row.username || '',
    loginMethod: row.loginMethod || '',
    passwordStored: Boolean(row.passwordStored),
    expiresAt: row.expiresAt || '',
  };
}

function storedRecord(record) {
  const row = record || emptyRecord();
  return {
    ...publicIdentity(row),
    expiryMentionedFor: row.expiryMentionedFor || '',
    updatedAt: row.updatedAt || '',
  };
}

function requireWorkspaceConfirm(context, action) {
  if (context?.caller !== WORKSPACE_CONFIRM.caller || context?.confirmed !== true) {
    throw new Error(`${action} is only for the workspace after the user confirms`);
  }
}

function resolveSiteKey(siteKey) {
  return siteKeyFromInput(siteKey);
}

function assertMemoryAwayFromEngine() {
  const profile = engineProfileDir();
  for (const path of [storePath(), secretsPath()]) {
    if (path === profile || path.startsWith(`${profile}/`) || path.startsWith(`${profile}\\`)) {
      throw new Error('memory files must not live under engine-profile');
    }
  }
}

function tighten(path) {
  if (existsSync(path)) chmodSync(path, 0o600);
}

function pickNewer(left, right) {
  const a = Date.parse(left?.updatedAt || '') || 0;
  const b = Date.parse(right?.updatedAt || '') || 0;
  return b >= a ? { ...left, ...right } : { ...right, ...left };
}

function rekeyRecords(map) {
  const next = {};
  for (const [raw, value] of Object.entries(map || {})) {
    const key = resolveSiteKey(raw) || raw;
    next[key] = next[key] ? pickNewer(next[key], value) : value;
  }
  return next;
}

function rekeySecrets(map) {
  const next = {};
  for (const [raw, value] of Object.entries(map || {})) {
    const key = resolveSiteKey(raw) || raw;
    if (!next[key]) {
      next[key] = value;
      continue;
    }
    next[key] = value?.password ? value : next[key];
  }
  return next;
}

function keysChanged(before, after) {
  const left = Object.keys(before || {}).sort().join('\n');
  const right = Object.keys(after || {}).sort().join('\n');
  return left !== right;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

async function writeJson(path, value, mode) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  if (mode && existsSync(path)) chmodSync(path, mode);
}

export function createSiteStore() {
  assertMemoryAwayFromEngine();
  let store = structuredClone(EMPTY_STORE);
  let secrets = structuredClone(EMPTY_SECRETS);

  return {
    async load() {
      store = await readJson(storePath(), EMPTY_STORE);
      if (!store.sites) store.sites = {};
      secrets = await readJson(secretsPath(), EMPTY_SECRETS);
      if (!secrets.sites) secrets.sites = {};

      const previousSites = store.sites;
      const previousSecrets = secrets.sites;
      const nextSites = rekeyRecords(previousSites);
      const nextSecrets = rekeySecrets(previousSecrets);
      const changed =
        keysChanged(previousSites, nextSites) || keysChanged(previousSecrets, nextSecrets);
      store.sites = nextSites;
      secrets.sites = nextSecrets;
      tighten(storePath());
      tighten(secretsPath());
      if (changed) {
        await writeJson(storePath(), store, 0o600);
        if (Object.keys(secrets.sites).length || existsSync(secretsPath())) {
          await writeJson(secretsPath(), secrets, 0o600);
        }
      }
    },

    get(siteKey) {
      const key = resolveSiteKey(siteKey);
      if (!key) return null;
      const record = store.sites[key];
      return record ? storedRecord(record) : null;
    },

    list() {
      return Object.entries(store.sites).map(([siteKey, record]) => ({
        siteKey,
        ...storedRecord(record),
      }));
    },

    publicView(siteKey) {
      const record = this.get(siteKey);
      return record ? publicIdentity(record) : null;
    },

    // Write only after an explicit user confirm from the workspace.
    // Password never enters the public record. QR is only a login method.
    async confirmWrite(siteKey, fields, password, context = {}) {
      requireWorkspaceConfirm(context, 'confirmWrite');
      const key = resolveSiteKey(siteKey);
      if (!key) throw new Error('confirmWrite requires a site key');
      const previous = store.sites[key] || emptyRecord();
      const next = {
        ...previous,
        phone: fields.phone ?? previous.phone,
        username: fields.username ?? previous.username,
        loginMethod: normalizeLoginMethod(fields.loginMethod ?? previous.loginMethod),
        expiresAt: fields.expiresAt ?? previous.expiresAt,
        passwordStored: previous.passwordStored,
        updatedAt: new Date().toISOString(),
      };

      const secret = typeof password === 'string' ? password : '';
      if (fields.savePassword && secret.length > 0) {
        secrets.sites[key] = { password: secret };
        next.passwordStored = true;
        await writeJson(secretsPath(), secrets, 0o600);
      }

      store.sites[key] = next;
      await writeJson(storePath(), store, 0o600);
      return publicIdentity(next);
    },

    async markExpiryMentioned(siteKey, expiresAt) {
      const key = resolveSiteKey(siteKey);
      const record = store.sites[key];
      if (!record) return null;
      record.expiryMentionedFor = expiresAt;
      record.updatedAt = new Date().toISOString();
      await writeJson(storePath(), store, 0o600);
      return storedRecord(record);
    },

    // Password is only returned to the engine fill path after confirm-fill.
    // Never hand this to the rail or put it in /state.
    takePasswordForFill(siteKey, context = {}) {
      requireWorkspaceConfirm(context, 'takePasswordForFill');
      const key = resolveSiteKey(siteKey);
      return secrets.sites[key]?.password || '';
    },

    // Rail / bubble view: mask only. Never include password text.
    bubbleView(siteKey) {
      const record = this.publicView(siteKey);
      if (!record) return null;
      return {
        ...record,
        passwordMask: record.passwordStored ? '••••••••' : '',
      };
    },
  };
}
