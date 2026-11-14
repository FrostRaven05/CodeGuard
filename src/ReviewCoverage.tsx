import type { ReviewResult } from './types';

export function ReviewCoverage({ result }: { result: ReviewResult }) {
  const partial = result.partialFiles || [];
  const groups = new Map<string, Set<string>>();
  for (const [kind, items] of [
    ['差异未纳入', result.skipped],
    ['差异部分覆盖', partial],
    ['附近上下文', result.contextSkipped || []],
  ] as const)
    for (const item of items) {
      const reason =
        kind === '附近上下文' && /预算/.test(item.reason)
          ? '预算有限，已优先保留相关片段'
          : item.reason;
      const key = `${kind} · ${reason}`;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key)!.add(item.path);
    }
  if (!groups.size && !result.unverifiedCount && !result.visualsRejected) return null;
  const contextFiles = new Set(result.contextSkipped?.map((item) => item.path) || []).size;
  return (
    <details className="visual-coverage">
      <summary>
        分析覆盖 · {result.skipped.length} 个文件未纳入
        {partial.length > 0 && ` · ${partial.length} 个文件部分覆盖`}
        {contextFiles > 0 && ` · ${contextFiles} 个文件的附近片段受限`}
      </summary>
      <p className="field-help">
        差异覆盖与附近上下文分别记录；以下按原因合并，同一文件不会反复列出相同提示。
      </p>
      {[...groups].map(([reason, paths]) => (
        <details className="coverage-group" key={reason}>
          <summary>
            {reason} · {paths.size} 个文件
          </summary>
          <ul>
            {[...paths].map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
      ))}
      {!!result.unverifiedCount && <p>{result.unverifiedCount} 项发现未通过位置核对</p>}
      {!!result.visualsRejected && <p>{result.visualsRejected} 项图示未通过校验</p>}
    </details>
  );
}
