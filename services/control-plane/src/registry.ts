import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const serverSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  name: z.string().min(1).max(100),
  url: z.string().url(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const registrySchema = z.array(serverSchema);

export type UpstreamServer = z.infer<typeof serverSchema>;

type NewUpstream = Pick<UpstreamServer, 'id' | 'name' | 'url' | 'enabled'>;
type UpstreamPatch = Partial<Pick<UpstreamServer, 'name' | 'url' | 'enabled'>>;

export class ServerRegistry {
  private servers: UpstreamServer[] = [];
  private queue: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async open(filePath: string): Promise<ServerRegistry> {
    const registry = new ServerRegistry(filePath);

    await mkdir(dirname(filePath), { recursive: true });

    try {
      const contents = await readFile(filePath, 'utf8');
      registry.servers = registrySchema.parse(JSON.parse(contents));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await registry.persist([]);
    }

    return registry;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async persist(next: UpstreamServer[]): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;

    await writeFile(temporaryPath, JSON.stringify(next, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });

    await rename(temporaryPath, this.filePath);
  }

  async list(): Promise<UpstreamServer[]> {
    await this.queue;
    return this.servers.map((server) => ({ ...server }));
  }

  async add(input: NewUpstream): Promise<UpstreamServer> {
    return this.exclusive(async () => {
      if (this.servers.some((server) => server.id === input.id)) {
        throw new Error(`Upstream '${input.id}' already exists.`);
      }

      const now = new Date().toISOString();
      const created: UpstreamServer = {
        ...input,
        createdAt: now,
        updatedAt: now,
      };

      const next = [...this.servers, created];
      await this.persist(next);
      this.servers = next;

      return { ...created };
    });
  }

  async update(id: string, patch: UpstreamPatch): Promise<UpstreamServer | undefined> {
    return this.exclusive(async () => {
      const index = this.servers.findIndex((server) => server.id === id);
      if (index < 0) return undefined;

      const next = this.servers.map((server) =>
        server.id === id ? { ...server, ...patch, updatedAt: new Date().toISOString() } : server,
      );

      await this.persist(next);
      this.servers = next;

      return { ...next[index] };
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const next = this.servers.filter((server) => server.id !== id);
      if (next.length === this.servers.length) return false;

      await this.persist(next);
      this.servers = next;
      return true;
    });
  }
}
