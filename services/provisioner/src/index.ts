import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';

const port = Number(process.env.PORT ?? '4100');
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
const internalToken = process.env.PROVISIONER_INTERNAL_TOKEN?.trim() ?? '';
const chartPath = process.env.STORE_CHART_PATH ?? '/app/charts/store';
const baseDomain = (process.env.STORE_BASE_DOMAIN ?? 'urumi.test').trim().toLowerCase();
const urlScheme = (process.env.STORE_URL_SCHEME ?? 'http').trim().toLowerCase();
const urlPort = (process.env.STORE_URL_PORT ?? '8080').trim();
const maxStoresPerUser = Number(process.env.STORE_MAX_PER_USER ?? '3');
const gatewayNamespace = process.env.GATEWAY_NAMESPACE ?? 'urumi-platform';
const provisionerServiceAccount =
  process.env.PROVISIONER_SERVICE_ACCOUNT ?? 'urumi-platform-provisioner';
const storeOperatorClusterRole =
  process.env.STORE_OPERATOR_CLUSTERROLE ?? 'urumi-platform-store-operator';
const defaultStoreNamespacePrefix = process.env.STORE_NAMESPACE_PREFIX ?? 'urumi-store-';

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!internalToken) throw new Error('PROVISIONER_INTERNAL_TOKEN is required.');
if (!/^[a-z0-9.-]+$/.test(baseDomain) || baseDomain.startsWith('.') || baseDomain.endsWith('.')) {
  throw new Error('STORE_BASE_DOMAIN must be a DNS domain.');
}
if (!['http', 'https'].includes(urlScheme))
  throw new Error('STORE_URL_SCHEME must be http or https.');
if (urlPort && !/^\d{1,5}$/.test(urlPort))
  throw new Error('STORE_URL_PORT must be empty or a numeric port.');
if (!Number.isInteger(maxStoresPerUser) || maxStoresPerUser < 1 || maxStoresPerUser > 20) {
  throw new Error('STORE_MAX_PER_USER must be between 1 and 20.');
}

const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 5000 });
pool.on('error', (error: Error) =>
  console.error('Provisioner PostgreSQL pool error:', error.message),
);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9-]{1,19}$/,
      'Store ID must start with a letter and contain 2–20 lowercase letters, digits, or hyphens.',
    ),
  displayName: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9 .&'_-]{1,79}$/,
      'Display name may contain letters, numbers, spaces, periods, ampersands, apostrophes, underscores, and hyphens.',
    ),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerEmail: z.string().trim().email().max(254).nullable().optional(),
});

type StoreStatus = 'provisioning' | 'ready' | 'deleting' | 'failed' | 'deleted';
interface StoreRecord {
  slug: string;
  displayName: string;
  namespace: string;
  releaseName: string;
  host: string;
  siteUrl: string;
  upstreamId: string;
  mcpUrl: string;
  status: StoreStatus;
  ownerUserId: string | null;
  ownerEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  errorMessage: string | null;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown provisioning error.';
  return message
    .replace(
      /(password|secret|consumer[-_ ]?(key|secret)|api[-_ ]?key)\s*[:=]\s*\S+/gi,
      '$1=[redacted]',
    )
    .slice(0, 1000);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const requireInternalToken: RequestHandler = (request, response, next) => {
  const supplied = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
  if (!supplied || !constantTimeEqual(supplied, internalToken)) {
    response.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  next();
};

function randomPassword(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function runCommand(
  command: string,
  args: string[],
  stdin?: string,
  timeoutMs = 12 * 60 * 1000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        HELM_CACHE_HOME: process.env.HELM_CACHE_HOME ?? '/tmp/helm/cache',
        HELM_CONFIG_HOME: process.env.HELM_CONFIG_HOME ?? '/tmp/helm/config',
        HELM_DATA_HOME: process.env.HELM_DATA_HOME ?? '/tmp/helm/data',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            `${command} exited with ${code ?? signal}: ${stderr.trim() || stdout.trim() || 'no output'}`,
          ),
        );
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

async function applyYaml(yaml: string): Promise<void> {
  await runCommand('kubectl', ['apply', '-f', '-'], yaml, 30000);
}

function roleBindingYaml(namespace: string): string {
  return `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: urumi-store-operator
  namespace: ${namespace}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${storeOperatorClusterRole}
subjects:
  - kind: ServiceAccount
    name: ${provisionerServiceAccount}
    namespace: ${gatewayNamespace}
`;
}

function resourcesYaml(namespace: string): string {
  return `apiVersion: v1
kind: ResourceQuota
metadata:
  name: store-resource-quota
  namespace: ${namespace}
spec:
  hard:
    pods: "10"
    requests.cpu: "2"
    requests.memory: 2Gi
    limits.cpu: "4"
    limits.memory: 4Gi
    persistentvolumeclaims: "3"
    requests.storage: 15Gi
---
apiVersion: v1
kind: LimitRange
metadata:
  name: store-limit-range
  namespace: ${namespace}
spec:
  limits:
    - type: Container
      default:
        cpu: 500m
        memory: 512Mi
      defaultRequest:
        cpu: 50m
        memory: 96Mi
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: store-default-isolation
  namespace: ${namespace}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ${namespace}
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
      ports:
        - protocol: TCP
          port: 80
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ${namespace}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-store-mcp
  namespace: ${namespace}
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/component: woocommerce-mcp
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ${gatewayNamespace}
      ports:
        - protocol: TCP
          port: 3002
`;
}

async function createNamespace(namespace: string): Promise<void> {
  await runCommand('kubectl', ['create', 'namespace', namespace], undefined, 30000);
}

async function deleteNamespace(namespace: string): Promise<void> {
  try {
    await runCommand(
      'kubectl',
      [
        'delete',
        'namespace',
        namespace,
        '--ignore-not-found=true',
        '--wait=true',
        '--timeout=180s',
      ],
      undefined,
      210000,
    );
  } catch (error) {
    throw new Error(`Namespace cleanup failed for ${namespace}: ${safeError(error)}`);
  }
}

async function installStore(store: StoreRecord): Promise<void> {
  const rootPassword = randomPassword();
  const dbPassword = randomPassword();
  const adminPassword = randomPassword();
  const wordpressSecret = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: store-credentials\n  namespace: ${store.namespace}\ntype: Opaque\ndata:\n  db-root-password: ${base64(rootPassword)}\n  db-password: ${base64(dbPassword)}\n  wordpress-admin-password: ${base64(adminPassword)}\n`;

  await applyYaml(roleBindingYaml(store.namespace));
  await applyYaml(resourcesYaml(store.namespace));
  await applyYaml(wordpressSecret);

  const commonValues = [
    '--set',
    'credentials.create=false',
    '--set-string',
    'credentials.existingSecret=store-credentials',
    '--set',
    'ingress.enabled=true',
    '--set-string',
    `ingress.host=${store.host}`,
    '--set-string',
    `wordpress.siteUrl=${store.siteUrl}`,
    '--set-string',
    `wordpress.title=${store.displayName}`,
  ];
  await runCommand(
    'helm',
    [
      'upgrade',
      '--install',
      store.releaseName,
      chartPath,
      '--namespace',
      store.namespace,
      '--wait',
      '--timeout',
      '10m',
      ...commonValues,
      '--set',
      'mcp.enabled=false',
    ],
    undefined,
    11 * 60 * 1000,
  );

  // Generate a real WooCommerce REST API key inside this store's own WordPress pod.
  // The secret is output only to this process and immediately written to a Kubernetes Secret.
  const php = `global $wpdb; $u=get_user_by('login','storeadmin'); if (!$u) { fwrite(STDERR,'Store admin user not found'); exit(2); } $ck='ck_'.wc_rand_hash(); $cs='cs_'.wc_rand_hash(); $ok=$wpdb->insert($wpdb->prefix.'woocommerce_api_keys', ['user_id'=>$u->ID,'description'=>'Urumi MCP Gateway','permissions'=>'read_write','consumer_key'=>wc_api_hash($ck),'consumer_secret'=>$cs,'truncated_key'=>substr($ck,-7)], ['%d','%s','%s','%s','%s','%s']); if (!$ok) { fwrite(STDERR,'WooCommerce API credential creation failed'); exit(3); } echo wp_json_encode(['consumerKey'=>$ck,'consumerSecret'=>$cs]);`;
  const keyResult = await runCommand(
    'kubectl',
    [
      'exec',
      '-n',
      store.namespace,
      `deployment/${store.releaseName}`,
      '--',
      'wp',
      '--path=/var/www/html',
      '--allow-root',
      'eval',
      php,
    ],
    undefined,
    60000,
  );
  const jsonLine = keyResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .at(-1);
  if (!jsonLine) throw new Error('WooCommerce did not return API credentials.');
  const apiCredentials = z
    .object({
      consumerKey: z.string().startsWith('ck_'),
      consumerSecret: z.string().startsWith('cs_'),
    })
    .parse(JSON.parse(jsonLine));
  const wooSecret = `apiVersion: v1\nkind: Secret\nmetadata:\n  name: woocommerce-api-credentials\n  namespace: ${store.namespace}\ntype: Opaque\ndata:\n  consumer-key: ${base64(apiCredentials.consumerKey)}\n  consumer-secret: ${base64(apiCredentials.consumerSecret)}\n`;
  await applyYaml(wooSecret);

  await runCommand(
    'helm',
    [
      'upgrade',
      '--install',
      store.releaseName,
      chartPath,
      '--namespace',
      store.namespace,
      '--wait',
      '--timeout',
      '10m',
      ...commonValues,
      '--set',
      'mcp.enabled=true',
    ],
    undefined,
    11 * 60 * 1000,
  );

  await runCommand(
    'kubectl',
    [
      'rollout',
      'status',
      `deployment/${store.releaseName}-mcp`,
      '-n',
      store.namespace,
      '--timeout=180s',
    ],
    undefined,
    210000,
  );
}

async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS provisioned_stores (
      slug TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      namespace TEXT NOT NULL UNIQUE,
      release_name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL UNIQUE,
      site_url TEXT NOT NULL,
      upstream_id TEXT NOT NULL UNIQUE,
      mcp_url TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('provisioning','ready','deleting','failed','deleted')),
      owner_user_id UUID,
      owner_email TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS provisioned_stores_owner_status_idx
      ON provisioned_stores (owner_user_id, status, deleted_at);
  `);
}

const storeSelect = `slug, display_name AS "displayName", namespace,
  release_name AS "releaseName", host, site_url AS "siteUrl",
  upstream_id AS "upstreamId", mcp_url AS "mcpUrl", status,
  owner_user_id AS "ownerUserId", owner_email AS "ownerEmail",
  created_at AS "createdAt", updated_at AS "updatedAt",
  deleted_at AS "deletedAt", error_message AS "errorMessage"`;

async function findStore(slug: string): Promise<StoreRecord | null> {
  const result = await pool.query<StoreRecord>(
    `SELECT ${storeSelect} FROM provisioned_stores WHERE slug = $1`,
    [slug],
  );
  return result.rows[0] ?? null;
}

app.get('/healthz', (_request, response) =>
  response.json({ status: 'ok', service: 'urumi-provisioner' }),
);

app.use('/stores', requireInternalToken);

app.get('/stores', async (_request, response) => {
  const result = await pool.query<StoreRecord>(
    `SELECT ${storeSelect} FROM provisioned_stores WHERE status <> 'deleted' ORDER BY created_at DESC LIMIT 100`,
  );
  response.json({ stores: result.rows, maxStoresPerUser });
});

app.post('/stores', async (request, response) => {
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) {
    response
      .status(400)
      .json({ error: 'Invalid store configuration.', details: parsed.error.issues });
    return;
  }
  const { slug, displayName } = parsed.data;
  const ownerUserId = parsed.data.ownerUserId ?? null;
  const ownerEmail = parsed.data.ownerEmail ?? null;
  const namespace = `${defaultStoreNamespacePrefix}${slug}`;
  const releaseName = `store-${slug}`;
  const upstreamId = `store-${slug}`;
  const host = `${slug}.${baseDomain}`;
  const siteUrl = `${urlScheme}://${host}${urlPort ? `:${urlPort}` : ''}`;
  const mcpUrl = `http://${releaseName}-mcp.${namespace}.svc.cluster.local:3002/mcp`;

  const knownStore = await findStore(slug);
  if (knownStore && knownStore.status !== 'deleted') {
    const ageMs = Date.now() - new Date(knownStore.updatedAt).getTime();
    const stale = ageMs > 30 * 60 * 1000;
    const recoverable =
      knownStore.status === 'failed' ||
      (stale && ['provisioning', 'deleting'].includes(knownStore.status));

    if (!recoverable) {
      response.status(409).json({
        error:
          knownStore.status === 'provisioning'
            ? `Store '${slug}' is still provisioning. Retry after it finishes.`
            : `Store '${slug}' already exists or is being provisioned.`,
      });
      return;
    }

    // Recover a failed or stale operation only when a matching state record proves
    // that this provisioner previously owned the namespace/release.
    try {
      try {
        await runCommand(
          'helm',
          [
            'uninstall',
            knownStore.releaseName,
            '-n',
            knownStore.namespace,
            '--wait',
            '--timeout',
            '3m',
          ],
          undefined,
          210000,
        );
      } catch (error) {
        const detail = safeError(error).toLowerCase();
        if (
          !detail.includes('release not loaded') &&
          !detail.includes('no deployed releases') &&
          !detail.includes('not found')
        )
          throw error;
      }
      await deleteNamespace(knownStore.namespace);
      await pool.query(
        `UPDATE provisioned_stores SET status='deleted', deleted_at=NOW(), updated_at=NOW(), error_message=NULL WHERE slug=$1`,
        [slug],
      );
    } catch (error) {
      response
        .status(500)
        .json({ error: `Could not recover the previous store operation: ${safeError(error)}` });
      return;
    }
  }

  try {
    await runCommand('kubectl', ['get', 'namespace', namespace, '-o', 'name'], undefined, 30000);
    response.status(409).json({
      error: `Kubernetes namespace '${namespace}' already exists. Refusing to adopt or delete it.`,
    });
    return;
  } catch (error) {
    const detail = safeError(error).toLowerCase();
    if (!detail.includes('not found')) {
      response
        .status(503)
        .json({ error: `Could not verify namespace availability: ${safeError(error)}` });
      return;
    }
  }

  if (ownerUserId) {
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM provisioned_stores
       WHERE owner_user_id = $1 AND deleted_at IS NULL AND status IN ('provisioning','ready','deleting')`,
      [ownerUserId],
    );
    if (Number(count.rows[0]?.count ?? '0') >= maxStoresPerUser) {
      response.status(429).json({
        error: `This account has reached the maximum of ${maxStoresPerUser} active stores.`,
      });
      return;
    }
  }

  const row = await pool.query<StoreRecord>(
    `INSERT INTO provisioned_stores
      (slug, display_name, namespace, release_name, host, site_url, upstream_id, mcp_url, status, owner_user_id, owner_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'provisioning',$9,$10)
     ON CONFLICT (slug) DO UPDATE SET
       display_name=EXCLUDED.display_name, namespace=EXCLUDED.namespace,
       release_name=EXCLUDED.release_name, host=EXCLUDED.host, site_url=EXCLUDED.site_url,
       upstream_id=EXCLUDED.upstream_id, mcp_url=EXCLUDED.mcp_url, status='provisioning',
       owner_user_id=EXCLUDED.owner_user_id, owner_email=EXCLUDED.owner_email,
       error_message=NULL, deleted_at=NULL, created_at=NOW(), updated_at=NOW()
     WHERE provisioned_stores.status = 'deleted'
     RETURNING ${storeSelect}`,
    [
      slug,
      displayName,
      namespace,
      releaseName,
      host,
      siteUrl,
      upstreamId,
      mcpUrl,
      ownerUserId,
      ownerEmail,
    ],
  );
  if (!row.rows[0]) {
    response.status(409).json({ error: `Store '${slug}' is already active.` });
    return;
  }

  let namespaceCreated = false;
  let helmReleaseAttempted = false;
  try {
    await createNamespace(namespace);
    namespaceCreated = true;
    helmReleaseAttempted = true;
    await installStore(row.rows[0]);
    const updated = await pool.query<StoreRecord>(
      `UPDATE provisioned_stores SET status='ready', updated_at=NOW(), error_message=NULL
       WHERE slug=$1 RETURNING ${storeSelect}`,
      [slug],
    );
    response.status(201).json({ store: updated.rows[0] });
  } catch (error) {
    const detail = safeError(error);
    console.error(`Store provisioning failed for '${slug}':`, detail);
    if (helmReleaseAttempted) {
      try {
        await runCommand(
          'helm',
          ['uninstall', releaseName, '-n', namespace, '--wait', '--timeout', '3m'],
          undefined,
          210000,
        );
      } catch (cleanupError) {
        console.error(`Helm rollback failed for '${slug}':`, safeError(cleanupError));
      }
    }
    if (namespaceCreated) {
      try {
        await deleteNamespace(namespace);
      } catch (cleanupError) {
        console.error(`Namespace rollback failed for '${slug}':`, safeError(cleanupError));
      }
    }
    await pool.query(
      namespaceCreated
        ? `UPDATE provisioned_stores SET status='failed', updated_at=NOW(), error_message=$2 WHERE slug=$1`
        : `UPDATE provisioned_stores SET status='deleted', deleted_at=NOW(), updated_at=NOW(), error_message=$2 WHERE slug=$1`,
      [slug, detail],
    );
    response.status(500).json({ error: `Store provisioning failed: ${detail}`, slug });
  }
});

app.delete('/stores/:slug', async (request, response) => {
  const parsedSlug = z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,19}$/)
    .safeParse(request.params.slug);
  if (!parsedSlug.success) {
    response.status(400).json({ error: 'Invalid store ID.' });
    return;
  }
  const store = await findStore(parsedSlug.data);
  if (!store || store.status === 'deleted') {
    response.status(404).json({ error: 'Store not found.' });
    return;
  }
  const operationAgeMs = Date.now() - new Date(store.updatedAt).getTime();
  if (['provisioning', 'deleting'].includes(store.status) && operationAgeMs <= 30 * 60 * 1000) {
    response.status(409).json({
      error: `Store operation is still ${store.status}. Retry cleanup after 30 minutes if it is stuck.`,
    });
    return;
  }
  await pool.query(
    `UPDATE provisioned_stores SET status='deleting', updated_at=NOW() WHERE slug=$1`,
    [store.slug],
  );
  try {
    try {
      await runCommand(
        'helm',
        ['uninstall', store.releaseName, '-n', store.namespace, '--wait', '--timeout', '4m'],
        undefined,
        270000,
      );
    } catch (error) {
      const message = safeError(error).toLowerCase();
      if (
        !message.includes('release not loaded') &&
        !message.includes('no deployed releases') &&
        !message.includes('not found')
      )
        throw error;
    }
    await deleteNamespace(store.namespace);
    const updated = await pool.query<StoreRecord>(
      `UPDATE provisioned_stores SET status='deleted', deleted_at=NOW(), updated_at=NOW(), error_message=NULL
       WHERE slug=$1 RETURNING ${storeSelect}`,
      [store.slug],
    );
    response.json({ store: updated.rows[0], deleted: true });
  } catch (error) {
    const detail = safeError(error);
    await pool.query(
      `UPDATE provisioned_stores SET status='failed', updated_at=NOW(), error_message=$2 WHERE slug=$1`,
      [store.slug, detail],
    );
    console.error(`Store deletion failed for '${store.slug}':`, detail);
    response.status(500).json({ error: `Store deletion failed: ${detail}` });
  }
});

await ensureSchema();
const server = app.listen(port, '0.0.0.0', () =>
  console.info(`Provisioner listening on 0.0.0.0:${port}`),
);

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
