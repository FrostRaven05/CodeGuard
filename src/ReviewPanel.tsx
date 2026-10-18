import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, LoaderCircle, Settings2, Sparkles } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import type {
  Finding,
  ModelSettings,
  RepositoryState,
  ReviewOptions,
  ReviewPreview,
  ReviewState,
} from './types';

const emptyOptions = { standards: '', requirements: '' };
export function ReviewPanel({
  repository,
  settingsVersion,
  onSettings,
  onState,
  onLocate,
}: {
  repository: RepositoryState;
  settingsVersion: number;
  onSettings: () => void;
  onState: (value: ReviewState) => void;
  onLocate: (finding: Finding) => void;
}) {
  const id = repository.repositoryId;
  const [review, setReview] = useState<ReviewState | null>(null);
  const [options, setOptions] = useState<ReviewOptions>(emptyOptions);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [preview, setPreview] = useState<ReviewPreview | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const alive = useRef(true),
    initialized = useRef(false),
    request = useRef(0);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const update = useCallback(async () => {
    const generation = ++request.current;
    try {
      const value = await api.reviewState(id);
      if (!alive.current || generation !== request.current) return;
      setReview(value);
      if (!initialized.current) {
        initialized.current = true;
        setOptions(value.options);
      }
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '无法读取评审。');
    }
  }, [id]);
  useEffect(() => {
    alive.current = true;
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
  }, [repository.indexRevision, settingsVersion, update]);
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
  async function prepare() {
    if (!settings?.baseUrl) {
      onSettings();
      return;
    }
    setPreparing(true);
    setError('');
    try {
      await api.saveReviewOptions(id, options);
      const value = await api.prepareReview(id);
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
    setError('');
    setCopied('');
    setManualCopy('');
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
  async function copy(finding: Finding) {
    const text = `本次提交评审 · ${finding.evidenceStatus}\n快照 ${review?.latest?.tree}\n${finding.priority} ${finding.title}\n位置：${finding.path}:${finding.line}（${finding.side === 'new' ? '暂存版本' : '父版本'}）\n触发：${finding.trigger}\n后果：${finding.consequence}\n证据：\n${finding.evidence}\n修复方向：${finding.suggestion}\n验证：未运行；请先核对当前源码再修复。`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(finding.id);
      setManualCopy('');
    } catch {
      setManualCopy(text);
    }
  }
  const latest = review?.latest;
  const running = pending || review?.running;
  const dirty = Boolean(
    review &&
    (options.standards !== review.options.standards ||
      options.requirements !== review.options.requirements),
  );
  const stale = Boolean(latest?.stale || dirty);
  useEffect(() => {
    if (review)
      onStateRef.current({
        ...review,
        running: Boolean(pending || review.running),
        latest: latest ? { ...latest, stale } : null,
      });
  }, [review, latest, stale, pending]);
  const staged = repository.files.filter(
    (file) => file.indexStatus !== '.' && !file.conflict,
  ).length;
  return (
    <section className="review-panel" aria-label="本次提交评审">
      <div className="review-heading">
        <h2>
          <Sparkles size={15} />
          AI 评审
        </h2>
        <button
          className="icon-button"
          title="模型服务设置"
          aria-label="模型服务设置"
          onClick={onSettings}
        >
          <Settings2 size={14} />
        </button>
      </div>
      <p className="field-help">
        本次提交 · 只评审暂存内容
        <br />
        结果仅供参考，随时可以继续提交。
      </p>
      <details className="review-options">
        <summary>
          规范与需求 <span>可选</span>
        </summary>
        <label>
          评审规范
          <textarea
            value={options.standards}
            maxLength={16000}
            disabled={!!running || preparing}
            placeholder="例如：公共接口保持兼容；优先检查错误处理。"
            onChange={(event) => setOptions({ ...options, standards: event.target.value })}
          />
        </label>
        <label>
          本次需求
          <textarea
            value={options.requirements}
            maxLength={16000}
            disabled={!!running || preparing}
            placeholder="粘贴本次需求；留空将跳过需求核对。"
            onChange={(event) => setOptions({ ...options, requirements: event.target.value })}
          />
        </label>
        <p className="field-help">点击评审时保存到本地；本批次暂不自动发现项目文档。</p>
      </details>
      <div className="review-actions">
        <button
          className="secondary"
          disabled={preparing || !!running || !staged || !review}
          onClick={() => void prepare()}
        >
          {preparing || running ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {preparing ? '准备范围…' : running ? '正在评审…' : '评审本次提交'}
        </button>
        {running && (
          <button className="text-button" onClick={() => void cancel()}>
            取消
          </button>
        )}
      </div>
      {!settings?.baseUrl && <p className="field-help">首次使用请配置模型服务。</p>}
      {(error || review?.error) && (
        <p className="review-error" role="alert">
          {error || review?.error}
        </p>
      )}
      {latest && (
        <div className="review-result">
          <div className={`review-state ${stale ? 'outdated' : ''}`}>
            {stale
              ? '基于旧版本 · 建议重新评审'
              : latest.skipped.length || latest.unverifiedCount
                ? '评审完成 · 部分覆盖'
                : '评审完成'}
            <small>
              {latest.model} ·{' '}
              {new Date(latest.createdAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          </div>
          <p className="review-summary">{latest.summary}</p>
          <p className="field-help">
            {latest.hasRequirements ? '已按所填需求核对' : '未核对需求'} · 检查未运行
            <br />
            覆盖 {latest.included.length} 个文件 · 用量{' '}
            {latest.totalTokens === null ? '未知' : `${latest.totalTokens} tokens`} · 费用未知
          </p>
          {latest.unverifiedCount > 0 && (
            <p className="review-error">
              {latest.unverifiedCount} 条候选问题的格式、位置或摘录未通过核对，未列为有效发现。
            </p>
          )}
          {latest.skipped.length > 0 && (
            <details className="review-coverage">
              <summary>{latest.skipped.length} 个文件未评审</summary>
              {latest.skipped.map((item) => (
                <p key={item.path}>
                  {item.path}
                  <small>{item.reason}</small>
                </p>
              ))}
            </details>
          )}
          {!latest.findings.length && (
            <p className="field-help">
              {latest.unverifiedCount
                ? '没有可定位的问题；候选问题仍需人工核对。'
                : latest.skipped.length
                  ? '已覆盖范围未发现问题；排除部分未评审。'
                  : '本范围未发现问题。'}
            </p>
          )}
          {latest.findings.map((finding, index) => (
            <details key={finding.id} className="finding" open={index === 0}>
              <summary>
                <span className={`priority priority-${finding.priority}`}>{finding.priority}</span>
                {finding.title}
              </summary>
              <span className="evidence-label">
                {finding.evidenceStatus} ·{' '}
                {
                  { correctness: '正确性', standards: '规范', requirements: '需求' }[
                    finding.category
                  ]
                }
              </span>
              <button
                className="finding-location"
                disabled={stale}
                title={stale ? '旧版本位置，请先重新评审' : '查看暂存差异中的对应行'}
                onClick={() => onLocate(finding)}
              >
                {finding.path}:{finding.line} · {finding.side === 'new' ? '暂存版本' : '父版本'}
              </button>
              <p>
                <b>触发</b>
                {finding.trigger}
              </p>
              <p>
                <b>影响</b>
                {finding.consequence}
              </p>
              <pre>{finding.evidence}</pre>
              <p>
                <b>建议</b>
                {finding.suggestion}
              </p>
              <button className="text-button" disabled={stale} onClick={() => void copy(finding)}>
                <Copy size={12} />
                {copied === finding.id ? '已复制' : '复制给编码助手'}
              </button>
            </details>
          ))}
          {manualCopy && (
            <label className="manual-copy">
              复制不可用，请选择以下内容手动复制
              <textarea readOnly value={manualCopy} onFocus={(event) => event.target.select()} />
            </label>
          )}
        </div>
      )}
      {!latest && !running && <p className="field-help">尚未评审 · 检查未运行</p>}
      {preview && (
        <Modal title="发送本次提交评审" onClose={() => setPreview(null)}>
          <p className="dialog-subtitle">
            仅将以下固定暂存差异与所填规范、需求发送给你的模型服务。
          </p>
          <div className="review-destination">
            <strong>{preview.model}</strong>
            <span>{preview.baseUrl}</span>
            <small>
              {preview.branch} · 暂存树 {preview.tree.slice(0, 8)} · 约{' '}
              {preview.chars.toLocaleString()} 字符
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
