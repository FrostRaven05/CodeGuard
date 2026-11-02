import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import { useFindingRevision, findingDisposition, flushFindingDrafts } from './findingDrafts';
import {
  useReviewDraft,
  initializeReviewDraft,
  saveReviewDraft,
  flushReviewDraft,
} from './reviewDrafts';
import type {
  ModelSettings,
  RepositoryState,
  ReviewScope,
  ReviewPreview,
  ReviewState,
  ReviewProgress,
} from './types';

export function ReviewPanel({
  repository,
  settingsVersion,
  onSettings,
  onState,
  onOpen,
  workspaceOpen,
  scope,
  onScope,
}: {
  repository: RepositoryState;
  settingsVersion: number;
  onSettings: () => void;
  onState: (value: ReviewState) => void;
  onOpen: () => void;
  workspaceOpen: boolean;
  scope: ReviewScope;
  onScope: (scope: ReviewScope) => void;
}) {
  useFindingRevision();
  const id = repository.repositoryId;
  const [review, setReview] = useState<ReviewState | null>(null);
  const draft = useReviewDraft(id);
  const options = draft.options;
  const setOptions = (value: typeof options) => saveReviewDraft(id, value);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true),
    request = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const update = useCallback(async () => {
    const generation = ++request.current;
    try {
      const value = await api.reviewState(id, scope);
      if (!alive.current || generation !== request.current || currentScope.current !== scope)
        return;
      setReview(value);
      initializeReviewDraft(id, value.options);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '无法读取评审。');
    }
  }, [id, scope]);
  useEffect(() => {
    alive.current = true;
    setReview(null);
    setPreview(null);
    void update();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void update();
    }, 4000);
    return () => {
      alive.current = false;
      request.current++;
      window.clearInterval(timer);
    };
  }, [update]);
  useEffect(() => {
    void update();
  }, [repository.revision, settingsVersion, update]);
  const acceptProgress = useCallback(
    (progress: ReviewProgress) => {
      if (!alive.current || progress.repositoryId !== id || progress.scope !== scope) return;
      setReview((previous) => {
        if (!previous || (previous.progress && previous.progress.startedAt > progress.startedAt))
          return previous;
        return {
          ...previous,
          progress,
          running: progress.status === 'running',
          runningScope: progress.status === 'running' ? progress.scope : null,
        };
      });
    },
    [id, scope],
  );
  useEffect(() => api.onReviewProgress(acceptProgress), [acceptProgress]);
  useEffect(() => {
    // The disposable browser preview has no Electron event channel. Poll only the
    // in-memory progress snapshot, without repeating Git fingerprint work.
    if (api.mode === 'desktop' || !(pending || review?.running)) return;
    let disposed = false,
      reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const progress = await api.reviewProgress(id, scope);
        if (!disposed && progress) acceptProgress(progress);
      } catch {
        /* The regular state refresh reports connection failures. */
      } finally {
        reading = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [id, scope, pending, review?.running, acceptProgress]);
  useEffect(() => {
    if (draft.initialized && !draft.saving && !draft.error) void update();
  }, [draft.saving, draft.initialized, draft.error, update]);
  useEffect(() => {
    let mounted = true;
    api
      .modelSettings()
      .then((value) => mounted && setSettings(value))
      .catch((reason) => mounted && setError(reason.message));
    setPreview(null);
    return () => {
      mounted = false;
    };
  }, [settingsVersion]);
  async function prepare(target: ReviewScope = scope) {
    onScope(target);
    if (!settings?.baseUrl) {
      onSettings();
      return;
    }
    setPreparing(true);
    setError('');
    try {
      await flushReviewDraft(id);
      await flushFindingDrafts(id, target);
      const value = await api.prepareReview(id, target);
      if (alive.current) setPreview(value);
      await update();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '无法准备评审。');
    } finally {
      if (alive.current) setPreparing(false);
    }
  }
  async function start() {
    if (!preview) return;
    const token = preview.token;
    setPreview(null);
    setPending(true);
    setReview((previous) => (previous ? { ...previous, progress: null } : previous));
    setError('');
    onOpen();
    try {
      await api.startReview(id, token);
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '评审失败。');
    } finally {
      if (alive.current) {
        setPending(false);
        await update();
      }
    }
  }
  async function cancel() {
    try {
      await api.cancelReview(id);
      await update();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '取消失败。');
    }
  }
  const latest = review?.scope === scope ? review.latest : null;
  const running = pending || review?.running;
  const dirty = Boolean(
    review &&
    (options.standards !== review.options.standards ||
      options.requirements !== review.options.requirements),
  );
  const stale = Boolean(latest?.stale || dirty);
  useEffect(() => {
    if (review && review.scope === scope)
      onStateRef.current({
        ...review,
        running: Boolean(pending || review.running),
        latest: latest ? { ...latest, stale } : null,
      });
  }, [review, latest, stale, pending, scope]);
  const staged = repository.files.filter(
    (file) => file.indexStatus !== '.' && !file.conflict,
  ).length;
  return (
    <section className="review-panel" aria-label="改动理解与评审">
      <div className="review-scope-switch" role="group" aria-label="分析范围">
        <button
          className={scope === 'local' ? 'active' : ''}
          aria-pressed={scope === 'local'}
          disabled={!!running || preparing || !draft.initialized}
          onClick={() => onScope('local')}
        >
          全部本地改动
        </button>
        <button
          className={scope === 'staged' ? 'active' : ''}
          aria-pressed={scope === 'staged'}
          disabled={!!running || preparing || !draft.initialized}
          onClick={() => onScope('staged')}
        >
          本次提交
        </button>
      </div>
      <p className="field-help">
        {scope === 'local'
          ? '理解当前工作区和未跟踪文件，不会暂存。'
          : '仅评审已暂存内容，与未暂存编辑分开。'}
      </p>
      <div className="review-actions">
        <button
          className="secondary understand-local-button"
          disabled={preparing || !!running || !repository.files.length || !draft.initialized}
          onClick={() => void prepare('local')}
        >
          <Sparkles size={16} />
          {scope === 'local' && preparing
            ? '准备范围…'
            : scope === 'local' && running
              ? '正在理解改动…'
              : '理解全部本地改动'}
        </button>
        <button
          className="secondary"
          title="仅评审已暂存的内容"
          disabled={preparing || !!running || !staged || !draft.initialized}
          onClick={() => void prepare('staged')}
        >
          {preparing || running ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {scope === 'staged' && preparing
            ? '准备范围…'
            : scope === 'staged' && running
              ? '正在评审…'
              : '评审本次提交'}
        </button>
        {running && (
          <button className="text-button" onClick={() => void cancel()}>
            取消
          </button>
        )}
      </div>
      {!staged ? (
        <p className="field-help review-hint">可先理解全部改动；评审本次提交需要暂存文件</p>
      ) : (
        !settings?.baseUrl && (
          <button className="text-button" onClick={onSettings}>
            配置模型服务
          </button>
        )
      )}
      {(error || review?.error) && (
        <p className="review-error" role="alert">
          {error || review?.error}
        </p>
      )}
      {running && !workspaceOpen && (
        <div className="review-live-status" role="status">
          <LoaderCircle size={14} className="spin" />
          <span>{review?.progress?.events.at(-1)?.label || '正在启动评审…'}</span>
          {!workspaceOpen && (
            <button className="text-button" onClick={onOpen}>
              查看过程
            </button>
          )}
        </div>
      )}
      {latest && (
        <div className="review-result">
          <p className={`review-state ${stale ? 'outdated' : ''}`}>
            {running
              ? '重新评审中 · 保留上次结果'
              : stale
                ? '结果已过期'
                : latest.skipped.length || latest.unverifiedCount || latest.contextSkipped?.length
                  ? '评审完成 · 部分覆盖'
                  : '评审完成'}
            <span>
              {' '}
              ·{' '}
              {
                latest.findings.filter(
                  (f) =>
                    (findingDisposition(id, latest.id, scope, f.id)?.status ||
                      f.disposition?.status ||
                      'pending') === 'pending',
                ).length
              }{' '}
              项待处理
            </span>
          </p>
          {!workspaceOpen && (
            <button className="secondary review-open-workspace" onClick={onOpen}>
              查看审查结果
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <details className="review-options">
        <summary>规范与需求</summary>
        <p className={draft.error ? 'review-error' : 'field-help'} role="status">
          {draft.error
            ? `保存失败：${draft.error}`
            : draft.saving
              ? '保存中…'
              : draft.initialized
                ? '已自动保存'
                : '读取草稿…'}
          {draft.error && (
            <button className="text-button" onClick={() => saveReviewDraft(id, options)}>
              重试保存
            </button>
          )}
        </p>
        <div className="review-options-fields">
          <label>
            评审规范
            <textarea
              value={options.standards}
              maxLength={16000}
              disabled={!!running || preparing || !draft.initialized}
              placeholder="例如：公共接口保持兼容；检查错误处理。"
              onChange={(event) => setOptions({ ...options, standards: event.target.value })}
            />
          </label>
          <label>
            本次需求
            <textarea
              value={options.requirements}
              maxLength={16000}
              disabled={!!running || preparing || !draft.initialized}
              placeholder="留空则跳过需求核对"
              onChange={(event) => setOptions({ ...options, requirements: event.target.value })}
            />
          </label>
        </div>
      </details>
      {preview && (
        <Modal
          title={preview.scope === 'local' ? '发送全部本地改动分析' : '发送本次提交评审'}
          onClose={() => setPreview(null)}
        >
          <p className="dialog-subtitle">
            将以下固定差异、相关代码片段与所填规范、需求发送给你的模型服务。
          </p>
          <div className="review-destination">
            <strong>{preview.model}</strong>
            <span>{preview.baseUrl}</span>
            <small>
              {preview.branch} · {preview.scope === 'local' ? '工作区快照' : '暂存树'}{' '}
              {preview.tree.slice(0, 8)} · 约 {preview.chars.toLocaleString()} 字符
            </small>
          </div>
          <div className="preview-file-list">
            {preview.included.map((file) => (
              <div key={file.path}>
                <span>{file.path}</span>
                <small>{file.chars.toLocaleString()} 字符</small>
              </div>
            ))}
          </div>
          <details className="review-coverage" open>
            <summary>相关上下文 {preview.contexts.length} 段</summary>
            {preview.contexts.map((item, index) => (
              <p key={index}>
                {item.path}:{item.startLine}–{item.endLine}
                <small>
                  {item.side === 'new'
                    ? preview.scope === 'local'
                      ? '工作区快照'
                      : '暂存树'
                    : '父版本'}{' '}
                  {item.revision.slice(0, 8)} · {item.kind} · {item.chars} 字符
                </small>
              </p>
            ))}
            <p className="field-help">{preview.contextLimitation}</p>
            {preview.contextSkipped.map((item, index) => (
              <p key={index}>
                {item.path}
                <small>{item.reason}</small>
              </p>
            ))}
          </details>
          {preview.skipped.length > 0 && (
            <details className="review-coverage" open>
              <summary>{preview.skipped.length} 个文件不会发送</summary>
              {preview.skipped.map((file) => (
                <p key={file.path}>
                  {file.path}
                  <small>{file.reason}</small>
                </p>
              ))}
            </details>
          )}
          <p className="dialog-note">
            {preview.hasRequirements ? '包含填写的需求' : '未核对需求'} ·{' '}
            {preview.hasStandards ? '包含填写的规范' : '通用正确性评审'} ·
            不运行检查。模型调用可能产生费用。
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setPreview(null)}>
              返回
            </button>
            <button
              className="primary"
              disabled={!preview.included.length}
              onClick={() => void start()}
            >
              发送并评审
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
