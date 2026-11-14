import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { api, ApiError } from './api';

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
  const [phase, setPhase] = useState<'preparing' | 'generating' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [generatedRevision, setGeneratedRevision] = useState<string | null>(null);
  const mounted = useRef(true);
  const activeTask = useRef<{ cancelled: boolean } | null>(null);
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
      if (activeTask.current) activeTask.current.cancelled = true;
      if (repositoryId) void api.cancelCommitMessage(repositoryId).catch(() => {});
    };
  }, [repositoryId]);

  async function generate() {
    if (!repositoryId || generateDisabled || activeTask.current) return;
    const task = { cancelled: false };
    activeTask.current = task;
    const editVersion = edits.current;
    setPhase('preparing');
    setFeedback('');
    setNeedsSettings(false);
    try {
      const prepared = await api.prepareCommitMessage(repositoryId);
      if (!mounted.current || task.cancelled) return;
      if (edits.current !== editVersion) {
        setFeedback('生成期间草稿已编辑，已保留你的内容。需要时可重新生成。');
        return;
      }
      setPhase('generating');
      const result = await api.generateCommitMessage(repositoryId, prepared.token);
      if (!mounted.current || task.cancelled) return;
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
      if (mounted.current && !task.cancelled) {
        setFeedback(error instanceof Error ? error.message : '生成失败，原草稿已保留。');
        setNeedsSettings(error instanceof ApiError && error.code === 'MODEL_NOT_CONFIGURED');
      }
    } finally {
      if (activeTask.current === task) activeTask.current = null;
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
          title={
            !stagedCount
              ? '请先暂存要提交的文件'
              : '根据暂存内容直接生成规范提交信息，成功后替换当前草稿'
          }
          disabled={generateDisabled}
          onClick={() => void generate()}
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
          {phase ? (
            <button
              className="text-button"
              onClick={() => {
                if (activeTask.current) activeTask.current.cancelled = true;
                setFeedback('生成已取消，原草稿已保留；已发生的调用可能仍计费。');
                if (repositoryId && phase === 'generating')
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
    </div>
  );
}
