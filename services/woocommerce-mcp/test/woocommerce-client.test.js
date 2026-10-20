import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import test, { after, before } from 'node:test';

let httpServer;
let client;
let publicOrigin;
let transportOrigin;
let responseSpec = { status: 200, contentType: 'application/json', body: '[{"id":42}]' };
let latestRequest;
let requestCount = 0;

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

before(async () => {
  publicOrigin = 'http://store-two.urumi.test:8080';
  httpServer = createServer((request, response) => {
    requestCount += 1;
    latestRequest = {
      method: request.method,
      url: request.url,
      host: request.headers.host,
      headers: request.headers,
    };

    response.statusCode = responseSpec.status;
    response.setHeader('Content-Type', responseSpec.contentType);
    if (responseSpec.status >= 300 && responseSpec.status < 400) {
      response.setHeader('Location', responseSpec.location ?? `${publicOrigin}/redirected`);
    }
    response.end(responseSpec.body);
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind.');
  transportOrigin = `http://127.0.0.1:${address.port}`;

  process.env.WOOCOMMERCE_URL = publicOrigin;
  process.env.WOOCOMMERCE_TRANSPORT_URL = transportOrigin;
  process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_urumi_test_key';
  process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_urumi_test_secret';
  process.env.REQUEST_TIMEOUT_MS = '3000';

  const module = await import('../dist/woocommerce-client.js');
  client = new module.WooCommerceClient();
});

after(async () => {
  if (httpServer?.listening) {
    await new Promise((resolve, reject) =>
      httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('uses the REST route query fallback and signs the canonical root URL', async () => {
  responseSpec = {
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '[{"id":42}]',
  };
  latestRequest = undefined;
  requestCount = 0;

  const result = await client.request('GET', 'products', { per_page: 10 });
  assert.deepEqual(result, [{ id: 42 }]);
  assert.equal(latestRequest?.method, 'GET');
  assert.equal(latestRequest?.host, 'store-two.urumi.test:8080');
  assert.equal(requestCount, 1);

  const receivedUrl = new URL(latestRequest.url, transportOrigin);
  assert.equal(receivedUrl.pathname, '/');
  assert.equal(receivedUrl.searchParams.get('rest_route'), '/wc/v3/products/');
  assert.equal(receivedUrl.searchParams.get('per_page'), '10');

  const signature = receivedUrl.searchParams.get('oauth_signature');
  assert.ok(signature, 'OAuth signature should be present');
  const normalizedPairs = [...receivedUrl.searchParams.entries()]
    .filter(([key]) => key !== 'oauth_signature')
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = encodeRfc3986(leftKey).localeCompare(encodeRfc3986(rightKey));
      return keyComparison || encodeRfc3986(leftValue).localeCompare(encodeRfc3986(rightValue));
    });
  const normalizedParameters = normalizedPairs
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
  const signatureBase = [
    'GET',
    encodeRfc3986(publicOrigin),
    encodeRfc3986(normalizedParameters),
  ].join('&');
  const expectedSignature = createHmac('sha1', `${encodeRfc3986('cs_urumi_test_secret')}&`)
    .update(signatureBase)
    .digest('base64');

  assert.equal(signature, expectedSignature);
});

test('does not follow redirects from an authenticated REST request', async () => {
  responseSpec = {
    status: 301,
    contentType: 'text/html; charset=UTF-8',
    body: '',
    location: `${publicOrigin}/wp-json/wc/v3/products/`,
  };
  latestRequest = undefined;
  requestCount = 0;

  await assert.rejects(
    client.request('GET', 'products'),
    /WooCommerce API returned HTTP 301: Unexpected redirect/,
  );
  assert.equal(requestCount, 1, 'the client must not make a second request to the redirect target');
});

test('rejects HTML or empty bodies returned with a success status', async () => {
  responseSpec = {
    status: 200,
    contentType: 'text/html; charset=UTF-8',
    body: '<html>not API JSON</html>',
  };

  await assert.rejects(
    client.request('GET', 'products'),
    /non-JSON or empty response \(HTTP 200, text\/html/,
  );
});
