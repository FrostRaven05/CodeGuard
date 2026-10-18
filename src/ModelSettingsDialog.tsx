import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import type { ModelSettings } from './types';

export function ModelSettingsDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api
      .modelSettings()
      .then((value) => {
        if (alive) {
          setSettings(value);
          if (value.warning) setError(value.warning);
        }
      })
      .catch((reason) => alive && setError(reason.message));
    return () => {
      alive = false;
    };
  }, []);
  async function save(test = false) {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const value = await api.saveModelSettings({ ...settings, apiKey, clearKey });
      setSettings(value);
      setApiKey('');
      setClearKey(false);
      onSaved();
      if (test) setMessage((await api.testModelConnection()).message);
      else setMessage('模型设置已保存。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="模型服务" onClose={onClose}>
      <p className="dialog-subtitle">
        兼容 Chat Completions 接口。保存不会发送代码；连接测试仅发送一句测试文字。
      </p>
      {settings ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="settings-form"
        >
          <label>
            服务地址
            <input
              type="url"
              required
              value={settings.baseUrl}
              placeholder="https://your-service.example/v1"
              disabled={busy}
              onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
            />
          </label>
          <label>
            模型名称
            <input
              required
              value={settings.model}
              placeholder="服务提供的模型 ID"
              maxLength={200}
              disabled={busy}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            />
          </label>
          <label>
            API 密钥
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              disabled={busy}
              placeholder={settings.hasApiKey ? '已保存，留空保持原密钥' : '本地免密服务可留空'}
              onChange={(event) => {
                setApiKey(event.target.value);
                setClearKey(false);
              }}
            />
          </label>
          {settings.hasApiKey && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={clearKey}
                disabled={busy || !!apiKey}
                onChange={(event) => setClearKey(event.target.checked)}
              />
              清除已保存的密钥
            </label>
          )}
          <p className="field-help">
            {settings.keyStorage === 'system'
              ? '密钥由当前系统账户加密保存，不会回显。'
              : '浏览器临时预览：密钥仅在本次服务进程内保留，重启后需重新填写。'}
          </p>
          <details className="advanced-settings">
            <summary>上下文与排除</summary>
            <label>
              上下文预算（字符）
              <input
                type="number"
                min={4000}
                max={200000}
                value={settings.maxContextChars}
                disabled={busy}
                onChange={(event) =>
                  setSettings({ ...settings, maxContextChars: Number(event.target.value) })
                }
              />
            </label>
            <label>
              额外排除路径
              <textarea
                value={settings.excludePatterns}
                disabled={busy}
                placeholder={'每行一项，例如：\ninternal/**\n*.generated.ts'}
                onChange={(event) =>
                  setSettings({ ...settings, excludePatterns: event.target.value })
                }
              />
            </label>
            <p className="field-help">
              支持 *、**、?。默认排除常见密钥文件、生成目录、二进制及超大文件。
            </p>
          </details>
          {error && (
            <p role="alert" className="review-error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="review-success">
              {message}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              保存并测试
            </button>
            <button className="primary" disabled={busy}>
              {busy && <LoaderCircle size={14} className="spin" />}保存设置
            </button>
          </div>
        </form>
      ) : (
        <p role={error ? 'alert' : 'status'}>{error || '读取设置…'}</p>
      )}
    </Modal>
  );
}
