import { useMemo, useEffect, useRef } from 'react';
import { AlertTriangle, FileDiff, LoaderCircle } from 'lucide-react';
import type { DiffResult, CodeLocation } from './types';

function parseLines(text: string) {
  let oldLine = 0,
    newLine = 0;
  return text.split('\n').map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text, type: 'hunk', old: '', next: '', sign: '' };
    }
    if (
      text.startsWith('+++') ||
      text.startsWith('---') ||
      /^(diff |index |new file |deleted file |similarity |rename |copy |old mode |new mode )/.test(
        text,
      )
    )
      return { text, type: 'metadata', old: '', next: '', sign: '' };
    if (text.startsWith('+'))
      return { text: text.slice(1), type: 'added', old: '', next: String(newLine++), sign: '+' };
    if (text.startsWith('-'))
      return { text: text.slice(1), type: 'removed', old: String(oldLine++), next: '', sign: '−' };
    if (text.startsWith(' '))
      return {
        text: text.slice(1),
        type: 'context',
        old: String(oldLine++),
        next: String(newLine++),
        sign: '',
      };
    return { text, type: 'metadata', old: '', next: '', sign: '' };
  });
}

export function DiffView({
  diff,
  loading,
  focus,
}: {
  diff: DiffResult | null;
  loading: boolean;
  focus?: CodeLocation | null;
}) {
  const lines = useMemo(() => parseLines(diff?.text || ''), [diff?.text]);
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!loading) target.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, loading, diff]);
  if (loading)
    return (
      <div className="center-message">
        <LoaderCircle className="spin" size={22} />
        <p>读取所选版本的差异…</p>
      </div>
    );
  if (!diff)
    return (
      <div className="center-message">
        <FileDiff size={28} />
        <p>选择文件，查看对应版本的差异</p>
      </div>
    );
  if (diff.binary || !diff.text)
    return (
      <div className="center-message">
        <FileDiff size={30} />
        <h3>{diff.binary ? '二进制文件' : '没有可显示的文本差异'}</h3>
        <p>{diff.notice || '可继续进行暂存操作，文件内容不会以文本形式展示。'}</p>
      </div>
    );
  return (
    <div className="diff-content">
      {(diff.notice || diff.truncated || lines.length > 5000) && (
        <div className="inline-warning">
          <AlertTriangle size={14} />
          {diff.notice || '差异较长，仅显示前 5000 行。'}
        </div>
      )}
      <div className="diff-scroll" tabIndex={0} aria-label="源码差异">
        <div className="diff-lines">
          {lines.slice(0, 5000).map((line, index) => (
            <div
              key={index}
              ref={
                focus && String(focus.line) === (focus.side === 'new' ? line.next : line.old)
                  ? target
                  : undefined
              }
              className={`diff-line ${line.type} ${focus && String(focus.line) === (focus.side === 'new' ? line.next : line.old) ? 'finding-highlight' : ''}`}
            >
              <span className="line-number">{line.old}</span>
              <span className="line-number">{line.next}</span>
              <span className="line-sign">{line.sign}</span>
              <code>{line.text || ' '}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
