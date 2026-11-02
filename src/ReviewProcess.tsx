import { useEffect, useState } from 'react';
import { Check, ChevronDown, Circle, LoaderCircle, Sparkles, Square, X } from 'lucide-react';
import { api } from './api';
import type { ReviewProgress } from './types';

const seconds = (milliseconds: number) => `${(Math.max(0, milliseconds) / 1000).toFixed(1)} 秒`;

export function ReviewProcess({ progress }: { progress: ReviewProgress }) {
  const running = progress.status === 'running';
  const [expanded, setExpanded] = useState(running || progress.status !== 'completed');
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setExpanded(progress.status !== 'completed');
    setCancelling(false);
    setError('');
  }, [progress.runId, progress.status]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancelReview(progress.repositoryId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消失败，请重试。');
      setCancelling(false);
    }
  };
  const label = running
    ? '正在评审'
    : progress.status === 'completed'
      ? '评审完成'
      : progress.status === 'cancelled'
        ? '已取消'
        : '评审未完成';
  return (
    <section className={`review-process ${progress.status}`} aria-label="评审过程">
      <header className="review-process-heading">
        <button
          className="review-process-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="review-process-icon">
            {running ? (
              <LoaderCircle size={18} className="spin" />
            ) : progress.status === 'completed' ? (
              <Check size={18} />
            ) : (
              <X size={18} />
            )}
          </span>
          <span>
            <strong>{label}</strong>
            <small>
              {progress.model} · {progress.fileCount} 个文件
            </small>
          </span>
          <ChevronDown size={15} className={expanded ? 'expanded' : ''} />
        </button>
        <span className="review-process-time">
          {seconds((progress.finishedAt || now) - progress.startedAt)}
        </span>
        {running && (
          <button
            className="review-process-cancel"
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            <Square size={11} />
            {cancelling ? '正在停止…' : '停止'}
          </button>
        )}
      </header>
      <p className="review-process-current" role="status">
        {progress.events.at(-1)?.label}
        {progress.receivedChars > 0 && (
          <span>已接收 {progress.receivedChars.toLocaleString()} 字符</span>
        )}
      </p>
      {expanded && (
        <div className="review-process-body">
          <ol className="review-process-timeline" aria-label="实际执行阶段">
            {progress.events.map((event, index) => {
              const active = running && index === progress.events.length - 1;
              const failed =
                !running && progress.status !== 'completed' && index === progress.events.length - 1;
              return (
                <li
                  key={`${index}:${event.phase}`}
                  className={active ? 'active' : failed ? 'failed' : ''}
                >
                  <span className="review-process-step-icon">
                    {active ? <Circle size={10} /> : failed ? <X size={12} /> : <Check size={12} />}
                  </span>
                  <span>{event.label}</span>
                  <time>+{seconds(event.at - progress.startedAt)}</time>
                </li>
              );
            })}
          </ol>
          {running && (
            <div className="review-stream-output" aria-label="生成中的评审内容">
              <div className="review-stream-label">
                <Sparkles size={14} />
                生成中的评审内容<span>AI 推断待确认</span>
              </div>
              {progress.summary ? (
                <p className="review-stream-summary">{progress.summary}</p>
              ) : (
                <p className="review-stream-waiting">
                  {progress.receivedChars
                    ? '模型正在输出，完整摘要与问题会陆续显示。'
                    : '等待模型开始输出…'}
                  <span className="review-stream-dots" aria-hidden="true">
                    ···
                  </span>
                </p>
              )}
              {progress.findings.map((finding) => (
                <article className="review-stream-finding" key={finding.id}>
                  <div>
                    <span className={`priority ${finding.priority.toLowerCase()}`}>
                      {finding.priority}
                    </span>
                    <strong>{finding.title}</strong>
                  </div>
                  <small>
                    {finding.path}:{finding.line} · 位置已核对
                  </small>
                  <p>{finding.trigger}</p>
                </article>
              ))}
              {!!progress.findings.length && (
                <p className="review-stream-note">
                  已收到 {progress.findings.length} 项完整问题。结果仍在生成，完成后可定位和处理。
                </p>
              )}
            </div>
          )}
          {!running && progress.status !== 'completed' && (
            <p className="review-stream-note">
              本次生成内容未保存为评审结果。可重新发起评审；已有结果与草稿保留。
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
