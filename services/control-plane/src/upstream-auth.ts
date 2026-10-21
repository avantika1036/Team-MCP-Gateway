import { z } from 'zod';

const credentialSchema = z
  .string()
  .min(1, 'Credential must not be empty.')
  .max(4096, 'Credential must be 4096 characters or fewer.')
  .refine((value) => value.trim().length > 0, 'Credential must not be empty.')
  .refine((value) => !/[\r\n]/.test(value), 'Credential cannot contain line breaks.');

const forbiddenHeaders = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const customHeaderNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, 'Enter a valid HTTP header name.')
  .refine(
    (name) => !forbiddenHeaders.has(name.toLowerCase()),
    'This HTTP header is reserved and cannot be configured as a credential header.',
  );

export const upstreamAuthInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), credential: credentialSchema }),
  z.object({
    type: z.literal('header'),
    headerName: customHeaderNameSchema,
    credential: credentialSchema,
  }),
]);

export const upstreamAuthReferenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer') }),
  z.object({ type: z.literal('header'), headerName: customHeaderNameSchema }),
]);

export type UpstreamAuthInput = z.infer<typeof upstreamAuthInputSchema>;
export type UpstreamAuthReference = z.infer<typeof upstreamAuthReferenceSchema>;

export function authReferenceFromInput(input: UpstreamAuthInput): UpstreamAuthReference {
  return input.type === 'bearer'
    ? { type: 'bearer' }
    : { type: 'header', headerName: input.headerName };
}

export function credentialKeyForUpstream(id: string): string {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) {
    throw new Error('Invalid upstream ID.');
  }
  return `credential-${id}`;
}

export function buildCredentialHeaders(
  auth: UpstreamAuthReference,
  credential: string,
): Record<string, string> {
  if (!credential.trim() || credential.length > 4096) {
    throw new Error('Upstream credential is missing or invalid.');
  }
  if (auth.type === 'bearer') {
    return { Authorization: `Bearer ${credential}` };
  }
  const headerName = customHeaderNameSchema.parse(auth.headerName);
  return { [headerName]: credential };
}
