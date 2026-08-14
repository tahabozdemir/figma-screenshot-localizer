/**
 * Providers driven by a scripted transport.
 *
 * This is the half of the codebase that used to be untestable: batching, the
 * retry policy, status-code mapping, the malformed-JSON nudge and the DeepL
 * endpoint routing all only ran with a real API key and a real network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  langByCode,
  OpenAIProvider,
  GeminiProvider,
  GoogleTranslateProvider,
  GoogleFreeProvider,
  DeepLProvider,
  ManualProvider,
  withRetry,
  httpError,
  redact,
  HttpError,
  TransportError,
  isFreeKey,
  createProvider,
  PROVIDERS,
  PROVIDER_LIST,
  GOOGLE_POLICY,
  DEFAULT_SETTINGS,
  DEFAULT_SECRETS,
} from '../dist-test/lib.mjs';

const EN = langByCode('EN');
const DE = langByCode('DE');

const ctx = { doNotTranslate: [] };

function ok(body, headers = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function fail(status, body = '', headers = {}) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/** Replies are consumed in order; a function gets the request and returns one. */
function scripted(...replies) {
  const calls = [];
  const transport = async (req) => {
    calls.push(req);
    const next = replies.shift();
    if (next === undefined) throw new Error('transport called more times than scripted');
    return typeof next === 'function' ? next(req) : next;
  };
  transport.calls = calls;
  return transport;
}

const chat = (translations) =>
  ok({ choices: [{ message: { content: JSON.stringify({ translations }) } }] });

const strings = (n, length = 10) =>
  Array.from({ length: n }, (_, i) => ({ id: 'id' + i, text: 'x'.repeat(length), count: 1 }));

/* ------------------------------------------------------------------ */
/* OpenAI                                                              */
/* ------------------------------------------------------------------ */

test('OpenAI sends the key in the auth header and never in the URL', async () => {
  const transport = scripted(chat({ a: 'Eins' }));
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-secret-key', model: 'gpt-4o-mini' });

  const result = await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );

  assert.deepEqual(result.translations, { a: 'Eins' });
  const req = transport.calls[0];
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.headers.Authorization, 'Bearer sk-secret-key');
  assert.ok(req.url.indexOf('sk-') < 0, 'the key must never reach the URL');
});

test('OpenAI batches rather than sending one request per string', async () => {
  const transport = scripted(chat({}), chat({}));
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-x', model: 'gpt-4o-mini' });
  await provider.translate({ source: EN, target: DE, strings: strings(41) }, ctx);
  assert.equal(transport.calls.length, 2, '41 strings should be 2 batches, not 41 requests');
});

test('OpenAI drops temperature once the model rejects it, and remembers', async () => {
  const transport = scripted(
    fail(400, { error: { message: "Unsupported value: 'temperature' does not support 0.2" } }),
    chat({ a: 'Eins' }),
    chat({ b: 'Zwei' })
  );
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-x', model: 'some-new-model' });

  await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );
  await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'b', text: 'Two', count: 1 }] },
    ctx
  );

  const bodies = transport.calls.map((c) => JSON.parse(c.body));
  assert.equal(bodies[0].temperature, 0.2);
  assert.equal(bodies[1].temperature, undefined);
  assert.equal(
    bodies[2].temperature,
    undefined,
    'the second run must not repeat the rejected attempt'
  );
});

test('reasoning models omit temperature from the very first request', async () => {
  const transport = scripted(chat({ a: 'Eins' }));
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-x', model: 'gpt-5' });
  await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );
  assert.equal(JSON.parse(transport.calls[0].body).temperature, undefined);
});

test('a model that answers with prose gets exactly one nudge', async () => {
  const transport = scripted(
    ok({ choices: [{ message: { content: 'Sure, here you go!' } }] }),
    chat({ a: 'Eins' })
  );
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-x', model: 'gpt-4o-mini' });

  const result = await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );

  assert.deepEqual(result.translations, { a: 'Eins' });
  assert.equal(transport.calls.length, 2);
  assert.ok(
    transport.calls[1].body.indexOf('not valid JSON') > 0,
    'the retry should carry the nudge'
  );
});

test('a bad key fails immediately and the message is redacted', async () => {
  const transport = scripted(
    fail(401, { error: { message: 'Incorrect API key sk-secret-key-123' } })
  );
  const provider = new OpenAIProvider({
    transport,
    apiKey: 'sk-secret-key-123',
    model: 'gpt-4o-mini',
  });

  const result = await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );

  assert.equal(transport.calls.length, 1, '401 must not be retried');
  assert.ok(result.error.indexOf('sk-secret-key-123') < 0, 'the key leaked into the error message');
  assert.ok(result.error.indexOf('***') > 0);
});

test('one failing batch does not discard the batch that succeeded', async () => {
  const transport = scripted(chat({ id0: 'Eins' }), fail(401, 'nope'));
  const provider = new OpenAIProvider({ transport, apiKey: 'sk-x', model: 'gpt-4o-mini' });

  const result = await provider.translate({ source: EN, target: DE, strings: strings(41) }, ctx);

  assert.equal(result.translations.id0, 'Eins');
  assert.ok(result.error, 'the failure should still be reported');
});

test('a provider with no key says so instead of calling out', async () => {
  const transport = scripted();
  const provider = new OpenAIProvider({ transport, apiKey: '', model: 'gpt-4o-mini' });
  const result = await provider.translate({ source: EN, target: DE, strings: strings(1) }, ctx);
  assert.match(result.error, /No OpenAI API key/);
  assert.equal(transport.calls.length, 0);
});

/* ------------------------------------------------------------------ */
/* Gemini                                                              */
/* ------------------------------------------------------------------ */

test('Gemini puts the key in a header and the model in the path', async () => {
  const transport = scripted(
    ok({ candidates: [{ content: { parts: [{ text: '{"translations":{"a":"Eins"}}' }] } }] })
  );
  const provider = new GeminiProvider({
    transport,
    apiKey: 'AIza-secret',
    model: 'gemini-2.0-flash',
  });

  const result = await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );

  assert.deepEqual(result.translations, { a: 'Eins' });
  const req = transport.calls[0];
  assert.ok(req.url.endsWith('/gemini-2.0-flash:generateContent'));
  assert.equal(req.headers['x-goog-api-key'], 'AIza-secret');
  assert.ok(req.url.indexOf('AIza') < 0, 'the key must never reach the URL');
});

test('a blocked Gemini response explains itself and is not retried', async () => {
  // Three replies are scripted: if the shape error were treated as transient,
  // the retry loop would eat all of them (and two backoff sleeps) before
  // reporting the reason it already knew on the first attempt.
  const blocked = ok({ promptFeedback: { blockReason: 'SAFETY' } });
  const transport = scripted(blocked, blocked, blocked);
  const provider = new GeminiProvider({ transport, apiKey: 'k', model: 'gemini-2.0-flash' });

  const result = await provider.translate({ source: EN, target: DE, strings: strings(1) }, ctx);

  assert.match(result.error, /SAFETY/);
  assert.equal(
    transport.calls.length,
    1,
    'an unusable answer is deterministic — asking again cannot help'
  );
});

/* ------------------------------------------------------------------ */
/* Google                                                              */
/* ------------------------------------------------------------------ */

test('Google marks placeholders untranslatable and unwraps the result', async () => {
  const transport = scripted((req) => {
    const sent = JSON.parse(req.body);
    assert.equal(sent.format, 'html');
    assert.ok(sent.q[0].indexOf('<span translate="no">{{name}}</span>') >= 0);
    assert.ok(sent.q[0].indexOf('<span translate="no">HabitFlow</span>') >= 0);
    return ok({
      data: {
        translations: [
          { translatedText: 'Hallo <span translate="no">{{name}}</span>, HabitFlow &amp; co' },
        ],
      },
    });
  });
  const provider = new GoogleTranslateProvider({ transport, apiKey: 'AIza' });

  const result = await provider.translate(
    {
      source: EN,
      target: DE,
      strings: [{ id: 'a', text: 'Hi {{name}}, HabitFlow & co', count: 1 }],
    },
    { doNotTranslate: ['HabitFlow'] }
  );

  assert.equal(result.translations.a, 'Hallo {{name}}, HabitFlow & co');
});

test('Google copies the text through when both ends are the same engine code', async () => {
  // EN -> EN-GB is "en" -> "en" to Google, which would answer "Bad language pair".
  const transport = scripted();
  const provider = new GoogleTranslateProvider({ transport, apiKey: 'AIza' });

  const result = await provider.translate(
    {
      source: EN,
      target: langByCode('EN-GB'),
      strings: [{ id: 'a', text: 'Track your habits', count: 1 }],
    },
    ctx
  );

  assert.equal(result.translations.a, 'Track your habits');
  assert.equal(result.error, undefined, 'a copied language is not a failed one');
  assert.match(result.issues[0], /EN and EN-GB/);
  assert.equal(transport.calls.length, 0, 'and no request is worth making');
});

test('a Google 403 explains that the API may not be enabled', async () => {
  const transport = scripted(fail(403, { error: { message: 'Forbidden' } }));
  const provider = new GoogleTranslateProvider({ transport, apiKey: 'AIza' });
  const result = await provider.translate({ source: EN, target: DE, strings: strings(1) }, ctx);
  assert.match(result.error, /Cloud Translation API is enabled/);
});

test('the free endpoint sends one GET per string', async () => {
  const transport = scripted(ok([[['Eins', 'One']]]), ok([[['Zwei', 'Two']]]));
  const provider = new GoogleFreeProvider({ transport });

  const result = await provider.translate(
    {
      source: EN,
      target: DE,
      strings: [
        { id: 'a', text: 'One', count: 1 },
        { id: 'b', text: 'Two', count: 1 },
      ],
    },
    ctx
  );

  assert.deepEqual(result.translations, { a: 'Eins', b: 'Zwei' });
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[0].method, 'GET');
});

/* ------------------------------------------------------------------ */
/* DeepL                                                               */
/* ------------------------------------------------------------------ */

test('a ":fx" key is routed to the free endpoint even in Pro mode, with a note', async () => {
  const transport = scripted(ok({ translations: [{ text: 'Eins' }] }));
  const provider = new DeepLProvider({ transport, apiKey: 'abc-123:fx', freeTier: false });

  const result = await provider.translate(
    { source: EN, target: DE, strings: [{ id: 'a', text: 'One', count: 1 }] },
    ctx
  );

  assert.equal(transport.calls[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.ok(result.issues.some((i) => i.indexOf('api-free.deepl.com') >= 0));
  assert.equal(isFreeKey('abc-123:fx'), true);
  assert.equal(isFreeKey('abc-123'), false);
});

test('DeepL always goes through the sandbox bridge, and reports a spent quota', async () => {
  const transport = scripted((req) => {
    assert.equal(req.preferBridge, true, 'DeepL sends no CORS headers');
    return fail(456, 'Quota exceeded');
  });
  const provider = new DeepLProvider({ transport, apiKey: 'abc-123', freeTier: false });
  const result = await provider.translate({ source: EN, target: DE, strings: strings(1) }, ctx);
  assert.match(result.error, /quota exhausted/i);
});

test('DeepL uses the documented language variants', async () => {
  const transport = scripted(ok({ translations: [{ text: '一' }] }));
  const provider = new DeepLProvider({ transport, apiKey: 'abc-123', freeTier: false });
  await provider.translate({ source: EN, target: langByCode('ZH-CN'), strings: strings(1) }, ctx);
  const sent = JSON.parse(transport.calls[0].body);
  assert.equal(sent.source_lang, 'EN');
  assert.equal(sent.target_lang, 'ZH-HANS');
});

/* ------------------------------------------------------------------ */
/* Manual                                                              */
/* ------------------------------------------------------------------ */

test('manual reports how many strings are still untranslated', async () => {
  const provider = new ManualProvider({ DE: { a: 'Eins', b: '   ' } });
  const result = await provider.translate(
    {
      source: EN,
      target: DE,
      strings: [
        { id: 'a', text: 'One', count: 1 },
        { id: 'b', text: 'Two', count: 1 },
        { id: 'c', text: 'Three', count: 1 },
      ],
    },
    ctx
  );
  assert.deepEqual(result.translations, { a: 'Eins' });
  assert.match(result.error, /2 string\(s\) have no manual translation/);
});

/* ------------------------------------------------------------------ */
/* Batching policy comes from the registry                             */
/* ------------------------------------------------------------------ */

test('createProvider hands each provider the policy its descriptor declares', async () => {
  const base = {
    settings: DEFAULT_SETTINGS,
    secrets: { ...DEFAULT_SECRETS, googleKey: 'AIza' },
    manual: {},
  };
  let calls = 0;
  const transport = async () => {
    calls++;
    return ok({
      data: { translations: Array.from({ length: 64 }, () => ({ translatedText: 'x' })) },
    });
  };

  const provider = createProvider('google', { ...base, transport });
  await provider.translate({ source: EN, target: DE, strings: strings(65) }, ctx);

  // GOOGLE_POLICY caps a batch at 64 items, so 65 strings is exactly two
  // requests. If the descriptor's policy were not reaching the provider, the
  // default would still be in play and this number would not track it.
  assert.equal(calls, 2);
  assert.equal(PROVIDERS.google.policy, GOOGLE_POLICY);
});

test('every provider that talks to the network declares a sane policy', () => {
  for (const descriptor of PROVIDER_LIST) {
    if (!descriptor.domains.length) continue;
    const { maxItems, maxChars, concurrency } = descriptor.policy;
    assert.ok(maxItems >= 1, descriptor.id + ' would send empty batches');
    assert.ok(maxChars >= 1000, descriptor.id + ' would split on almost every string');
    assert.ok(concurrency >= 1, descriptor.id + ' would never issue a request');
    // Concurrency multiplies with the pipeline's language prefetch; past this
    // a free tier starts answering 429 more often than it answers.
    assert.ok(concurrency <= 4, descriptor.id + ' is too aggressive for a free tier');
  }
});

/* ------------------------------------------------------------------ */
/* Retry policy                                                        */
/* ------------------------------------------------------------------ */

const noWait = async () => {};

test('rate limits and server errors are retried, client errors are not', async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new HttpError(429, 'slow down', 0);
    return 'ok';
  };
  assert.equal(await withRetry(flaky, undefined, noWait), 'ok');
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new HttpError(401, 'bad key', 0);
      },
      undefined,
      noWait
    )
  );
  assert.equal(calls, 1, '401 is final');
});

test('retrying gives up after three attempts', async () => {
  let calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new HttpError(500, 'boom', 0);
      },
      undefined,
      noWait
    )
  );
  assert.equal(calls, 3);
});

test('a transport that declares itself unrecoverable is not retried', async () => {
  let calls = 0;
  await assert.rejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new TransportError('no fetch in this build', false);
      },
      undefined,
      noWait
    )
  );
  assert.equal(calls, 1);
});

test('cancellation stops the retry loop before the next attempt', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new HttpError(500, 'boom', 0);
        },
        () => calls >= 2,
        noWait
      ),
    /Cancelled/
  );
  assert.equal(calls, 2);
});

test('Retry-After is honoured and capped', () => {
  const error = httpError(fail(429, 'slow', { 'retry-after': '5' }));
  assert.equal(error.retryAfterMs, 5000);
  assert.equal(httpError(fail(429, 'slow', { 'retry-after': '9999' })).retryAfterMs, 30000);
});

test('redact only fires on something long enough to be a key', () => {
  assert.equal(redact('key sk-abcdefgh failed', 'sk-abcdefgh'), 'key *** failed');
  assert.equal(redact('value abc failed', 'abc'), 'value abc failed');
});
