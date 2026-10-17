import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';

import { config } from './config.js';

export type UserRole = 'admin' | 'member';

export interface AuthenticatedIdentity {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  apiKeyId: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  activeKeyCount?: number;
}

export interface PublicApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreatedUserWithKey {
  user: PublicUser;
  apiKey: string;
  key: PublicApiKey;
}

export interface AuditEventInput {
  identity: AuthenticatedIdentity;
  upstreamId: string;
  toolName: string;
  exposedToolName: string;
}

export interface PublicAuditEvent {
  id: string;
  userId: string | null;
  userEmail: string;
  apiKeyId: string | null;
  upstreamId: string;
  toolName: string;
  exposedToolName: string;
  outcome: 'started' | 'success' | 'error';
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  errorMessage: string | null;
}

const pool = new Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {}),
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: 'urumi-control-plane',
});

pool.on('error', (error: Error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function initializeDatabase(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL must be set before initializing the identity and audit database.',
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gateway_users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS gateway_users_email_lower_uq
      ON gateway_users (LOWER(email));

    CREATE TABLE IF NOT EXISTS gateway_api_keys (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES gateway_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash CHAR(64) NOT NULL,
      created_by UUID REFERENCES gateway_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS gateway_api_keys_prefix_idx
      ON gateway_api_keys (key_prefix);

    CREATE INDEX IF NOT EXISTS gateway_api_keys_user_created_idx
      ON gateway_api_keys (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS gateway_audit_events (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES gateway_users(id) ON DELETE SET NULL,
      user_email TEXT NOT NULL,
      api_key_id UUID REFERENCES gateway_api_keys(id) ON DELETE SET NULL,
      upstream_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      exposed_tool_name TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('started', 'success', 'error')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS gateway_audit_events_created_idx
      ON gateway_audit_events (started_at DESC);

    CREATE INDEX IF NOT EXISTS gateway_audit_events_user_created_idx
      ON gateway_audit_events (user_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS gateway_audit_events_upstream_created_idx
      ON gateway_audit_events (upstream_id, started_at DESC);
  `);
}

function generateApiKey(): string {
  return `urm_live_${randomBytes(32).toString('base64url')}`;
}

function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

function isMatchingHash(candidate: string, stored: string): boolean {
  const candidateBuffer = Buffer.from(candidate, 'hex');
  const storedBuffer = Buffer.from(stored, 'hex');

  return (
    candidateBuffer.length === storedBuffer.length &&
    candidateBuffer.length > 0 &&
    timingSafeEqual(candidateBuffer, storedBuffer)
  );
}

export async function createUserWithApiKey(input: {
  email: string;
  displayName: string;
  role: UserRole;
  keyName: string;
}): Promise<CreatedUserWithKey> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userId = randomUUID();
    const userResult = await client.query<PublicUser>(
      `
        INSERT INTO gateway_users (id, email, display_name, role)
        VALUES ($1, $2, $3, $4)
        RETURNING
          id,
          email,
          display_name AS "displayName",
          role,
          is_active AS "isActive",
          created_at AS "createdAt"
      `,
      [userId, input.email.trim().toLowerCase(), input.displayName.trim(), input.role],
    );

    const apiKey = generateApiKey();
    const apiKeyId = randomUUID();
    const keyPrefix = apiKey.slice(0, 24);

    const keyResult = await client.query<PublicApiKey>(
      `
        INSERT INTO gateway_api_keys (
          id, user_id, name, key_prefix, key_hash
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          name,
          key_prefix AS "keyPrefix",
          created_at AS "createdAt",
          expires_at AS "expiresAt"
      `,
      [apiKeyId, userId, input.keyName.trim(), keyPrefix, hashApiKey(apiKey)],
    );

    await client.query('COMMIT');

    return {
      user: userResult.rows[0],
      apiKey,
      key: keyResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createApiKeyForUser(
  userId: string,
  keyName: string,
): Promise<{ apiKey: string; key: PublicApiKey }> {
  const apiKey = generateApiKey();
  const keyId = randomUUID();

  const result = await pool.query<PublicApiKey>(
    `
      INSERT INTO gateway_api_keys (id, user_id, name, key_prefix, key_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        name,
        key_prefix AS "keyPrefix",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
    `,
    [keyId, userId, keyName.trim(), apiKey.slice(0, 24), hashApiKey(apiKey)],
  );

  return { apiKey, key: result.rows[0] };
}

export async function listUsers(): Promise<PublicUser[]> {
  const result = await pool.query<PublicUser>(
    `
      SELECT
        u.id,
        u.email,
        u.display_name AS "displayName",
        u.role,
        u.is_active AS "isActive",
        u.created_at AS "createdAt",
        COUNT(k.id) FILTER (
          WHERE k.revoked_at IS NULL
            AND (k.expires_at IS NULL OR k.expires_at > NOW())
        )::INTEGER AS "activeKeyCount"
      FROM gateway_users u
      LEFT JOIN gateway_api_keys k ON k.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `,
  );

  return result.rows;
}

export async function revokeApiKey(keyId: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE gateway_api_keys
      SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id
    `,
    [keyId],
  );

  return result.rowCount === 1;
}

export async function authenticateApiKey(apiKey: string): Promise<AuthenticatedIdentity | null> {
  if (apiKey.length < 40 || apiKey.length > 200 || !apiKey.startsWith('urm_live_')) {
    return null;
  }

  const keyPrefix = apiKey.slice(0, 24);
  const candidateHash = hashApiKey(apiKey);

  const result = await pool.query<{
    apiKeyId: string;
    keyHash: string;
    userId: string;
    email: string;
    displayName: string;
    role: UserRole;
  }>(
    `
      SELECT
        k.id AS "apiKeyId",
        k.key_hash AS "keyHash",
        u.id AS "userId",
        u.email,
        u.display_name AS "displayName",
        u.role
      FROM gateway_api_keys k
      JOIN gateway_users u ON u.id = k.user_id
      WHERE k.key_prefix = $1
        AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND u.is_active = TRUE
    `,
    [keyPrefix],
  );

  for (const row of result.rows) {
    if (!isMatchingHash(candidateHash, row.keyHash)) continue;

    await pool.query('UPDATE gateway_api_keys SET last_used_at = NOW() WHERE id = $1', [
      row.apiKeyId,
    ]);

    return {
      userId: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      apiKeyId: row.apiKeyId,
    };
  }

  return null;
}

export async function startAuditEvent(
  input: AuditEventInput,
): Promise<{ id: string; startedAtMs: number }> {
  const id = randomUUID();
  const startedAtMs = Date.now();

  await pool.query(
    `
      INSERT INTO gateway_audit_events (
        id,
        user_id,
        user_email,
        api_key_id,
        upstream_id,
        tool_name,
        exposed_tool_name,
        outcome
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'started')
    `,
    [
      id,
      input.identity.userId,
      input.identity.email,
      input.identity.apiKeyId,
      input.upstreamId,
      input.toolName,
      input.exposedToolName,
    ],
  );

  return { id, startedAtMs };
}

export async function finishAuditEvent(input: {
  id: string;
  startedAtMs: number;
  outcome: 'success' | 'error';
  errorMessage?: string;
}): Promise<void> {
  const durationMs = Math.max(0, Date.now() - input.startedAtMs);
  const errorMessage = input.errorMessage?.slice(0, 1000) ?? null;

  await pool.query(
    `
      UPDATE gateway_audit_events
      SET
        completed_at = NOW(),
        duration_ms = $2,
        outcome = $3,
        error_message = $4
      WHERE id = $1
    `,
    [input.id, durationMs, input.outcome, errorMessage],
  );
}

export async function listAuditEvents(options: {
  limit: number;
  userId?: string;
}): Promise<PublicAuditEvent[]> {
  const result = await pool.query<PublicAuditEvent>(
    `
      SELECT
        id,
        user_id AS "userId",
        user_email AS "userEmail",
        api_key_id AS "apiKeyId",
        upstream_id AS "upstreamId",
        tool_name AS "toolName",
        exposed_tool_name AS "exposedToolName",
        outcome,
        started_at AS "startedAt",
        completed_at AS "completedAt",
        duration_ms AS "durationMs",
        error_message AS "errorMessage"
      FROM gateway_audit_events
      WHERE ($2::UUID IS NULL OR user_id = $2::UUID)
      ORDER BY started_at DESC
      LIMIT $1
    `,
    [options.limit, options.userId ?? null],
  );

  return result.rows;
}

export interface ApiKeyRecord extends PublicApiKey {
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const result = await pool.query<ApiKeyRecord>(
    `
      SELECT
        id,
        name,
        key_prefix AS "keyPrefix",
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        last_used_at AS "lastUsedAt",
        revoked_at AS "revokedAt"
      FROM gateway_api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId],
  );

  return result.rows;
}
