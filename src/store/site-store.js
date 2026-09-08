import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { secretsPath, storePath } from '../paths.js';

const EMPTY_STORE = { sites: {} };
const EMPTY_SECRETS = { sites: {} };

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

function publicRecord(record) {
  const row = record || emptyRecord();
  return {
    phone: row.phone || '',
    username: row.username || '',
    loginMethod: row.loginMethod || '',
    passwordStored: Boolean(row.passwordStored),
    expiresAt: row.expiresAt || '',
    expiryMentionedFor: row.expiryMentionedFor || '',
    updatedAt: row.updatedAt || '',
  };
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (mode && existsSync(path)) chmodSync(path, mode);
}

export function createSiteStore() {
  let store = structuredClone(EMPTY_STORE);
  let secrets = structuredClone(EMPTY_SECRETS);

  return {
    async load() {
      store = await readJson(storePath(), EMPTY_STORE);
      if (!store.sites) store.sites = {};
      secrets = await readJson(secretsPath(), EMPTY_SECRETS);
      if (!secrets.sites) secrets.sites = {};
    },

    get(siteKey) {
      if (!siteKey) return null;
      const record = store.sites[siteKey];
      return record ? publicRecord(record) : null;
    },

    list() {
      return Object.entries(store.sites).map(([siteKey, record]) => ({
        siteKey,
        ...publicRecord(record),
      }));
    },

    // Write only after an explicit user confirm. Password never enters the public record.
    async confirmWrite(siteKey, fields, password) {
      if (!siteKey) throw new Error('confirmWrite requires a site key');
      const previous = store.sites[siteKey] || emptyRecord();
      const next = {
        ...previous,
        phone: fields.phone ?? previous.phone,
        username: fields.username ?? previous.username,
        loginMethod: fields.loginMethod ?? previous.loginMethod,
        expiresAt: fields.expiresAt ?? previous.expiresAt,
        passwordStored: previous.passwordStored,
        updatedAt: new Date().toISOString(),
      };

      if (fields.savePassword && typeof password === 'string' && password.length > 0) {
        secrets.sites[siteKey] = { password };
        next.passwordStored = true;
        await writeJson(secretsPath(), secrets, 0o600);
      }

      store.sites[siteKey] = next;
      await writeJson(storePath(), store, 0o600);
      return publicRecord(next);
    },

    async markExpiryMentioned(siteKey, expiresAt) {
      const record = store.sites[siteKey];
      if (!record) return null;
      record.expiryMentionedFor = expiresAt;
      record.updatedAt = new Date().toISOString();
      await writeJson(storePath(), store, 0o600);
      return publicRecord(record);
    },

    // Password is only returned to the engine fill path after confirm-fill.
    takePasswordForFill(siteKey) {
      return secrets.sites[siteKey]?.password || '';
    },

    // Rail / bubble view: never include password text.
    bubbleView(siteKey) {
      const record = this.get(siteKey);
      if (!record) return null;
      return {
        phone: record.phone,
        username: record.username,
        loginMethod: record.loginMethod,
        expiresAt: record.expiresAt,
        passwordStored: record.passwordStored,
        password: record.passwordStored ? '••••••••' : '',
      };
    },
  };
}
