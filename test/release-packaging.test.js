// 验证正式下载物与安装入口一致，安装失败不得覆盖用户上一版。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);

test('正式附件包含安装器实际下载的侧栏及厂商生成器', () => {
  const workflow = fs.readFileSync(new URL('.github/workflows/release.yml', root), 'utf8');
  assert.match(workflow, /src\/aia-projects\.js/);
  assert.match(workflow, /scripts\/model-map\.js/);
  assert.match(workflow, /scripts\/local-metadata\.mjs/);
  const source = fs.readFileSync(new URL('src/aia-projects.js', root), 'utf8');
  assert.match(source, /^\/\/ aia-projects:/);
  assert.match(source, /const LOCAL_CONVERSATION_METADATA = \{ providers: \{\}, names: \{\} \};/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-release-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const cmux = `#!/usr/bin/env node
const args = process.argv.slice(2);
if(args.includes('vault')) console.log(JSON.stringify({sessions:[]}));
else if(args.includes('workspace')) console.log(JSON.stringify({workspaces:[]}));
else if(args.includes('validate') && process.env.FIXTURE_CONCURRENT_UPDATE) {
  require('node:fs').writeFileSync(process.env.FIXTURE_SIDEBAR, 'concurrent-new-version'); process.exitCode=1;
} else if(args.includes('validate') && process.env.FIXTURE_VALIDATE_FAIL) process.exitCode=1;
else if(args.includes('reload') && process.env.FIXTURE_RELOAD_FAIL) process.exitCode=1;
else console.log('OK');
`;
  fs.writeFileSync(path.join(bin, 'cmux'), cmux, { mode: 0o755 });
  const config = path.join(dir, 'config');
  const sidebar = path.join(config, 'cmux/sidebars/aia-projects.js');
  fs.mkdirSync(path.dirname(sidebar), { recursive: true });
  const previous = '// aia-projects: fixture\nconst LOCAL_CONVERSATION_METADATA = {"providers":{"existing":{"provider":"deepseek"}},"names":{}};\n';
  fs.writeFileSync(sidebar, previous);
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, XDG_CONFIG_HOME: config };
  return { sidebar, previous, env };
}

test('开发安装生成本机副本并保留已有厂商，源文件保持公开空映射', (t) => {
  assert.match(fs.readFileSync(new URL('install.sh', root), 'utf8'), /XDG_CONFIG_HOME/);
  const f = fixture(t);
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--dev'], { env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(f.sidebar).isSymbolicLink(), false);
  assert.match(fs.readFileSync(f.sidebar, 'utf8'), /"existing":\{"provider":"deepseek"\}/);
  assert.match(fs.readFileSync(new URL('src/aia-projects.js', root), 'utf8'), /providers: \{\}, names: \{\}/);
});

test('宿主校验失败时开发安装恢复原文件且返回失败', (t) => {
  assert.match(fs.readFileSync(new URL('install.sh', root), 'utf8'), /XDG_CONFIG_HOME/);
  const f = fixture(t);
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--dev'], {
    env: { ...f.env, FIXTURE_VALIDATE_FAIL: '1' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.sidebar, 'utf8'), f.previous);
});

test('首次安装热加载失败时移除本次创建入口', (t) => {
  const f = fixture(t); fs.unlinkSync(f.sidebar);
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--dev'], {
    env: { ...f.env, FIXTURE_RELOAD_FAIL: '1' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(f.sidebar), false);
});

test('校验期间出现并发更新时，失败回滚保留并发更新', (t) => {
  const f = fixture(t);
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--dev'], {
    env: { ...f.env, FIXTURE_CONCURRENT_UPDATE: '1', FIXTURE_SIDEBAR: f.sidebar }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.sidebar, 'utf8'), 'concurrent-new-version');
});

test('安装锁已占用时不覆盖现有安装', (t) => {
  const f = fixture(t); fs.mkdirSync(f.sidebar + '.install-lock');
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--dev'], { env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.sidebar, 'utf8'), f.previous);
});

test('下载附件校验和不符时不执行生成器，也不覆盖旧版', (t) => {
  const f = fixture(t); const dir = path.dirname(f.sidebar); const assets = path.join(dir, 'assets'); fs.mkdirSync(assets);
  const names = ['aia-projects.js', 'model-map.js', 'local-metadata.mjs', 'install-runtime.mjs'];
  for (const name of names) {
    const source = new URL(name === 'aia-projects.js' ? 'src/' + name : 'scripts/' + name, root);
    fs.copyFileSync(source, path.join(assets, name));
  }
  const sums = names.map((name) => createHash('sha256').update(fs.readFileSync(path.join(assets, name))).digest('hex') + '  ' + name).join('\n');
  fs.writeFileSync(path.join(assets, 'SHA256SUMS'), sums);
  fs.writeFileSync(path.join(assets, 'model-map.js'), 'console.log("corrupted payload must not run");');
  const curl = `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), a=process.argv.slice(2);
const url=a.find(x=>x.startsWith('https:')), out=a[a.indexOf('-o')+1];
fs.copyFileSync(path.join(process.env.FIXTURE_ASSETS, path.basename(url)), out);
`;
  const bin = f.env.PATH.split(path.delimiter)[0]; fs.writeFileSync(path.join(bin, 'curl'), curl, { mode: 0o755 });
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--version', 'v0.8.0'], {
    env: { ...f.env, FIXTURE_ASSETS: assets }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stdout.includes('corrupted payload must not run'));
  assert.equal(fs.readFileSync(f.sidebar, 'utf8'), f.previous);
});

test('校验和正确的正式附件可从临时下载目录独立安装', (t) => {
  const f = fixture(t), assets = path.join(path.dirname(f.sidebar), 'assets'); fs.mkdirSync(assets);
  const names = ['aia-projects.js', 'model-map.js', 'local-metadata.mjs', 'install-runtime.mjs'];
  for (const name of names) fs.copyFileSync(new URL(name === 'aia-projects.js' ? 'src/' + name : 'scripts/' + name, root), path.join(assets, name));
  fs.writeFileSync(path.join(assets, 'SHA256SUMS'), names.map((name) =>
    createHash('sha256').update(fs.readFileSync(path.join(assets, name))).digest('hex') + '  ' + name).join('\n'));
  const curl = `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), a=process.argv.slice(2);
const url=a.find(x=>x.startsWith('https:')), out=a[a.indexOf('-o')+1];
fs.copyFileSync(path.join(process.env.FIXTURE_ASSETS, path.basename(url)), out);
`;
  fs.writeFileSync(path.join(f.env.PATH.split(path.delimiter)[0], 'curl'), curl, { mode: 0o755 });
  const result = spawnSync('sh', [new URL('install.sh', root).pathname, '--version', 'v0.8.0'], {
    env: { ...f.env, FIXTURE_ASSETS: assets }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.sidebar, 'utf8'), /"existing":\{"provider":"deepseek"\}/);
});
