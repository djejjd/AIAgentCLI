// 会话厂商、稳定身份编号与显式启动预设；不读取或展示历史输入。
const CONVERSATION_PROVIDERS = {
  openai: { name: 'OpenAI', icon: 'sparkles' },
  anthropic: { name: 'Anthropic', icon: 'sun.max' },
  deepseek: { name: 'DeepSeek', icon: 'water.waves' },
  google: { name: 'Google', icon: 'diamond' },
  xai: { name: 'xAI', icon: 'bolt' },
  alibaba: { name: 'Alibaba', icon: 'cloud' },
  moonshot: { name: 'Moonshot', icon: 'moon.stars' },
  unknown: { name: '未知厂商', icon: 'questionmark.circle' },
};

// 只识别模型家族；路由商或客户端名称不等于模型厂商。
function providerForModel(model) {
  const value = String(model || '').toLowerCase().split('/').at(-1);
  if (/^deepseek/.test(value)) return 'deepseek';
  if (/^(gpt|o[134](?:[-.]|$)|chatgpt)/.test(value)) return 'openai';
  if (/^claude/.test(value)) return 'anthropic';
  if (/^gemini/.test(value)) return 'google';
  if (/^grok/.test(value)) return 'xai';
  if (/^(qwen|tongyi)/.test(value)) return 'alibaba';
  if (/^(kimi|moonshot)/.test(value)) return 'moonshot';
  return 'unknown';
}

// 输入为代理元数据与本机映射；输出仅含厂商显示信息，不携带型号。
function conversationProvider(agent, mappings = {}) {
  const mapped = mappings[agent?.id] ?? {};
  const liveModel = agent?.model || agent?.modelId;
  const liveProvider = CONVERSATION_PROVIDERS[agent?.provider] ? agent.provider : '';
  const key = liveModel ? (providerForModel(liveModel) !== 'unknown' ? providerForModel(liveModel) : liveProvider) : liveProvider
    || (CONVERSATION_PROVIDERS[mapped.provider] ? mapped.provider : providerForModel(mapped.model));
  return CONVERSATION_PROVIDERS[key] || CONVERSATION_PROVIDERS.unknown;
}

// 身份短编号取 UUID 尾部六位，不依赖顺序或内存计数；并非全局唯一标识。
function conversationNumber(id) {
  const value = String(id || '').replace(/-/g, '');
  return value.slice(-6).toUpperCase();
}

// 原生标题保存默认预设厂商或“自定义名 · 厂商”，无需额外存储或读取历史输入。
function conversationTitleInfo(title) {
  const value = String(title || '');
  for (const [key, provider] of Object.entries(CONVERSATION_PROVIDERS)) {
    if (new RegExp('^' + provider.name + ' · [0-9]+-[0-9]+$').test(value)) {
      return { provider: key, alias: '' };
    }
    const suffix = ' · ' + provider.name;
    if (value.endsWith(suffix)) return { provider: key, alias: value.slice(0, -suffix.length) };
  }
  return null;
}

// 预设只允许已知可执行名及安全模型 ID；不接收任意 shell 命令或附加权限参数。
function presetCommand(preset) {
  if (!preset || !['codex', 'claude', 'opencode'].includes(preset.tool)) return null;
  if (preset.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(preset.model)) return null;
  const args = [preset.tool, ...(preset.model ? [preset.tool === 'claude' ? '--model' : '-m', preset.model] : [])];
  return args.map((arg) => "'" + arg + "'").join(' ');
}

// 为新建请求选择唯一的本机项目目录；不启动远程或目录不确定的工作区。
function launchDirectory(groupId, ws) {
  const members = ws.filter((w) => w.group === groupId);
  const directory = members[0]?.directory;
  return members.length && String(directory || '').startsWith('/')
    && members.every((w) => !w.remote?.target && w.directory === directory) ? directory : '';
}

// 只持有一个显式创建请求；宿主时钟驱动超时，所有终态释放引用，绝不自动重发。
function createConversationLauncher(send) {
  let request = null;
  let report = { state: 'idle', failure: '' };
  let serial = 0;
  const fail = (failure) => { request = null; return report = { state: 'failed', failure }; };
  return {
    pending: () => !!request,
    start(groupId, preset, ws, now) {
      if (request) return false;
      const command = presetCommand(preset);
      const cwd = launchDirectory(groupId, ws);
      if (!command || !cwd) { fail('启动配置不可用'); return false; }
      const provider = CONVERSATION_PROVIDERS[providerForModel(preset.model)];
      const title = (provider?.name || preset.tool) + ' · ' + now + '-' + (++serial);
      request = { groupId, tool: preset.tool, title, started: now, known: new Set(ws.map((w) => w.id)) };
      report = { state: 'creating', failure: '' };
      try { send('workspace.create', { group_id: groupId, cwd, initial_input: command + '\r', title, focus: 'true' }); }
      catch { fail('发送创建请求'); return false; }
      return true;
    },
    tick(ws, groupIds, now) {
      if (!request) return report;
      if (!groupIds.includes(request.groupId)) return fail('项目已移除');
      const created = ws.find((w) => !request.known.has(w.id) && w.title === request.title
        && w.group === request.groupId);
      if (created) {
        request = null;
        return report = { state: 'idle', failure: '' };
      }
      return now - request.started >= 15 ? fail('创建对话') : report;
    },
  };
}
