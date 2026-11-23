import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const helpersPath = path.join(repo, 'deploy/atomic-helpers.sh');

function runHelper(cmd, env = {}) {
  return execFileSync('/bin/bash', ['-euo', 'pipefail', '-c', `source "${helpersPath}"\n${cmd}`], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();
}

async function runHelperAsync(cmd, env = {}) {
  const { stdout } = await execFileAsync(
    '/bin/bash',
    ['-euo', 'pipefail', '-c', `source "${helpersPath}"\n${cmd}`],
    { env: { ...process.env, ...env }, encoding: 'utf8' }
  );
  return stdout.trim();
}

test('select_inactive_slot alternates between blue (3101) and green (3102)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lalia-slot-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const conf = path.join(root, 'lalia-upstream.conf');

  assert.equal(
    runHelper(`select_inactive_slot "${conf}"`),
    'green 3102 lalia-backend-green 3101 lalia-backend-blue'
  );

  runHelper(`write_upstream_conf "${conf}" 3102`);
  assert.match(fs.readFileSync(conf, 'utf8'), /server 127\.0\.0\.1:3102;/);
  assert.equal(
    runHelper(`select_inactive_slot "${conf}"`),
    'blue 3101 lalia-backend-blue 3102 lalia-backend-green'
  );

  runHelper(`write_upstream_conf "${conf}" 3101`);
  assert.match(fs.readFileSync(conf, 'utf8'), /server 127\.0\.0\.1:3101;/);
  assert.equal(
    runHelper(`select_inactive_slot "${conf}"`),
    'green 3102 lalia-backend-green 3101 lalia-backend-blue'
  );
});

test('atomic_swap_symlink switches live target without removing intermediate availability', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lalia-symlink-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rel1 = path.join(root, 'rel-1');
  const rel2 = path.join(root, 'rel-2');
  const current = path.join(root, 'current');
  fs.mkdirSync(rel1);
  fs.mkdirSync(rel2);

  runHelper(`atomic_swap_symlink "${rel1}" "${current}"`);
  assert.equal(fs.realpathSync(current), fs.realpathSync(rel1));

  runHelper(`atomic_swap_symlink "${rel2}" "${current}"`);
  assert.equal(fs.realpathSync(current), fs.realpathSync(rel2));
});

test('carry_forward_hashed_assets retains recent hashed chunks up to max releases and ignores manifest-less ancient chunks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lalia-assets-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releases = path.join(root, 'releases');

  const mkRelease = (id, files) => {
    const fe = path.join(releases, id, 'livekit-app/frontend');
    fs.mkdirSync(path.join(fe, 'assets'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(fe, 'assets', name), body);
    }
    fs.writeFileSync(path.join(fe, '.own-assets-manifest'), Object.keys(files).join('\n') + '\n');
    return fe;
  };

  mkRelease('2026112301-aaa', { 'old-0.js': 'v0' });
  mkRelease('2026112302-bbb', { 'chunk-1.js': 'v1' });
  mkRelease('2026112303-ccc', { 'chunk-2.js': 'v2' });
  mkRelease('2026112304-ddd', { 'index-4.js': 'old-index' });
  const fe5 = mkRelease('2026112305-eee', { 'index-4.js': 'new-index', 'chunk-5.js': 'v5' });

  runHelper(`carry_forward_hashed_assets "${releases}" "${fe5}" "" 3`);
  const assets5 = fs.readdirSync(path.join(fe5, 'assets')).sort();
  assert.deepEqual(assets5, ['chunk-1.js', 'chunk-2.js', 'chunk-5.js', 'index-4.js']);
  assert.equal(fs.readFileSync(path.join(fe5, 'assets/index-4.js'), 'utf8'), 'new-index');
});

test('prune_old_releases keeps N newest releases and protects current symlink target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lalia-prune-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases, { recursive: true });

  for (const id of ['01', '02', '03', '04', '05', '06', '07']) {
    fs.mkdirSync(path.join(releases, `202611230${id}-abc`));
  }
  const current = path.join(root, 'current');
  fs.symlinkSync(path.join(releases, '20261123001-abc'), current);

  runHelper(`prune_old_releases "${releases}" "${current}" 5`);
  const remaining = fs.readdirSync(releases).sort();
  assert.deepEqual(remaining, [
    '20261123001-abc',
    '20261123003-abc',
    '20261123004-abc',
    '20261123005-abc',
    '20261123006-abc',
    '20261123007-abc',
  ]);
});

test('wait_for_slot_health passes after 3 consecutive healthy checks across all health routes', async (t) => {
  const seen = { h1: 0, h2: 0, h3: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') seen.h1 += 1;
    else if (req.url === '/api/v2/health') seen.h2 += 1;
    else if (req.url === '/api/v2/support/health') seen.h3 += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const { port } = server.address();

  await runHelperAsync(`wait_for_slot_health ${port} 10 0.05 3 127.0.0.1`);
  assert.equal(seen.h1, 3);
  assert.equal(seen.h2, 3);
  assert.equal(seen.h3, 3);
});

test('deploy scripts pass bash syntax validation', () => {
  execFileSync('/bin/bash', ['-n', helpersPath]);
  execFileSync('/bin/bash', ['-n', path.join(repo, 'deploy-staging.sh')]);
  execFileSync('/bin/bash', ['-n', path.join(repo, 'deploy.sh')]);
});
