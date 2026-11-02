import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Code2,
  Copy,
  FileCode2,
  Folder,
  GitBranch,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { CodeLocation, Finding, ReviewFlow, ReviewResult, ReviewState } from './types';
import './review-workspace.css';
import { ReviewProcess } from './ReviewProcess';
import { useFindingDraft, useFindingRevision, findingDisposition } from './findingDrafts';

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

function FlowDiagram({
  flow,
  stale,
  onLocate,
}: {
  flow: ReviewFlow;
  stale: boolean;
  onLocate: (value: CodeLocation) => void;
}) {
  const marker = useId().replaceAll(':', '');
  const [selected, setSelected] = useState(flow.nodes[0].id);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => {
    const indegree = new Map(flow.nodes.map((node) => [node.id, 0]));
    flow.edges.forEach((edge) => indegree.set(edge.to, indegree.get(edge.to)! + 1));
    const queue = flow.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const ranks = new Map(flow.nodes.map((node) => [node.id, 0]));
    let visited = 0;
    while (queue.length) {
      const id = queue.shift()!;
      visited++;
      flow.edges
        .filter((edge) => edge.from === id)
        .forEach((edge) => {
          ranks.set(edge.to, Math.max(ranks.get(edge.to)!, ranks.get(id)! + 1));
          indegree.set(edge.to, indegree.get(edge.to)! - 1);
          if (!indegree.get(edge.to)) queue.push(edge.to);
        });
    }
    if (visited !== flow.nodes.length)
      flow.nodes.forEach((node, index) => ranks.set(node.id, index));
    const rows = new Map<number, number>();
    const positions = new Map(
      flow.nodes.map((node) => {
        const rank = ranks.get(node.id)!;
        const row = rows.get(rank) || 0;
        rows.set(rank, row + 1);
        return [node.id, { x: 24 + rank * 246, y: 36 + row * 128 }];
      }),
    );
    return {
      positions,
      width: (Math.max(...ranks.values()) + 1) * 246 + 12,
      height: Math.max(...rows.values()) * 128 + 20,
    };
  }, [flow]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () =>
      setFit(Math.min(1, Math.max(0.75, (element.clientWidth - 12) / layout.width)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout.width]);
  const scale = fit * zoom;
  const node = flow.nodes.find((item) => item.id === selected) || flow.nodes[0];
  return (
    <section className="visual-flow-card">
      <div className="visual-section-heading">
        <h3>
          <GitBranch size={16} />
          {flow.title}
        </h3>
        <div className="flow-zoom">
          <button
            aria-label="缩小流程图"
            disabled={zoom <= 0.7}
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))}
          >
            −
          </button>
          <button aria-label="重置流程图缩放" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="放大流程图"
            disabled={zoom >= 1.45}
            onClick={() => setZoom((value) => Math.min(1.45, value + 0.15))}
          >
            ＋
          </button>
        </div>
      </div>
      <div
        ref={viewport}
        className="flow-viewport"
        role="region"
        aria-label={flow.title}
        tabIndex={0}
      >
        <div style={{ width: layout.width * scale, height: layout.height * scale }}>
          <div
            className="flow-canvas"
            style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}
          >
            <svg width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker
                  id={marker}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0 0L10 5L0 10Z" fill="#65778e" />
                </marker>
              </defs>
              {flow.edges.map((edge, index) => {
                const from = layout.positions.get(edge.from)!,
                  to = layout.positions.get(edge.to)!;
                const x = from.x + 190,
                  y = from.y + 39,
                  tx = to.x - 3,
                  ty = to.y + 39;
                const bend = tx > x ? (tx - x) / 2 : 50;
                return (
                  <g key={index}>
                    <path
                      className={selected === edge.from || selected === edge.to ? 'active' : ''}
                      d={`M${x} ${y}C${x + bend} ${y},${tx - bend} ${ty},${tx} ${ty}`}
                      markerEnd={`url(#${marker})`}
                    />
                    <text x={(x + tx) / 2} y={(y + ty) / 2 - 9} textAnchor="middle">
                      {edge.label.length > 18 ? `${edge.label.slice(0, 18)}…` : edge.label}
                    </text>
                  </g>
                );
              })}
            </svg>
            {flow.nodes.map((item) => {
              const position = layout.positions.get(item.id)!;
              return (
                <button
                  key={item.id}
                  className={`flow-node ${item.kind} ${node.id === item.id ? 'selected' : ''}`}
                  style={{ left: position.x, top: position.y }}
                  aria-pressed={node.id === item.id}
                  title={item.label}
                  onClick={() => setSelected(item.id)}
                >
                  <span>{item.label}</span>
                  <small>{item.location ? '查看代码依据' : '解释节点'}</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flow-node-detail">
        <strong>{node.label}</strong>
        {node.location ? (
          <>
            <CodeLink location={node.location} stale={stale} onLocate={onLocate} />
            <pre>{node.location.evidence}</pre>
          </>
        ) : (
          <p>此节点用于解释行为，未关联独立代码位置。</p>
        )}
      </div>
    </section>
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
  const disposition = useFindingDraft(result.repositoryId, {
    scope: result.scope || 'staged',
    reviewId: result.id,
    findingId: finding.id,
    status: finding.disposition?.status || 'pending',
    note: finding.disposition?.note || '',
  });
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
      <details className="visual-evidence">
        <summary>代码证据与修复方向</summary>
        <pre>{finding.evidence}</pre>
        <p>{finding.suggestion}</p>
      </details>
      <div className="finding-disposition">
        <label>
          人工处置
          <select
            aria-label={`处置 ${finding.title}`}
            value={disposition.value.status}
            onChange={(event) =>
              disposition.save({
                ...disposition.value,
                status: event.target.value as typeof disposition.value.status,
              })
            }
          >
            <option value="pending">待处理</option>
            <option value="handled">已处理</option>
            <option value="ignored">忽略</option>
          </select>
        </label>
        <label>
          处理备注
          <textarea
            aria-label={`备注 ${finding.title}`}
            value={disposition.value.note}
            maxLength={3000}
            placeholder="记录判断、修复交接或忽略原因"
            onChange={(event) =>
              disposition.save({ ...disposition.value, note: event.target.value })
            }
          />
        </label>
        <p className={disposition.error ? 'review-error' : 'field-help'} role="status">
          {disposition.error
            ? `保存失败：${disposition.error}`
            : disposition.saving
              ? '保存中…'
              : '处置自动保存；人工已处理不等于验证修复'}
          {disposition.error && (
            <button className="text-button" onClick={() => disposition.save(disposition.value)}>
              重试保存
            </button>
          )}
        </p>
      </div>
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
  useFindingRevision();
  const result = review?.latest;
  const dispositionOf = (item: Finding) =>
    result
      ? findingDisposition(result.repositoryId, result.id, result.scope || 'staged', item.id) ||
        item.disposition
      : item.disposition;
  const { tab, file } = state;
  const setTab = (tab: ReviewView['tab']) => onViewChange({ ...state, tab });
  const setFile = (file: string) => onViewChange({ ...state, file });
  const stale = !!result?.stale;
  const partial = !!(
    result?.skipped.length ||
    result?.unverifiedCount ||
    result?.contextSkipped?.length
  );
  const changes = result?.visuals?.changes || [],
    flows = result?.visuals?.flows || [];
  const findings =
    result?.findings.filter(
      (item) =>
        (!file || item.path === file) &&
        (!state.status ||
          state.status === 'all' ||
          (dispositionOf(item)?.status || 'pending') === state.status),
    ) || [];
  const previousFindings =
    result?.previousFindings?.filter(
      (item) =>
        (!file || item.path === file) &&
        (!state.status ||
          state.status === 'all' ||
          (dispositionOf(item)?.status || 'pending') === state.status),
    ) || [];
  const grouped = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const path of result?.included || []) {
      const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '仓库根目录';
      groups.set(directory, [...(groups.get(directory) || []), path]);
    }
    return [...groups];
  }, [result]);
  if (!result)
    return (
      <section className={`review-workspace ${review?.progress ? '' : 'review-empty'}`}>
        {review?.progress ? (
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
                : '点击右侧“理解全部本地改动”，或暂存文件后“评审本次提交”。'}
            </p>
            <small>
              {review?.scope === 'local' ? '全部本地改动，不代表本次提交已评审' : '只分析本次提交'}{' '}
              · 检查未运行
            </small>
          </>
        )}
      </section>
    );
  const visibleChanges = changes.filter((change) => !file || change.location.path === file);
  const visibleFlows = flows.filter(
    (flow) => !file || flow.nodes.some((node) => node.location?.path === file),
  );
  return (
    <SnapshotScope.Provider value={result.scope || 'staged'}>
      <section className="review-workspace" aria-label="可视化审查工作台">
        {review?.progress && (
          <ReviewProcess key={review.progress.runId} progress={review.progress} />
        )}
        <header className="visual-review-header">
          <div>
            <h1>
              <Sparkles size={22} />
              {result.scope === 'local' ? '全部本地改动理解' : '本次提交审查'}
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
          <span>
            {
              result.findings.filter(
                (item) => (dispositionOf(item)?.status || 'pending') === 'pending',
              ).length
            }{' '}
            项待处理
          </span>
          <span>
            {result.findings.filter((item) => dispositionOf(item)?.status === 'handled').length}{' '}
            项已处理 ·{' '}
            {result.findings.filter((item) => dispositionOf(item)?.status === 'ignored').length}{' '}
            项忽略
          </span>
          <span>{result.hasRequirements ? '已核对填写的需求' : '未核对需求'}</span>
          <span>检查未运行</span>
        </div>
        {stale && (
          <p className="visual-review-warning">
            <AlertTriangle size={15} />
            所选改动或评审依据已变化，以下保留旧版本解释；请重新分析后定位代码。
          </p>
        )}
        {(partial || !!result.visualsRejected) && (
          <details className="visual-coverage">
            <summary>
              覆盖与限制 · {result.skipped.length} 个文件未评审 · {result.unverifiedCount}{' '}
              项发现未通过位置核对
              {!!result.contextSkipped?.length &&
                ` · ${result.contextSkipped.length} 项上下文未纳入`}
              {result.visualsRejected ? ` · ${result.visualsRejected} 项图示未通过校验` : ''}
            </summary>
            {result.skipped.map((item) => (
              <p key={item.path}>
                {item.path}：{item.reason}
              </p>
            ))}
            {result.contextSkipped?.map((item, index) => (
              <p key={`context:${index}`}>
                {item.path}：{item.reason}
              </p>
            ))}
          </details>
        )}
        <div className="visual-review-grid">
          <aside className="visual-file-tree">
            <h2>
              <Layers size={14} />
              改动结构
            </h2>
            <button className={!file ? 'selected' : ''} onClick={() => setFile('')}>
              全部已覆盖文件<span>{result.included.length}</span>
            </button>
            {grouped.map(([directory, paths]) => (
              <div key={directory} className="visual-file-group">
                <h3>
                  <Folder size={13} />
                  {directory}
                </h3>
                {paths.map((path) => (
                  <div key={path} className="visual-file-item">
                    <button
                      className={file === path ? 'selected' : ''}
                      title={path}
                      onClick={() => setFile(path)}
                    >
                      <FileCode2 size={13} />
                      <span>{path.split('/').pop()}</span>
                      <small>
                        {result.findings.filter((finding) => finding.path === path).length}
                      </small>
                    </button>
                    <button
                      className="visual-file-diff"
                      title={`查看 ${path} 差异`}
                      aria-label={`查看 ${path} 差异`}
                      disabled={stale}
                      onClick={() => onFile(path)}
                    >
                      <Code2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </aside>
          <div className="visual-review-content">
            <nav className="visual-review-tabs" aria-label="审查内容">
              <button
                className={tab === 'changes' ? 'active' : ''}
                onClick={() => setTab('changes')}
              >
                行为变化<span>{visibleChanges.length}</span>
              </button>
              <button className={tab === 'flows' ? 'active' : ''} onClick={() => setTab('flows')}>
                行为流程<span>{visibleFlows.length}</span>
              </button>
              <button className={tab === 'risks' ? 'active' : ''} onClick={() => setTab('risks')}>
                风险发现<span>{findings.length}</span>
              </button>
            </nav>
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
                      stale={stale}
                      onLocate={onLocate}
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
                <label className="finding-filter">
                  处置筛选
                  <select
                    aria-label="处置筛选"
                    value={state.status || 'all'}
                    onChange={(event) =>
                      onViewChange({ ...state, status: event.target.value as ReviewView['status'] })
                    }
                  >
                    <option value="all">全部状态</option>
                    <option value="pending">待处理</option>
                    <option value="handled">已处理</option>
                    <option value="ignored">忽略</option>
                  </select>
                </label>
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
                    <h3>
                      {state.status && state.status !== 'all'
                        ? '没有符合当前处置筛选的问题'
                        : file
                          ? '此文件没有可定位的发现'
                          : '已覆盖范围未发现可定位的问题'}
                    </h3>
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
