import { createHmac, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from './config.js';

type QueryValue = string | number | boolean | undefined;

export interface WooProduct {
  id: number;
  name: string;
  type: string;
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  permalink: string;
}

export interface WooOrderLineItem {
  id: number;
  name: string;
  quantity: number;
  total: string;
  sku?: string;
}

export interface WooOrder {
  id: number;
  status: string;
  date_created: string;
  date_modified: string;
  total: string;
  currency: string;
  payment_method: string;
  customer_note: string;
  line_items: WooOrderLineItem[];
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class WooCommerceClient {
  private readonly baseUrl = config.apiBaseUrl;

  private createSignedUrl(
    method: string,
    endpoint: string,
    query: Record<string, QueryValue> = {},
  ): URL {
    // Use WordPress's explicit REST router instead of the pretty /wp-json path.
    // Some local WordPress/Apache combinations return the storefront HTML with HTTP
    // 200 for /wp-json routes, which is not a valid WooCommerce API response. The
    // rest_route query parameter is supported by WordPress core and also participates
    // in the OAuth signature below.
    const normalizedEndpoint = endpoint.replace(/^\/+/, '').replace(/\/+$/, '');
    const url = new URL('/', this.baseUrl);
    url.searchParams.set('rest_route', `/wc/v3/${normalizedEndpoint}/`);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    // WooCommerce supports one-legged OAuth 1.0a for HTTP API requests.
    // The Consumer Secret is used only as the HMAC signing key.
    const oauth: Record<string, string> = {
      oauth_consumer_key: config.consumerKey,
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    };

    const pairs: Array<[string, string]> = [
      ...url.searchParams.entries(),
      ...Object.entries(oauth),
    ];

    pairs.sort((left, right) => {
      const keyComparison = compareStrings(encodeRfc3986(left[0]), encodeRfc3986(right[0]));
      if (keyComparison !== 0) return keyComparison;

      return compareStrings(encodeRfc3986(left[1]), encodeRfc3986(right[1]));
    });

    const normalizedParameters = pairs
      .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
      .join('&');

    // Sign the URL as it is sent to WooCommerce, including its path
    // and non-OAuth query parameters, but excluding the signature.
    // With WordPress's `?rest_route=` fallback, the HTTP request path is `/`.
    // WooCommerce strips the home URL prefix from that path before rebuilding
    // the signature URL, so its canonical base URL is the home URL without a
    // trailing slash (not `home URL + /`). For pretty REST paths, sign the
    // actual canonical path as usual.
    const signatureUrl = url.searchParams.has('rest_route')
      ? config.storeUrl.replace(/\/$/, '')
      : `${config.storeUrl}${url.pathname}`;

    const signatureBase = [
      method.toUpperCase(),
      encodeRfc3986(signatureUrl),
      encodeRfc3986(normalizedParameters),
    ].join('&');

    const signingKey = `${encodeRfc3986(config.consumerSecret)}&`;
    const signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64');

    for (const [key, value] of Object.entries(oauth)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('oauth_signature', signature);

    return url;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    endpoint: string,
    query: Record<string, QueryValue> = {},
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = this.createSignedUrl(method, endpoint, query);
    const publicHost = new URL(config.storeUrl).host;
    const response = await new Promise<{
      statusCode: number;
      statusMessage: string;
      location?: string;
      contentType?: string;
      body: string;
    }>((resolve, reject) => {
      const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      let timeout: NodeJS.Timeout | undefined;
      const clearRequestTimeout = () => {
        if (timeout) clearTimeout(timeout);
      };

      const request = requestFn(
        url,
        {
          method,
          // Connect to the internal Kubernetes Service, while presenting the public
          // canonical host to WordPress. Node's fetch/Undici does not reliably allow
          // overriding the Host header, and WordPress otherwise redirects an internal
          // request to the public port (8080), which is blocked by store egress policy.
          headers: {
            Host: publicHost,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          incoming.on('error', (error) => {
            clearRequestTimeout();
            reject(error);
          });
          incoming.on('end', () => {
            clearRequestTimeout();
            resolve({
              statusCode: incoming.statusCode ?? 0,
              statusMessage: incoming.statusMessage ?? '',
              location: incoming.headers.location,
              contentType: Array.isArray(incoming.headers['content-type'])
                ? incoming.headers['content-type'][0]
                : incoming.headers['content-type'],
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      timeout = setTimeout(() => {
        request.destroy(new Error('WooCommerce API request timed out.'));
      }, config.requestTimeoutMs);

      request.on('error', (error) => {
        clearRequestTimeout();
        reject(error);
      });

      if (body) request.write(JSON.stringify(body));
      request.end();
    });

    let payload: unknown;
    let invalidJson = false;
    try {
      payload = response.body ? JSON.parse(response.body) : null;
    } catch {
      payload = null;
      invalidJson = true;
    }

    // Never automatically follow API redirects: OAuth credentials are in the signed
    // query string, and following a redirect may leak them to a different host.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      let message = response.statusMessage || 'Request failed';

      if (
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
      ) {
        message = payload.message;
      } else if (response.statusCode >= 300 && response.statusCode < 400) {
        let redirectTarget = '';
        if (response.location) {
          try {
            const parsedLocation = new URL(response.location, url);
            // Do not include the redirect query string: WooCommerce OAuth credentials
            // and signatures are carried in the original request query.
            redirectTarget = ` to ${parsedLocation.origin}${parsedLocation.pathname}`;
          } catch {
            // Keep the diagnostic safe even if the upstream returns an invalid Location.
          }
        }
        message = `Unexpected redirect${redirectTarget}. Check the WordPress canonical URL and Host configuration.`;
      }

      throw new Error(`WooCommerce API returned HTTP ${response.statusCode}: ${message}`);
    }

    if (invalidJson || payload === null) {
      const contentType = response.contentType ?? 'unknown content type';
      throw new Error(
        `WooCommerce API returned a non-JSON or empty response (HTTP ${response.statusCode}, ${contentType}). Check WordPress REST routing and canonical URL configuration.`,
      );
    }

    return payload as T;
  }
}
