import { Search } from 'lucide-react';
import type { CodeLocation, ReviewResult } from './types';

const verdictLabel = {
  supported: '静态证据支持',
  refuted: '找到反证',
  uncertain: '证据不足 · 待确认',
};

export function InvestigationMap({
  result,
  file,
  stale,
  onLocate,
}: {
  result: ReviewResult;
  file: string;
  stale: boolean;
  onLocate: (location: CodeLocation) => void;
}) {
  const investigation = result.investigation;
  if (!investigation)
    return (
      <div className="investigation-empty" role="status">
        此结果未包含假设与搜索核对记录。重新分析后可查看证据链；当前不代表已完成全局搜索。
      </div>
    );
  const items = investigation.items.filter(
    (item) =>
      !file || item.location.path === file || item.matches.some((match) => match.path === file),
  );
  return (
    <section className="investigation-map" aria-label="假设与证据核对">
      <header>
        <h2>
          <Search size={16} />
          假设与证据核对
        </h2>
        <small>AI 解释 · 静态核对</small>
      </header>
      <p className="investigation-scope">
        跨目录搜索了 {investigation.stats.scanned} / {investigation.stats.candidates} 个版本文件
        {investigation.stats.skipped > 0 && ` · ${investigation.stats.skipped} 个未读取`}
        {investigation.stats.truncated && ' · 达到扫描或片段预算，结果不完整'}
      </p>
      {items.length === 0 && <p className="field-help">此筛选没有关联的假设。</p>}
      {items.map((item, index) => (
        <article className={`investigation-card ${item.verdict}`} key={item.id}>
          <header className="investigation-card-heading">
            <h3>
              {index + 1}. {item.title}
            </h3>
            <span>{verdictLabel[item.verdict]}</span>
          </header>
          <div className="investigation-conclusion">
            <p>{item.conclusion}</p>
            <strong>建议</strong>
            <p>{item.suggestion}</p>
          </div>
          <details className="investigation-proof">
            <summary>查看核对过程与 {item.matches.length} 处证据</summary>
            <div className="investigation-origin">
              <button
                className="visual-code-link"
                disabled={stale}
                onClick={() => onLocate(item.location)}
              >
                {item.location.path}:{item.location.line} ·{' '}
                {item.location.side === 'old' ? '父版本' : '当前快照'}
              </button>
              <pre>{item.location.evidence}</pre>
            </div>
            <div className="investigation-hypothesis">
              <small>待核实假设</small>
              <p>{item.hypothesis}</p>
            </div>
            <div className="investigation-search">
              <small>实际搜索证据</small>
              <div className="search-queries">
                {item.queries.map((query) => (
                  <code key={query}>{query}</code>
                ))}
              </div>
              {item.matches.length ? (
                item.matches.map((match, i) => (
                  <details key={i} className="search-match">
                    <summary>
                      {match.path}:{match.line} · {match.side === 'old' ? '父版本' : '当前快照'}
                      {item.evidence.some(
                        (evidence) =>
                          evidence.path === match.path &&
                          evidence.side === match.side &&
                          evidence.line === match.line,
                      )
                        ? ' · 结论引用'
                        : ''}
                    </summary>
                    <pre>
                      {match.text.split('\n').map((line, offset) => (
                        <span
                          className={match.startLine + offset === match.line ? 'matched-line' : ''}
                          key={offset}
                        >
                          <em>{match.startLine + offset}</em>
                          {line}
                          {'\n'}
                        </span>
                      ))}
                    </pre>
                  </details>
                ))
              ) : (
                <p>已扫描范围未命中。受语言、排除和预算限制，不能据此否定假设。</p>
              )}
            </div>
          </details>
        </article>
      ))}
      <details className="explanation-contexts">
        <summary>搜索范围与限制</summary>
        <p>{investigation.limitation}</p>
      </details>
    </section>
  );
}
