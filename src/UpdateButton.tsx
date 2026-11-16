import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from './api';
import { Modal } from './Modal';
import type { UpdateState } from './types';

export function UpdateButton({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void api
        .updateState()
        .then((value) => {
          if (active) setState(value);
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, open ? 1000 : 10_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open]);
  async function act(action: () => Promise<UpdateState>) {
    setError('');
    setPending(true);
    try {
      setState(await action());
    } catch {
      setError('更新操作失败，请稍后重试。');
    } finally {
      setPending(false);
    }
  }
  const running =
    pending ||
    state?.status === 'checking' ||
    state?.status === 'downloading' ||
    state?.status === 'installing';
  return (
    <>
      <button
        className="toolbar-button"
        title="软件更新"
        aria-label="软件更新"
        onClick={() => setOpen(true)}
      >
        <Download size={15} />
        <span className="toolbar-extra-label">
          {state?.status === 'available' || state?.status === 'downloaded' ? '有更新' : '更新'}
        </span>
      </button>
      {open && (
        <Modal
          title="软件更新"
          onClose={() => {
            setOpen(false);
            setConfirmRestart(false);
          }}
        >
          <p>当前版本：{state?.currentVersion || '开发预览'}</p>
          {state?.version && <p>最新版本：{state.version}</p>}
          <p role="status">{state?.message || '正在读取更新状态…'}</p>
          {state?.status === 'downloading' && (
            <progress
              aria-label="更新下载进度"
              value={state.percent}
              max={100}
              style={{ width: '100%' }}
            >
              {Math.round(state.percent)}%
            </progress>
          )}
          <p className="dialog-note">
            安装版支持下载后重启更新；免安装版请下载新版替换。更新不会修改你的 Git 仓库。
          </p>
          {error && <p role="alert">{error}</p>}
          {confirmRestart && (
            <p role="alert">即将关闭 CodeGuard 并安装更新。请先保存其他编辑器中的工作。</p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={pending}
              onClick={() => void act(api.openUpdateDownload)}
            >
              官网下载
            </button>
            {state?.status !== 'unsupported' && (
              <button
                className="secondary"
                disabled={running || state?.status === 'downloaded'}
                onClick={() => void act(api.checkForUpdates)}
              >
                检查更新
              </button>
            )}
            {state?.status === 'available' && (
              <button
                className="primary"
                disabled={pending}
                onClick={() => void act(api.downloadUpdate)}
              >
                {state.portable ? '下载新版' : '下载更新'}
              </button>
            )}
            {state?.status === 'downloaded' && (
              <button
                className="primary"
                disabled={disabled || pending}
                onClick={() => {
                  if (!confirmRestart) setConfirmRestart(true);
                  else void act(api.installUpdate);
                }}
              >
                {confirmRestart ? '确认重启安装' : '重启安装'}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
