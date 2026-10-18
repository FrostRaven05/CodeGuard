const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WorkbenchError } = require('./git-service.cjs');

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function endpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WorkbenchError('请输入有效的模型服务地址。', 'INVALID_MODEL_SETTINGS');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new WorkbenchError(
      '模型地址需使用 HTTPS；本机服务可使用 HTTP。地址中不能包含密钥、查询参数或账号。',
      'INVALID_MODEL_SETTINGS',
    );
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions';
  return url.href;
}

class ModelSettings {
  constructor(directory, { safeStorage, sessionOnly = false } = {}) {
    this.file = path.join(directory, 'model-settings.json');
    this.safeStorage = safeStorage;
    this.sessionOnly = sessionOnly;
    this.sessionKey = '';
    this.warning = null;
    this.data = {
      baseUrl: '',
      model: '',
      maxContextChars: 60000,
      excludePatterns: '',
      revision: '',
      encryptedKey: '',
    };
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = this.validate(saved);
        this.data.encryptedKey = typeof saved.encryptedKey === 'string' ? saved.encryptedKey : '';
        this.data.revision =
          typeof saved.revision === 'string' ? saved.revision : crypto.randomUUID();
      } catch {
        this.warning = '模型设置无法读取，Git 功能仍可使用。重新保存设置时会先备份原文件。';
      }
    }
  }

  validate(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.baseUrl !== 'string' ||
      value.baseUrl.length > 2000 ||
      typeof value.model !== 'string' ||
      !value.model.trim() ||
      value.model.length > 200 ||
      /[\r\n\0]/.test(value.model) ||
      !Number.isInteger(value.maxContextChars) ||
      value.maxContextChars < 4000 ||
      value.maxContextChars > 200000 ||
      typeof value.excludePatterns !== 'string' ||
      value.excludePatterns.length > 8000
    )
      throw new WorkbenchError(
        '请填写服务地址、模型名与有效的上下文预算（4000–200000 字符）。',
        'INVALID_MODEL_SETTINGS',
      );
    const baseUrl = value.baseUrl.trim().replace(/\/+$/, '');
    endpoint(baseUrl);
    return {
      baseUrl,
      model: value.model.trim(),
      maxContextChars: value.maxContextChars,
      excludePatterns: value.excludePatterns.trim(),
    };
  }

  getPublic() {
    const { encryptedKey, ...visible } = this.data;
    return {
      ...visible,
      hasApiKey: Boolean(this.sessionOnly ? this.sessionKey : encryptedKey),
      keyStorage: this.sessionOnly ? 'session' : 'system',
      warning: this.warning,
    };
  }

  save(value) {
    const next = this.validate(value);
    if (
      value.apiKey !== undefined &&
      (typeof value.apiKey !== 'string' ||
        value.apiKey.length > 8192 ||
        /[\r\n\0]/.test(value.apiKey))
    )
      throw new WorkbenchError('密钥格式无效。', 'INVALID_MODEL_SETTINGS');
    if (value.clearKey !== undefined && typeof value.clearKey !== 'boolean')
      throw new WorkbenchError('清除密钥选项无效。', 'INVALID_MODEL_SETTINGS');
    let encryptedKey = this.data.encryptedKey;
    let sessionKey = this.sessionKey;
    if (value.clearKey) {
      encryptedKey = '';
      sessionKey = '';
    }
    if (value.apiKey) {
      if (this.sessionOnly) sessionKey = value.apiKey;
      else {
        if (
          !this.safeStorage?.isEncryptionAvailable() ||
          this.safeStorage.getSelectedStorageBackend?.() === 'basic_text'
        )
          throw new WorkbenchError(
            '系统密钥保护当前不可用，密钥未保存。请在桌面程序中重试。',
            'KEY_STORAGE_UNAVAILABLE',
          );
        try {
          encryptedKey = this.safeStorage.encryptString(value.apiKey).toString('base64');
        } catch {
          throw new WorkbenchError('系统无法保护密钥，设置未保存。', 'KEY_STORAGE_UNAVAILABLE');
        }
      }
    }
    const data = {
      ...next,
      encryptedKey: this.sessionOnly ? '' : encryptedKey,
      revision: crypto.randomUUID(),
    };
    if (this.warning && fs.existsSync(this.file))
      fs.copyFileSync(this.file, `${this.file}.backup-${crypto.randomUUID()}`);
    atomicJson(this.file, data);
    this.data = data;
    this.sessionKey = sessionKey;
    this.warning = null;
    return this.getPublic();
  }

  connection() {
    if (!this.data.baseUrl || !this.data.model)
      throw new WorkbenchError('请先配置模型服务。', 'MODEL_NOT_CONFIGURED');
    let apiKey = this.sessionOnly ? this.sessionKey : '';
    if (!this.sessionOnly && this.data.encryptedKey) {
      try {
        apiKey = this.safeStorage.decryptString(Buffer.from(this.data.encryptedKey, 'base64'));
      } catch {
        throw new WorkbenchError(
          '当前账户无法解密模型密钥，请在设置中重新填写。',
          'KEY_STORAGE_UNAVAILABLE',
        );
      }
    }
    return { ...this.getPublic(), endpoint: endpoint(this.data.baseUrl), apiKey };
  }
}

async function callModel(
  connection,
  messages,
  { signal, timeoutMs = 90000, fetchImpl = fetch } = {},
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetchImpl(connection.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: {
        'Content-Type': 'application/json',
        ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: connection.model, messages, stream: false }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const message = [401, 403].includes(response.status)
        ? '模型认证失败，请检查密钥和权限。'
        : response.status === 429
          ? '模型服务限流或额度不足，请稍后重试。'
          : `模型服务返回错误（HTTP ${response.status}）。`;
      throw new WorkbenchError(message, 'MODEL_HTTP_ERROR');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2000000) {
        await reader.cancel();
        throw new WorkbenchError('模型响应过大，请缩小评审范围。', 'MODEL_OUTPUT_LIMIT');
      }
      chunks.push(Buffer.from(value));
    }
    let result;
    try {
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new WorkbenchError('模型服务未返回有效 JSON 响应。', 'MODEL_INVALID_RESPONSE');
    }
    const choice = result.choices?.[0];
    if (choice?.finish_reason && !['stop', 'end_turn'].includes(choice.finish_reason))
      throw new WorkbenchError(
        '模型没有完整完成响应，请缩小范围或检查模型设置。',
        'MODEL_INCOMPLETE',
      );
    if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim())
      throw new WorkbenchError(
        '模型服务未返回文本，请检查接口协议与模型名称。',
        'MODEL_INVALID_RESPONSE',
      );
    const redact = (text) =>
      connection.apiKey ? text.replaceAll(connection.apiKey, '[密钥已隐藏]') : text;
    const tokens = result.usage?.total_tokens;
    return {
      content: redact(choice.message.content),
      totalTokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null,
    };
  } catch (error) {
    if (signal?.aborted)
      throw new WorkbenchError('评审已取消，已发生的调用可能仍计费。', 'REVIEW_CANCELLED');
    if (timeout.aborted) throw new WorkbenchError('模型请求超时，请稍后重试。', 'MODEL_TIMEOUT');
    if (error instanceof WorkbenchError) throw error;
    throw new WorkbenchError(
      '无法连接模型服务，请检查地址、网络与接口协议。',
      'MODEL_NETWORK_ERROR',
    );
  }
}

module.exports = { ModelSettings, callModel, atomicJson };
