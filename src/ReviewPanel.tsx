import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react';
import { api } from './api';
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
  const [preparation, setPreparation] = useState<ReviewState['preparation']>(null);
  const preparing = Boolean(preparation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true),
    request = useRef(0);
  const currentScope = useRef(scope);
  const activeTask = useRef<{ target: ReviewScope; cancelled: boolean; started: boolean } | null>(
    null,
  );
  const nextScope: ReviewScope = repository.files.some(
    (file) => file.indexStatus !== '.' && !file.untracked,
  )
    ? 'staged'
    : 'local';
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
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(
    () => () => {
      if (activeTask.current && !activeTask.current.started) activeTask.current.cancelled = true;
    },
    [id],
  );
  useEffect(() => {
    alive.current = true;
    setReview(null);
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
    return () => {
      mounted = false;
    };
  }, [settingsVersion]);
  async function prepare() {
    if (activeTask.current || pending || review?.running) return;
    if (!settings?.baseUrl) {
      onSettings();
      return;
    }
    const task = { target: nextScope, cancelled: false, started: false };
    activeTask.current = task;
    setPreparation({ label: '核对当前暂存状态…' });
    setError('');
    onOpen();
    try {
      const current = await api.state(id);
      if (!alive.current || task.cancelled) return;
      if (!current.files.length) throw new Error('没有可分析的本地改动。');
      const target: ReviewScope = current.files.some(
        (file) => file.indexStatus !== '.' && !file.untracked,
      )
        ? 'staged'
        : 'local';
      task.target = target;
      onScope(target);
      setPreparation({ label: '保存评审依据与问题处置…' });
      await flushReviewDraft(id);
      await flushFindingDrafts(id, target);
      if (!alive.current || task.cancelled) return;
      setPreparation({
        label: target === 'local' ? '准备全部本地改动的固定快照…' : '准备本次提交的暂存快照…',
      });
      const value = await api.prepareReview(id, target);
      if (!alive.current || task.cancelled || currentScope.current !== target) return;
      setPending(true);
      setPreparation(null);
      setReview((previous) => ({
        ...(previous?.scope === target
          ? previous
          : { scope: target, options, latest: null, running: false, error: null }),
        progress: null,
        error: null,
      }));
      task.started = true;
      await api.startReview(id, value.token);
    } catch (reason) {
      if (alive.current && !task.cancelled)
        setError(reason instanceof Error ? reason.message : '评审失败。');
    } finally {
      if (activeTask.current === task) activeTask.current = null;
      if (alive.current) {
        setPreparation(null);
        await updateRef.current();
        if (alive.current) setPending(false);
      }
    }
  }
  async function cancel() {
    try {
      if (activeTask.current) {
        activeTask.current.cancelled = true;
        if (!activeTask.current.started) {
          setError('已取消准备，未发送模型请求；已有结果与草稿保留。');
          return;
        }
      }
      await api.cancelReview(id);
      await updateRef.current();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '取消失败。');
    }
  }
  const latest = review?.scope === scope ? review.latest : null;
  const running = preparing || pending || review?.running;
  const dirty = Boolean(
    review &&
    (options.standards !== review.options.standards ||
      options.requirements !== review.options.requirements),
  );
  const stale = Boolean(latest?.stale || dirty);
  useEffect(() => {
    const current = review?.scope === scope ? review : null;
    onStateRef.current({
      ...(current || { scope, options, latest: null, running: false, error: null }),
      preparation,
      progress: preparing ? null : current?.progress || null,
      running: Boolean(preparing || pending || current?.running),
      runningScope: preparing || pending ? scope : current?.runningScope,
      latest: latest ? { ...latest, stale } : null,
      error: error || current?.error || null,
    });
  }, [review, latest, stale, pending, scope, preparation, preparing, error, options]);
  const actionScope = running
    ? activeTask.current?.target || review?.runningScope || scope
    : nextScope;
  return (
    <section className="review-panel" aria-label="改动理解与评审">
      <p className="field-help">
        {actionScope === 'local'
          ? '理解当前工作区和未跟踪文件，不会暂存。'
          : '仅评审已暂存内容，与未暂存编辑分开。'}
      </p>
      <div className="review-actions">
        <button
          className="secondary analysis-button"
          title={
            !repository.files.length
              ? '没有可分析的本地改动'
              : actionScope === 'staged'
                ? '仅评审已暂存的本次提交内容'
                : '理解全部本地改动，不会暂存'
          }
          disabled={preparing || !!running || !repository.files.length || !draft.initialized}
          onClick={() => void prepare()}
        >
          {preparing || running ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {preparing
            ? '准备范围…'
            : running
              ? actionScope === 'staged'
                ? '正在评审…'
                : '正在理解改动…'
              : actionScope === 'staged'
                ? '评审本次提交'
                : '理解全部本地改动'}
        </button>
        {running && (
          <button className="text-button" onClick={() => void cancel()}>
            取消
          </button>
        )}
      </div>
      {!settings?.baseUrl && (
        <button className="text-button" onClick={onSettings}>
          配置模型服务
        </button>
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
                : latest.partialFiles?.length ||
                    latest.skipped.length ||
                    latest.unverifiedCount ||
                    latest.contextSkipped?.length ||
                    latest.investigation?.stats.truncated ||
                    latest.investigation?.stats.skipped
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
              查看改动图解
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
    </section>
  );
}
