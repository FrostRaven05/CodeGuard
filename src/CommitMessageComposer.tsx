import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { api, ApiError } from './api';
import { Modal } from './Modal';
import type { CommitMessagePreview } from './types';

export function CommitMessageComposer({
  repositoryId,
  indexRevision,
  stagedCount,
  disabled,
  draft,
  onChange,
  onSettings,
}: {
  repositoryId: string | null;
  indexRevision?: string;
  stagedCount: number;
  disabled: boolean;
  draft: string;
  onChange: (message: string) => void;
  onSettings: () => void;
}) {
  const [preview, setPreview] = useState<CommitMessagePreview | null>(null);
  const [phase, setPhase] = useState<'preparing' | 'generating' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [generatedRevision, setGeneratedRevision] = useState<string | null>(null);
  const mounted = useRef(true);
  const edits = useRef(0);
  const currentDraft = useRef(draft);
  const inputDisabled = !repositoryId || disabled;
  const generateDisabled = inputDisabled || stagedCount === 0 || phase !== null;
  if (currentDraft.current !== draft) {
    currentDraft.current = draft;
    edits.current++;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (repositoryId) void api.cancelCommitMessage(repositoryId).catch(() => {});
    };
  }, [repositoryId]);

  async function prepare() {
    if (!repositoryId || phase) return;
    setPhase('preparing');
    setFeedback('');
    setNeedsSettings(false);
    try {
      const next = await api.prepareCommitMessage(repositoryId);
      if (mounted.current) setPreview(next);
    } catch (error) {
      if (mounted.current) {
        setFeedback(error instanceof Error ? error.message : '无法准备生成，请重试。');
        setNeedsSettings(error instanceof ApiError && error.code === 'MODEL_NOT_CONFIGURED');
      }
    } finally {
      if (mounted.current) setPhase(null);
    }
  }

  async function generate() {
    if (!repositoryId || !preview || phase) return;
    const token = preview.token;
    const editVersion = edits.current;
    setPreview(null);
    setPhase('generating');
    setFeedback('');
    try {
      const result = await api.generateCommitMessage(repositoryId, token);
      if (!mounted.current) return;
      if (edits.current !== editVersion) {
        setFeedback('生成期间草稿已编辑，已保留你的内容。需要时可重新生成。');
        return;
      }
      onChange(result.message);
      setGeneratedRevision(result.indexRevision);
      setFeedback(
        result.partial
          ? '已生成草稿；部分文件未发送，请补充未覆盖的改动。'
          : '已根据暂存内容生成，可继续编辑。',
      );
    } catch (error) {
      if (mounted.current)
        setFeedback(error instanceof Error ? error.message : '生成失败，原草稿已保留。');
    } finally {
      if (mounted.current) setPhase(null);
    }
  }

  return (
    <div className="composition">
      <div className="composition-heading">
        <label htmlFor="commit-message">提交说明</label>
        <button
          className="generate-commit-button"
          aria-label="生成提交信息"
          title={!stagedCount ? '请先暂存要提交的文件' : '生成提交信息'}
          disabled={generateDisabled}
          onClick={() => void prepare()}
        >
          {phase ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
          生成提交信息
        </button>
      </div>
      <div className="commit-input-wrap">
        <textarea
          id="commit-message"
          value={draft}
          onChange={(event) => {
            edits.current++;
            currentDraft.current = event.target.value;
            onChange(event.target.value);
          }}
          disabled={inputDisabled}
          placeholder="输入提交说明，或点击生成"
          spellCheck={false}
        />
      </div>
      {phase && (
        <div className="draft-caption" role="status">
          <span>{phase === 'generating' ? '正在生成提交信息…' : '准备暂存内容…'}</span>
          {phase === 'generating' ? (
            <button
              className="text-button"
              onClick={() => {
                if (repositoryId)
                  void api
                    .cancelCommitMessage(repositoryId)
                    .catch((error: unknown) =>
                      setFeedback(error instanceof Error ? error.message : '取消失败，请重试。'),
                    );
              }}
            >
              <X size={12} />
              取消
            </button>
          ) : null}
        </div>
      )}
      <div className="commit-generation-feedback" role="status" aria-live="polite">
        {generatedRevision && generatedRevision !== indexRevision
          ? '暂存内容或分支已变化，草稿已保留，请更新提交信息。'
          : feedback}
        {needsSettings && (
          <button className="text-button" onClick={onSettings}>
            打开模型设置
          </button>
        )}
      </div>
      {preview && (
        <Modal title="生成提交信息" onClose={() => setPreview(null)}>
          <p className="dialog-subtitle">
            将以下已暂存差异发送给你的模型服务，生成可编辑的提交草稿。
          </p>
          <div className="review-destination">
            <strong>{preview.model}</strong>
            <span>{preview.baseUrl}</span>
            <small>
              {preview.branch} · {preview.included.length} 个文件 · 约{' '}
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
              <summary>{preview.skipped.length} 个文件不会发送，草稿仅覆盖已发送内容</summary>
              {preview.skipped.map((file) => (
                <p key={file.path}>
                  {file.path}
                  <small>{file.reason}</small>
                </p>
              ))}
            </details>
          )}
          <p className="dialog-note">
            {draft.trim() ? '生成成功后将替换当前草稿。' : '生成后可继续编辑。'}
            模型调用可能产生费用。
          </p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setPreview(null)}>
              返回
            </button>
            <button
              className="primary"
              disabled={!preview.included.length}
              onClick={() => void generate()}
            >
              <Sparkles size={14} />
              {draft.trim() ? '生成并替换草稿' : '生成草稿'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
