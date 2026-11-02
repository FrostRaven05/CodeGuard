import { useEffect, useState } from 'react';
import { Globe, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import type { RemoteSettings } from './types';

type Remote = RemoteSettings['remotes'][number];
type Edit = {
  kind: 'add' | 'edit';
  name: string;
  fetchUrl: string;
  pushUrl: string;
  separatePush: boolean;
  revision: string;
};

export function RemoteSettingsDialog({
  repositoryId,
  repositoryName,
  onClose,
  onChanged,
  onBusy,
  continueLabel,
  onContinue,
}: {
  repositoryId: string;
  repositoryName: string;
  onClose: () => void;
  onChanged: () => void;
  onBusy: (busy: boolean) => void;
  continueLabel?: string;
  onContinue?: () => void;
}) {
  const [settings, setSettings] = useState<RemoteSettings | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [deleting, setDeleting] = useState<Remote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const failure = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : '操作失败，请刷新后重试。');

  useEffect(() => {
    let active = true;
    api
      .remoteSettings(repositoryId)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((reason) => {
        if (active) failure(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repositoryId]);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      setSettings(await api.remoteSettings(repositoryId));
      setEdit(null);
      setDeleting(null);
    } catch (reason) {
      failure(reason);
    } finally {
      setLoading(false);
    }
  }
  function startEdit(remote?: Remote) {
    if (!settings) return;
    setNotice('');
    setError('');
    setDeleting(null);
    setEdit({
      kind: remote ? 'edit' : 'add',
      name: remote?.name || 'origin',
      fetchUrl: remote?.redacted ? '' : remote?.fetchUrls[0] || '',
      pushUrl: remote?.redacted ? '' : remote?.pushUrls[0] || '',
      separatePush: !!remote?.pushUrls.length,
      revision: settings.revision,
    });
  }
  async function apply() {
    if (!settings || busy || (!edit && !deleting)) return;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.changeRemote(
        repositoryId,
        edit
          ? {
              kind: edit.kind,
              revision: edit.revision,
              name: edit.name.trim(),
              fetchUrl: edit.fetchUrl.trim(),
              pushUrl: edit.separatePush ? edit.pushUrl.trim() : '',
            }
          : { kind: 'remove', revision: settings.revision, name: deleting!.name },
      );
      setSettings(result);
      setEdit(null);
      setDeleting(null);
      setNotice(edit ? '远程仓库已保存。' : '远程仓库连接已删除。');
      onChanged();
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <Modal
      title="远程仓库管理"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="remote-manager">
        <p className="dialog-subtitle">{repositoryName} · 管理此仓库的远端连接</p>
        {error && (
          <p className="review-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="review-success" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p className="field-help">
            <LoaderCircle size={14} className="spin" />
            读取远程仓库…
          </p>
        ) : (
          <>
            <div className="remote-manager-toolbar">
              <span>{settings ? `${settings.remotes.length} 个远程仓库` : '未读取配置'}</span>
              <button className="text-button" disabled={busy} onClick={() => void reload()}>
                <RefreshCw size={13} />
                刷新列表
              </button>
              <button
                className="secondary"
                disabled={busy || !!edit || !settings}
                onClick={() => startEdit()}
              >
                <Plus size={14} />
                添加远程仓库
              </button>
            </div>
            <div className="remote-list">
              {settings && !settings.remotes.length && (
                <p className="remote-empty">尚未配置远程仓库。添加后即可获取、拉取和推送。</p>
              )}
              {settings?.remotes.map((remote) => (
                <section className="remote-card" key={remote.name} data-remote-name={remote.name}>
                  <div className="remote-card-heading">
                    <Globe size={15} />
                    <strong>{remote.name}</strong>
                    <button
                      className="icon-button"
                      disabled={busy || !!edit || !remote.editable}
                      aria-label={`编辑远端 ${remote.name}`}
                      title={remote.limitation || '编辑地址'}
                      onClick={() => startEdit(remote)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={busy || !!edit || !remote.removable}
                      aria-label={`删除远端 ${remote.name}`}
                      title={remote.removable ? '删除远端连接' : remote.limitation || ''}
                      onClick={() => {
                        setDeleting(remote);
                        setError('');
                        setNotice('');
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <dl className="remote-addresses">
                    <dt>获取地址</dt>
                    <dd>
                      {remote.fetchUrls.map((url, index) => (
                        <div key={index}>{url}</div>
                      ))}
                    </dd>
                    <dt>推送地址</dt>
                    <dd>
                      {remote.pushUrls.length
                        ? remote.pushUrls.map((url, index) => <div key={index}>{url}</div>)
                        : '与获取地址相同'}
                    </dd>
                  </dl>
                  {!!remote.upstreamBranches.length && (
                    <p className="field-help">关联分支：{remote.upstreamBranches.join('、')}</p>
                  )}
                  {remote.limitation && <p className="field-help">{remote.limitation}</p>}
                  {deleting?.name === remote.name && (
                    <div className="remote-delete-confirm">
                      <p>
                        删除“{remote.name}”的本地连接？Git
                        会移除对应远端跟踪分支及关联上游设置，保留本地分支和服务器上的仓库。
                      </p>
                      <div className="dialog-actions">
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          取消
                        </button>
                        <button
                          className="danger-button"
                          disabled={busy}
                          onClick={() => void apply()}
                        >
                          {busy ? '正在删除…' : `确认删除 ${remote.name}`}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              ))}
            </div>
            {edit && (
              <form
                className="settings-form remote-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void apply();
                }}
              >
                <h3>{edit.kind === 'add' ? '添加远程仓库' : `编辑 ${edit.name}`}</h3>
                <label>
                  远端名称
                  <input
                    name="remoteName"
                    autoFocus
                    value={edit.name}
                    disabled={busy || edit.kind === 'edit'}
                    maxLength={200}
                    onChange={(event) => setEdit({ ...edit, name: event.target.value })}
                    placeholder="origin"
                    required
                  />
                </label>
                <label>
                  获取地址
                  <input
                    name="fetchUrl"
                    value={edit.fetchUrl}
                    disabled={busy}
                    maxLength={4000}
                    onChange={(event) => setEdit({ ...edit, fetchUrl: event.target.value })}
                    placeholder="https://example.com/team/project.git 或 git@host:team/project.git"
                    required
                    spellCheck={false}
                  />
                </label>
                <label className="remote-push-option">
                  <input
                    type="checkbox"
                    checked={edit.separatePush}
                    disabled={busy}
                    onChange={(event) => setEdit({ ...edit, separatePush: event.target.checked })}
                  />
                  使用独立推送地址
                </label>
                {edit.separatePush && (
                  <label>
                    推送地址
                    <input
                      name="pushUrl"
                      value={edit.pushUrl}
                      disabled={busy}
                      maxLength={4000}
                      onChange={(event) => setEdit({ ...edit, pushUrl: event.target.value })}
                      placeholder="输入推送地址"
                      required
                      spellCheck={false}
                    />
                  </label>
                )}
                <p className="field-help">
                  支持 HTTPS、SSH 和本地路径。认证沿用系统 Git 凭据或
                  SSH；保存地址不会连接远端。已有地址若包含隐藏凭据，请输入完整新地址。
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEdit(null);
                      setError('');
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={
                      busy ||
                      !edit.name.trim() ||
                      !edit.fetchUrl.trim() ||
                      (edit.separatePush && !edit.pushUrl.trim())
                    }
                  >
                    {busy ? <LoaderCircle size={14} className="spin" /> : <Globe size={14} />}
                    {busy ? '正在保存…' : '保存远程仓库'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {onContinue && (
          <div className="dialog-actions">
            <button
              className="primary"
              disabled={busy || loading || !!edit || !!deleting || !settings?.remotes.length}
              onClick={onContinue}
            >
              {continueLabel}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
