import { createContext, useContext, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Code2,
  Copy,
  GitBranch,
  Layers,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';
import type { CodeLocation, Finding, ReviewResult, ReviewState } from './types';
import './review-workspace.css';
import { ReviewProcess } from './ReviewProcess';
import { InvestigationMap } from './InvestigationMap';
import { FlowDiagram } from './FlowDiagram';
import { ReviewCoverage } from './ReviewCoverage';

const SnapshotScope = createContext<'local' | 'staged'>('staged');
const categoryLabel = { correctness: '正确性', standards: '规范', requirements: '需求' };
export type ReviewView = {
  tab: 'changes' | 'flows' | 'risks';
  file: string;
  status?: 'all' | 'pending' | 'handled' | 'ignored';
};

function CodeLink({
  location,
  stale,
  onLocate,
}: {
  location: CodeLocation;
  stale: boolean;
  onLocate: (value: CodeLocation) => void;
}) {
  const scope = useContext(SnapshotScope);
  return (
    <button
      className="visual-code-link"
      disabled={stale}
      title={stale ? '旧版本位置，请重新评审后定位' : '查看对应版本的代码差异'}
      onClick={() => onLocate(location)}
    >
      <Code2 size={13} />
      <span>
        {location.path}:{location.line}
      </span>
      <small>
        {location.side === 'old' ? '父版本' : scope === 'local' ? '工作区快照' : '暂存版本'}
      </small>
    </button>
  );
}

function RiskCard({
  finding,
  result,
  stale,
  onLocate,
}: {
  finding: Finding;
  result: ReviewResult;
  stale: boolean;
  onLocate: (value: CodeLocation) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState('');
  async function copy() {
    const text = `${result.scope === 'local' ? '全部本地改动理解' : '本次提交评审'} · ${finding.evidenceStatus}\n快照 ${result.tree}\n${finding.priority} ${finding.title}\n位置：${finding.path}:${finding.line}（${finding.side === 'new' ? (result.scope === 'local' ? '工作区快照' : '暂存版本') : '父版本'}）\n触发：${finding.trigger}\n后果：${finding.consequence}\n证据：\n${finding.evidence}\n修复方向：${finding.suggestion}\n验证：未运行；请核对源码后修复。`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setManual('');
    } catch {
      setManual(text);
    }
  }
  return (
    <article className={`visual-risk priority-border-${finding.priority}`}>
      <div className="visual-risk-heading">
        <span className={`risk-priority ${finding.priority}`}>{finding.priority}</span>
        <h3>{finding.title}</h3>
        <span>{categoryLabel[finding.category]}</span>
      </div>
      {finding.recheckStatus && (
        <p className="finding-recheck">
          {finding.recheckStatus === 'not-covered'
            ? '本轮未覆盖此文件，无法复查'
            : finding.recheckStatus === 'found-again'
              ? '本轮再次发现，仍需判断'
              : '本轮未再发现可定位问题，不代表已验证修复'}
        </p>
      )}
      <CodeLink
        location={finding}
        stale={
          stale || finding.recheckStatus === 'not-found' || finding.recheckStatus === 'not-covered'
        }
        onLocate={onLocate}
      />
      <div className="risk-chain">
        <div>
          <small>触发条件</small>
          <p>{finding.trigger}</p>
        </div>
        <ArrowRight size={16} />
        <div>
          <small>产生影响</small>
          <p>{finding.consequence}</p>
        </div>
      </div>
      <div className="risk-suggestion">
        <small>修复建议</small>
        <p>{finding.suggestion}</p>
      </div>
      <details className="visual-evidence">
        <summary>查看代码证据</summary>
        <pre>{finding.evidence}</pre>
      </details>
      <footer>
        <span>{finding.evidenceStatus}</span>
        <button
          className="text-button"
          disabled={
            stale ||
            finding.recheckStatus === 'not-found' ||
            finding.recheckStatus === 'not-covered'
          }
          onClick={() => void copy()}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制给编码助手'}
        </button>
      </footer>
      {manual && (
        <label className="manual-copy">
          请手动复制
          <textarea readOnly value={manual} onFocus={(event) => event.target.select()} />
        </label>
      )}
    </article>
  );
}

export function ReviewWorkspace({
  review,
  onLocate,
  onFile,
  state,
  onViewChange,
}: {
  review: ReviewState | null;
  onLocate: (value: CodeLocation) => void;
  onFile: (path: string) => void;
  state: ReviewView;
  onViewChange: (value: ReviewView) => void;
}) {
  const result = review?.latest;
  const { tab, file } = state;
  const setTab = (tab: ReviewView['tab']) => onViewChange({ ...state, tab });
  const setFile = (file: string) => onViewChange({ ...state, file });
  const stale = !!result?.stale;
  const partial = !!(
    result?.partialFiles?.length ||
    result?.skipped.length ||
    result?.unverifiedCount ||
    result?.contextSkipped?.length ||
    result?.investigation?.stats.truncated ||
    result?.investigation?.stats.skipped
  );
  const changes = result?.visuals?.changes || [],
    flows = result?.visuals?.flows || [];
  const findings = result?.findings.filter((item) => !file || item.path === file) || [];
  const previousFindings =
    result?.previousFindings?.filter((item) => !file || item.path === file) || [];
  const preparing = review?.preparation ? (
    <section className="review-preparation" role="status">
      <LoaderCircle size={18} className="spin" />
      <span>{review.preparation.label}</span>
    </section>
  ) : null;
  if (!result)
    return (
      <section
        className={`review-workspace ${review?.progress || preparing ? '' : 'review-empty'}`}
      >
        {preparing ? (
          preparing
        ) : review?.progress ? (
          <>
            <ReviewProcess key={review.progress.runId} progress={review.progress} />
            {review.error && (
              <p className="review-error" role="alert">
                {review.error}
              </p>
            )}
          </>
        ) : (
          <>
            <Layers size={34} />
            <h2>{review?.running ? '正在分析所选改动' : '把本次改动放到一起看'}</h2>
            <p>
              {review?.running
                ? '完成后会在这里显示改动结构、行为变化、流程与风险。'
                : '点击右侧分析按钮：有暂存内容时评审本次提交，否则理解全部本地改动。'}
            </p>
            <small>检查未运行</small>
          </>
        )}
        {review?.error && !review.progress && (
          <p className="review-error" role="alert">
            {review.error}
          </p>
        )}
      </section>
    );
  const visibleChanges = changes.filter((change) => !file || change.location.path === file);
  const visibleFlows = flows.filter(
    (flow) => !file || flow.nodes.some((node) => node.location?.path === file),
  );
  return (
    <SnapshotScope.Provider value={result.scope || 'staged'}>
      <section className="review-workspace" aria-label="改动图解工作台" data-review-id={result.id}>
        {preparing ||
          (review?.progress && (
            <ReviewProcess key={review.progress.runId} progress={review.progress} />
          ))}
        <header className="visual-review-header">
          <div>
            <h1>
              <Sparkles size={22} />
              {result.scope === 'local' ? '全部本地改动图解' : '本次提交改动图解'}
            </h1>
          </div>
          <span className={`visual-review-status ${stale ? 'outdated' : ''}`}>
            {stale
              ? '基于旧版本'
              : review?.running
                ? '重新评审中 · 保留上次结果'
                : review?.error
                  ? '本次评审未完成 · 保留上次结果'
                  : partial
                    ? '评审完成 · 部分覆盖'
                    : '评审已完成'}
          </span>
        </header>
        <p className="visual-review-summary">{result.summary}</p>
        {review?.error && (
          <p className="review-error" role="alert">
            {review.error}
          </p>
        )}
        <div className="visual-review-facts">
          <span>{result.included.length} 个已覆盖文件</span>
          <span>{result.findings.length} 项问题与建议</span>
          <span>{result.hasRequirements ? '已核对填写的需求' : '未核对需求'}</span>
          <span>检查未运行</span>
        </div>
        {stale && (
          <p className="visual-review-warning">
            <AlertTriangle size={15} />
            所选改动或评审依据已变化，以下保留旧版本解释；请重新分析后定位代码。
          </p>
        )}
        <ReviewCoverage result={result} />
        <div className="visual-review-grid">
          <div className="visual-review-content">
            <nav className="visual-review-tabs" aria-label="审查内容">
              <button
                className={tab === 'changes' ? 'active' : ''}
                onClick={() => setTab('changes')}
              >
                改动图解<span>{visibleChanges.length}</span>
              </button>
              <button className={tab === 'flows' ? 'active' : ''} onClick={() => setTab('flows')}>
                影响流程<span>{visibleFlows.length}</span>
              </button>
              <button className={tab === 'risks' ? 'active' : ''} onClick={() => setTab('risks')}>
                问题与建议<span>{findings.length}</span>
              </button>
            </nav>
            <div className="explanation-file-filter">
              <label>
                查看范围{' '}
                <select
                  aria-label="图解文件筛选"
                  value={file}
                  onChange={(event) => setFile(event.target.value)}
                >
                  <option value="">全部已覆盖文件</option>
                  {result.included.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
              {file && (
                <button className="text-button" disabled={stale} onClick={() => onFile(file)}>
                  查看文件差异
                </button>
              )}
            </div>
            {file && (
              <div className="visual-filter">
                {file}
                <button className="text-button" onClick={() => setFile('')}>
                  清除筛选
                </button>
              </div>
            )}
            {tab === 'changes' && (
              <div className="visual-change-list">
                <nav className="explanation-steps" aria-label="改动分析步骤">
                  {['感知上下文', '提出假设', '搜索核对', '结论与建议'].map((label, index) => (
                    <span key={label}>
                      <b>{index + 1}</b>
                      {label}
                      {index < 3 && <ArrowRight size={14} />}
                    </span>
                  ))}
                </nav>
                {visibleChanges.length ? (
                  visibleChanges.map((change, index) => (
                    <article className="visual-change-card" key={index}>
                      <h3>{change.title}</h3>
                      <div className="before-after">
                        <div>
                          <small>改动前</small>
                          <p>{change.before}</p>
                        </div>
                        <ArrowRight size={18} />
                        <div>
                          <small>改动后</small>
                          <p>{change.after}</p>
                        </div>
                      </div>
                      <CodeLink location={change.location} stale={stale} onLocate={onLocate} />
                      <span className="visual-inference">AI 行为解释 · 代码摘录已核对</span>
                    </article>
                  ))
                ) : (
                  <div className="visual-empty-section">
                    <Layers size={24} />
                    <h3>此范围没有行为对比图示</h3>
                    <p>
                      {result.visuals
                        ? '模型未提供可用图示，可在风险发现中核对具体问题。'
                        : '这是一份较早的评审记录，重新评审可生成行为对比与流程。'}
                    </p>
                    <button className="secondary" onClick={() => setTab('risks')}>
                      查看 {findings.length} 项风险发现
                      <ArrowRight size={14} />
                    </button>
                  </div>
                )}
                <InvestigationMap result={result} file={file} stale={stale} onLocate={onLocate} />
                <details className="explanation-contexts">
                  <summary>附近上下文 · {result.contexts?.length || 0} 个片段</summary>
                  {result.contexts?.map((context, index) => (
                    <p key={index}>
                      {context.path}:{context.startLine}–{context.endLine} ·{' '}
                      {context.side === 'old' ? '父版本' : '当前快照'} · {context.kind}
                    </p>
                  ))}
                  <p>{result.contextLimitation || '此记录没有保存附近上下文信息。'}</p>
                </details>
              </div>
            )}
            {tab === 'flows' && (
              <>
                <p className="visual-inference flow-disclaimer">
                  AI 解释性流程 · 不是已验证的调用图。点击节点查看依据，可横向滚动和缩放。
                </p>
                {visibleFlows.length ? (
                  visibleFlows.map((flow, index) => (
                    <FlowDiagram
                      key={`${result.id}:${index}`}
                      flow={flow}
                      renderLocation={(location) => (
                        <CodeLink location={location} stale={stale} onLocate={onLocate} />
                      )}
                    />
                  ))
                ) : (
                  <div className="visual-empty-section">
                    <GitBranch size={24} />
                    <h3>此范围没有可用流程图</h3>
                    <p>证据不足或模型未返回流程时，不补画推测的代码关系。</p>
                  </div>
                )}
              </>
            )}
            {tab === 'risks' && (
              <div className="visual-risk-list">
                {findings.length ? (
                  findings.map((finding) => (
                    <RiskCard
                      key={finding.id}
                      finding={finding}
                      result={result}
                      stale={stale}
                      onLocate={onLocate}
                    />
                  ))
                ) : (
                  <div className="visual-empty-section">
                    <Check size={24} />
                    <h3>{file ? '此文件没有可定位的发现' : '已覆盖范围未发现可定位的问题'}</h3>
                    <p>这不代表代码已验证通过；请结合覆盖范围、需求和检查结果判断。</p>
                  </div>
                )}
                {previousFindings.length > 0 && (
                  <section className="previous-findings">
                    <h3>此前发现的复查记录 · {previousFindings.length}</h3>
                    <p className="field-help">
                      本轮未再发现与未覆盖分别记录；均不代表已验证修复。以下代码位置属于此前快照。
                    </p>
                    {previousFindings.map((finding) => (
                      <RiskCard
                        key={finding.id}
                        finding={finding}
                        result={result}
                        stale
                        onLocate={onLocate}
                      />
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
        <footer className="visual-review-footer">
          {result.model} · {new Date(result.createdAt).toLocaleString('zh-CN')} · 快照{' '}
          {result.tree.slice(0, 8)} ·{' '}
          {result.totalTokens === null ? '用量未知' : `${result.totalTokens} tokens`} · 费用未知
        </footer>
      </section>
    </SnapshotScope.Provider>
  );
}
