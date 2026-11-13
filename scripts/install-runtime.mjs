// 串行化侧栏安装；回滚仅操作仍属于本次事务的文件，不覆盖并发更新。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function snapshot(file) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return { kind: 'absent' }; throw error; }
  return { kind: stat.isSymbolicLink() ? 'symlink' : 'file',
    target: stat.isSymbolicLink() ? fs.readlinkSync(file) : '',
    content: fs.readFileSync(file), mode: stat.mode & 0o777 };
}

function matches(file, expected) {
  try {
    const current = snapshot(file);
    if (current.kind !== expected.kind) return false;
    if (current.kind === 'absent') return true;
    return current.mode === expected.mode && current.target === expected.target
      && current.content.equals(expected.content);
  } catch { return false; }
}

function restore(file, previous) {
  fs.rmSync(file, { force: true });
  if (previous.kind === 'symlink') fs.symlinkSync(previous.target, file);
  if (previous.kind === 'file') {
    fs.writeFileSync(file, previous.content, { mode: previous.mode });
    fs.chmodSync(file, previous.mode);
  }
}

function backup(file, previous) {
  if (previous.kind === 'absent') return;
  const destination = file + '.bak.' + Date.now() + '.' + process.pid;
  if (previous.kind === 'symlink') fs.symlinkSync(previous.target, destination);
  else { fs.writeFileSync(destination, previous.content, { mode: previous.mode }); fs.chmodSync(destination, previous.mode); }
}

// generate 接收安装前快照；锁覆盖元数据生成、替换、校验、激活和必要的回滚。
export async function installSidebar({ outputPath, generate, activate = false }) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const lock = outputPath + '.install-lock';
  try { fs.mkdirSync(lock); }
  catch { throw Object.assign(new Error('install_locked'), { stage: 'install_locked' }); }
  const temporary = outputPath + '.tmp-' + process.pid;
  const run = (args) => spawnSync('cmux', args,
    { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).status === 0;
  let previous, owned, installed = false;
  try {
    previous = snapshot(outputPath);
    const generated = await generate(previous.kind === 'absent' ? '' : previous.content.toString('utf8'));
    if (!matches(outputPath, previous)) throw Object.assign(new Error('installed_file_changed'), { stage: 'installed_file_changed' });
    backup(outputPath, previous);
    fs.writeFileSync(temporary, generated, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporary, 0o600);
    owned = { kind: 'file', target: '', content: Buffer.from(generated), mode: 0o600 };
    if (!matches(outputPath, previous)) throw Object.assign(new Error('installed_file_changed'), { stage: 'installed_file_changed' });
    fs.renameSync(temporary, outputPath);
    installed = true;
    const name = path.basename(outputPath, '.js');
    if (!run(['sidebar', 'validate', name])) throw Object.assign(new Error('validation_failed'), { stage: 'validation_failed' });
    if (activate && (!run(['sidebar', 'reload', name]) || !run(['sidebar', 'select', name]))) {
      throw Object.assign(new Error('activation_failed'), { stage: 'activation_failed' });
    }
    if (!matches(outputPath, owned)) throw Object.assign(new Error('installed_file_changed'), { stage: 'installed_file_changed' });
  } catch (error) {
    if (installed && matches(outputPath, owned)) {
      restore(outputPath, previous);
      if (activate && previous.kind !== 'absent') run(['sidebar', 'reload', path.basename(outputPath, '.js')]);
    }
    throw error;
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.rmdirSync(lock);
  }
}
