// 构建不含本机映射的公开侧栏；本机厂商数据只在安装时注入。
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const sources = ['src/auto-projects.js', 'src/conversations.js', 'src/project-sidebar.js'];
const source = sources.map((p) => readFileSync(new URL(p, root), 'utf8')).join('\n');
const output = new URL('src/aia-projects.js', root);
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== source) {
    console.error('公开构建与源码不一致，请执行 npm run build'); process.exitCode = 1;
  }
} else { writeFileSync(output, source); console.log('Built public src/aia-projects.js'); }
