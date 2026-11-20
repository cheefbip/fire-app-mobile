// Run with: node --test scripts/test-map-location.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(
  readFileSync(resolve(__dirname, '../src/lib/map-location.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const granted = { status: 'granted', granted: true, canAskAgain: true };
const fix = () => ({ coords: { longitude: -122.4, latitude: 37.8 }, timestamp: Date.now() });
const flush = () => new Promise((done) => setImmediate(done));

function setup(overrides = {}) {
  const state = { positions: [], errors: [], requested: 0, removed: 0, watches: 0 };
  const location = {
    Accuracy: { High: 4 },
    getForegroundPermissionsAsync: async () => granted,
    requestForegroundPermissionsAsync: async () => { state.requested++; return granted; },
    hasServicesEnabledAsync: async () => true,
    watchPositionAsync: async (_options, success, failure) => {
      state.watches++;
      state.update = success;
      state.fail = failure;
      return { remove: () => state.removed++ };
    },
    ...overrides,
  };
  const exports = {};
  runInNewContext(source, {
    exports,
    require: () => location,
    setTimeout: (callback) => { state.timeout = callback; return 1; },
    clearTimeout: () => { state.timeout = undefined; },
  });
  state.start = (request = false) => exports.watchMapLocation(
    (position) => state.positions.push(position),
    (error) => state.errors.push(error),
    request,
  );
  return state;
}

test('granted/approximate permission starts watching and cleanup ignores later fixes', async () => {
  const state = setup();
  const stop = state.start();
  await flush();
  state.update(fix());
  assert.equal(state.positions.length, 1);
  assert.equal(state.timeout, undefined);
  assert.equal(state.requested, 0);
  stop();
  stop();
  state.update(fix());
  assert.equal(state.positions.length, 1);
  assert.equal(state.removed, 1);
});

test('first use asks permission; permanently denied permission offers Settings', async () => {
  const first = setup({ getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }) });
  const stop = first.start();
  await flush();
  assert.equal(first.requested, 1);
  assert.equal(first.watches, 1);
  stop();

  const denied = setup({
    getForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false, canAskAgain: false }),
  });
  denied.start(true);
  await flush();
  assert.equal(denied.watches, 0);
  assert.equal(denied.requested, 0);
  assert.equal(denied.errors[0].openSettings, true);
});

test('denied permission prompts again only on explicit retry', async () => {
  const state = setup({
    getForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false, canAskAgain: true }),
  });
  state.start();
  await flush();
  assert.equal(state.requested, 0);
  const stop = state.start(true);
  await flush();
  assert.equal(state.requested, 1);
  assert.equal(state.watches, 1);
  stop();
});

test('disabled services and native errors produce recoverable messages', async () => {
  for (const overrides of [
    { hasServicesEnabledAsync: async () => false },
    { getForegroundPermissionsAsync: async () => { throw new Error('native failure'); } },
  ]) {
    const state = setup(overrides);
    state.start();
    await flush();
    assert.equal(state.watches, 0);
    assert.equal(state.errors.length, 1);
  }
});

test('invalid/stale fixes time out and stop the watch', async () => {
  const state = setup();
  state.start();
  await flush();
  state.update({ ...fix(), timestamp: Date.now() - 60000 });
  state.update({ ...fix(), coords: { latitude: NaN, longitude: 400 } });
  assert.equal(state.positions.length, 0);
  state.timeout();
  state.update(fix());
  assert.equal(state.positions.length, 0);
  assert.equal(state.errors.length, 1);
  assert.equal(state.removed, 1);
});

test('cleanup while permission is pending does not start location tracking', async () => {
  let resolvePermission;
  const state = setup({
    getForegroundPermissionsAsync: () => new Promise((done) => { resolvePermission = done; }),
  });
  const stop = state.start();
  stop();
  resolvePermission(granted);
  await flush();
  assert.equal(state.watches, 0);
  assert.equal(state.errors.length, 0);
});

test('cleanup removes a watch whose setup finishes after leaving the screen', async () => {
  let resolveWatch;
  let removed = 0;
  const state = setup({
    watchPositionAsync: () => new Promise((done) => { resolveWatch = done; }),
  });
  const stop = state.start();
  await flush();
  stop();
  resolveWatch({ remove: () => removed++ });
  await flush();
  assert.equal(removed, 1);
});

test('a watcher error stops updates and reports the failure', async () => {
  const state = setup();
  state.start();
  await flush();
  state.fail('unavailable');
  state.update(fix());
  assert.equal(state.errors.length, 1);
  assert.equal(state.positions.length, 0);
  assert.equal(state.removed, 1);
});
