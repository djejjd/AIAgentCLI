#!/bin/sh
# 安装公开侧栏，并在本机注入厂商元数据；正式附件不包含个人会话信息。
# --version <tag> 指定正式版本；--dev 从当前克隆生成；--uninstall 移除安装入口。
set -eu
repo="djejjd/AIAgentCLI"
name="aia-projects"
dir="${XDG_CONFIG_HOME:-$HOME/.config}/cmux/sidebars"
dest="$dir/$name.js"
version="latest"
mode="download"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || { echo "--version 缺少版本号" >&2; exit 2; }; version="$2"; shift 2 ;;
    --dev) mode="dev"; shift ;;
    --uninstall) mode="uninstall"; shift ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) echo "未知参数" >&2; exit 2 ;;
  esac
done
if [ "$mode" = "uninstall" ]; then
  rm -f "$dest"
  echo "已移除侧栏入口，请在 cmux 中选择其他侧栏。"
  exit 0
fi
command -v node >/dev/null 2>&1 || { echo "需要 Node.js 20+ 来生成本机厂商映射；未修改安装。" >&2; exit 1; }
command -v cmux >/dev/null 2>&1 || { echo "请从安装了 cmux CLI 的终端运行；未修改安装。" >&2; exit 1; }
cmux ping >/dev/null 2>&1 || { echo "请从 cmux 终端运行安装器；未修改安装。" >&2; exit 1; }
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/aia-install.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
if [ "$mode" = "dev" ]; then
  root="$(cd "$(dirname "$0")" && pwd)"
  src="$root/src/$name.js"
  generator="$root/scripts/model-map.js"
else
  if [ "$version" = "latest" ]; then
    base="https://github.com/$repo/releases/latest/download"
  else
    base="https://github.com/$repo/releases/download/$version"
  fi
  echo "正在下载侧栏和本地生成器附件…"
  for asset in aia-projects.js model-map.js local-metadata.mjs install-runtime.mjs SHA256SUMS; do
    curl --connect-timeout 10 --max-time 60 -fsSL "$base/$asset" -o "$tmpdir/$asset" || {
      echo "附件下载失败，未修改安装。" >&2; exit 1;
    }
  done
  node - "$tmpdir" <<'VERIFY'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
try {
  const dir = process.argv[2], manifest = new Map();
  for (const line of fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/);
    if (!match || manifest.has(match[2])) throw Error('invalid_manifest');
    manifest.set(match[2], match[1].toLowerCase());
  }
  for (const name of ['aia-projects.js', 'model-map.js', 'local-metadata.mjs', 'install-runtime.mjs']) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    if (manifest.get(name) !== actual) throw Error('checksum_mismatch');
  }
} catch { console.error('附件校验和不符或清单无效，未执行生成器、未修改安装。'); process.exit(1); }
VERIFY
  printf '{"type":"module"}\n' > "$tmpdir/package.json"
  src="$tmpdir/$name.js"
  generator="$tmpdir/model-map.js"
fi
[ -f "$src" ] && [ -f "$generator" ] || { echo "缺少侧栏或生成器，未修改安装。" >&2; exit 1; }
head -n 1 "$src" | grep -q '^// aia-projects:' || { echo "附件不是 AIAgentCLI 侧栏，未修改安装。" >&2; exit 1; }
mkdir -p "$dir"
if ! node "$generator" --source "$src" --output "$dest" --activate; then
  echo "安装未通过；生成器已保留并发更新或恢复旧版。" >&2
  exit 1
fi
echo "已安装并热加载 aia-projects。"
