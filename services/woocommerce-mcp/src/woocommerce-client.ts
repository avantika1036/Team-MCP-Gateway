import { createHmac, randomBytes } from 'node:crypto';
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
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\/+/, '')}`);

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
    const signatureBase = [
      method.toUpperCase(),
      encodeRfc3986(config.storeUrl + url.pathname),
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const responseText = await response.text();
      let payload: unknown;

      try {
        payload = responseText ? JSON.parse(responseText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        let message = response.statusText || 'Request failed';

        if (
          typeof payload === 'object' &&
          payload !== null &&
          'message' in payload &&
          typeof payload.message === 'string'
        ) {
          message = payload.message;
        }

        throw new Error(`WooCommerce API returned HTTP ${response.status}: ${message}`);
      }

      return payload as T;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('WooCommerce API request timed out.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
