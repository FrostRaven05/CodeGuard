import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, LoaderCircle } from 'lucide-react';
import { api, ApiError } from './api';
import { Modal } from './Modal';
import { SettingsSelect } from './SettingsSelect';
import type {
  GitOperationKind,
  GitOperationOptions,
  GitOperationPreview,
  GitOperationRequest,
  RepositoryState,
} from './types';

export const operationLabels: Record<GitOperationKind, string> = {
  fetch: '获取远端',
  pull: '拉取',
  push: '推送',
  switch: '切换分支',
  merge: '合并到当前分支',
  continueMerge: '继续合并',
  abortMerge: '中止合并',
};

export function GitOperationDialog({
  repositoryId,
  initial,
  onClose,
  onBusy,
  onFinished,
  onManageRemotes,
}: {
  repositoryId: string;
  initial: GitOperationRequest;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onFinished: (message?: string, warning?: string | null, state?: RepositoryState) => void;
  onManageRemotes: () => void;
}) {
  const [options, setOptions] = useState<GitOperationOptions | null>(null);
  const [request, setRequest] = useState(initial);
  const [preview, setPreview] = useState<GitOperationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState('');
  const label = operationLabels[request.kind];
  const network = ['fetch', 'push', 'pull'].includes(request.kind);
  const branchOperation =
    request.kind === 'switch' || (request.kind === 'merge' && !request.pullToken);
  const branches =
    options?.state.branches.filter(
      (b) => !b.current && !b.symbolic && (request.kind !== 'switch' || !b.remote),
    ) || [];
  const remoteBranches =
    options?.state.branches.filter(
      (b) => b.remote && !b.symbolic && b.ref.startsWith(`refs/remotes/${request.remote}/`),
    ) || [];
  function failure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '操作失败，请刷新后核对。');
    setDetails(reason instanceof ApiError ? reason.details : '');
  }
  useEffect(() => {
    let alive = true;
    api
      .operationOptions(repositoryId)
      .then((value) => {
        if (!alive) return;
        setOptions(value);
        setRequest((previous) => ({
          ...previous,
          remote:
            previous.remote ||
            (value.remotes.some((r) => r.name === value.upstreamRemote)
              ? value.upstreamRemote
              : '') ||
            (previous.kind === 'fetch' && value.remotes.length === 1 ? value.remotes[0].name : ''),
          branch: previous.branch || value.upstreamBranch || '',
          setUpstream: previous.setUpstream ?? !value.upstreamRemote,
        }));
      })
      .catch((reason) => alive && failure(reason));
    return () => {
      alive = false;
    };
  }, [repositoryId]);
  function change(next: Partial<GitOperationRequest>) {
    setRequest((previous) => ({ ...previous, ...next }));
    setPreview(null);
    setError('');
    setDetails('');
  }
  async function prepare(mergePull = false) {
    setBusy(true);
    onBusy(true);
    setError('');
    setDetails('');
    try {
      const next: GitOperationRequest =
        mergePull && preview ? { kind: 'merge', pullToken: preview.token } : request;
      const value = await api.prepareOperation(repositoryId, next);
      setRequest(next);
      setPreview(value);
    } catch (reason) {
      failure(reason);
      onFinished();
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  async function execute() {
    if (!preview) return;
    setBusy(true);
    onBusy(true);
    setError('');
    setDetails('');
    try {
      const result = await api.executeOperation(repositoryId, preview.token);
      onFinished(result.message, result.warning, result.state);
      onClose();
    } catch (reason) {
      failure(reason);
      setPreview(null);
      onFinished();
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <Modal
      title={label}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="dialog-subtitle">
        {request.kind === 'pull'
          ? '预览时先获取所选远端分支，只允许快进更新。'
          : request.kind === 'push'
            ? '确认目标和提交后普通推送。'
            : request.kind === 'switch'
              ? '选择已有本地分支，Git 会检查本地改动能否安全保留。'
              : request.kind === 'merge'
                ? '将来源合并到当前分支，冲突保留并由你处理。'
                : request.kind === 'continueMerge'
                  ? '先在外部解决并暂存冲突，再预览合并提交。'
                  : request.kind === 'abortMerge'
                    ? '确认后由 Git 尝试恢复到合并前状态。'
                    : '更新远端跟踪状态，不更新工作区文件。'}
      </p>
      {options && (
        <div className="settings-form operation-form">
          <div className="operation-current">
            当前分支 <strong>{options.state.detached ? '游离 HEAD' : options.state.branch}</strong>
          </div>
          {network && (
            <>
              <SettingsSelect
                label="远端"
                value={request.remote || ''}
                disabled={busy}
                options={[
                  { value: '', label: '选择远端' },
                  ...options.remotes.map((r) => ({ value: r.name, label: r.name })),
                ]}
                onChange={(remote) => change({ remote, branch: '' })}
              />
              {!options.remotes.length && (
                <p className="field-help">
                  尚未配置远端。
                  <button type="button" className="text-button" onClick={onManageRemotes}>
                    添加远程仓库
                  </button>
                </p>
              )}
              {request.kind !== 'fetch' && (
                <label>
                  远端分支
                  <input
                    value={request.branch || ''}
                    disabled={busy}
                    placeholder="选择已有分支或输入目标名称"
                    list="operation-remote-branches"
                    onChange={(e) => change({ branch: e.target.value })}
                  />
                  <datalist id="operation-remote-branches">
                    {remoteBranches.map((b) => (
                      <option
                        key={b.ref}
                        value={b.ref.slice(`refs/remotes/${request.remote}/`.length)}
                      />
                    ))}
                  </datalist>
                </label>
              )}
              {request.kind === 'push' && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={request.setUpstream || false}
                    disabled={busy}
                    onChange={(e) => change({ setUpstream: e.target.checked })}
                  />
                  将此目标设为当前分支的上游
                </label>
              )}
            </>
          )}
          {branchOperation && (
            <SettingsSelect
              label={request.kind === 'switch' ? '目标分支' : '来源分支'}
              value={request.source || ''}
              disabled={busy}
              options={[
                { value: '', label: '选择分支' },
                ...branches.map((b) => ({ value: b.ref, label: b.name })),
              ]}
              onChange={(source) => change({ source })}
            />
          )}
          {preview && (
            <section className="operation-preview" aria-label="操作预览">
              <div className="operation-direction">
                <strong>
                  {request.kind === 'push' || request.kind === 'switch'
                    ? preview.currentBranch
                    : preview.sourceName ||
                      (preview.remote
                        ? `${preview.remote}${preview.branch ? '/' + preview.branch : ''}`
                        : preview.currentBranch)}
                </strong>
                <ArrowRight size={15} />
                <strong>
                  {request.kind === 'push'
                    ? `${preview.remote}/${preview.branch}`
                    : request.kind === 'switch'
                      ? preview.sourceName
                      : request.kind === 'fetch'
                        ? '远端跟踪引用'
                        : preview.currentBranch}
                </strong>
              </div>
              {!!preview.addresses?.length && (
                <p className="field-help">{preview.addresses.join(' · ')}</p>
              )}
              {preview.target && (
                <p className="field-help">来源版本 {preview.target.slice(0, 12)}</p>
              )}
              {['pull', 'merge', 'switch'].includes(request.kind) && (
                <p className="field-help">
                  当前分支独有 {preview.localOnly} 个提交 · 来源独有 {preview.incoming} 个提交
                </p>
              )}
              {preview.warnings.map((warning, i) => (
                <p key={i} className="operation-warning">
                  <AlertTriangle size={14} />
                  {warning}
                </p>
              ))}
              {!!preview.commits.length && (
                <details open>
                  <summary>
                    {request.kind === 'push' ? '待推送' : '来源'}提交（{preview.incoming}，最多列出
                    100 条）
                  </summary>
                  <ul className="operation-commits">
                    {preview.commits.map((c) => (
                      <li key={c.hash}>
                        <code>{c.hash.slice(0, 8)}</code>
                        <span>{c.subject}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {!!preview.files.length && (
                <details>
                  <summary>
                    {request.kind === 'switch'
                      ? '分支间差异'
                      : request.kind === 'merge'
                        ? '分支间差异（不等于最终合并结果）'
                        : '涉及文件'}{' '}
                    · {preview.files.length}
                  </summary>
                  <ul className="operation-files">
                    {preview.files.map((f, i) => (
                      <li key={i}>
                        <code>{f.status}</code>
                        {f.path}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {request.kind === 'continueMerge' && (
                <pre className="operation-message">{preview.message}</pre>
              )}
            </section>
          )}
          {error && (
            <div className="dialog-error" role="alert">
              <div>
                {error}
                {details && (
                  <details>
                    <summary>错误详情</summary>
                    <pre>{details}</pre>
                  </details>
                )}
              </div>
            </div>
          )}
          <div className="dialog-actions">
            <button className="secondary" disabled={busy} onClick={onClose}>
              取消
            </button>
            {preview ? (
              <>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setPreview(null);
                    if (request.pullToken) {
                      setRequest(initial);
                    }
                  }}
                >
                  重新选择
                </button>
                {!preview.canExecute && request.kind === 'pull' && !preview.unrelated && (
                  <button className="primary" disabled={busy} onClick={() => void prepare(true)}>
                    预览显式合并
                  </button>
                )}
                {preview.canExecute && (
                  <button className="primary" disabled={busy} onClick={() => void execute()}>
                    {busy && <LoaderCircle size={14} className="spin" />}确认{label}
                  </button>
                )}
              </>
            ) : (
              <button
                className="primary"
                disabled={
                  busy ||
                  (network && (!request.remote || (request.kind !== 'fetch' && !request.branch))) ||
                  (branchOperation && !request.source)
                }
                onClick={() => void prepare()}
              >
                {busy && <LoaderCircle size={14} className="spin" />}
                {busy ? '准备中…' : request.kind === 'pull' ? '获取并预览' : '预览操作'}
              </button>
            )}
          </div>
        </div>
      )}
      {!options && <p role={error ? 'alert' : 'status'}>{error || '读取仓库状态…'}</p>}
    </Modal>
  );
}
