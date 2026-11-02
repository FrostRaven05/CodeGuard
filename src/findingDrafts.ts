import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { DispositionRequest, FindingDisposition } from './types';
type Draft = { value: FindingDisposition; saving: boolean; error: string };
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const listeners = new Set<() => void>();
let revision = 0;
export function useFindingRevision() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => revision,
  );
}
export function findingDisposition(id: string, reviewId: string, scope: string, findingId: string) {
  return drafts.get(`${id}:${scope}:${reviewId}:${findingId}`)?.value;
}
function publish(key: string, value: Draft) {
  drafts.set(key, value);
  revision++;
  listeners.forEach((listener) => listener());
}
export function useFindingDraft(id: string, request: DispositionRequest) {
  const key = `${id}:${request.scope}:${request.reviewId}:${request.findingId}`;
  if (!drafts.has(key))
    drafts.set(key, {
      value: { status: request.status, note: request.note },
      saving: false,
      error: '',
    });
  const draft = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => drafts.get(key)!,
  );
  function save(value: FindingDisposition) {
    const version = (versions.get(key) || 0) + 1;
    versions.set(key, version);
    publish(key, { value, saving: true, error: '' });
    const queue = (queues.get(key) || Promise.resolve())
      .catch(() => {})
      .then(() => api.saveFindingDisposition(id, { ...request, ...value }));
    queues.set(key, queue);
    void queue.then(
      (saved) => {
        if (versions.get(key) === version) publish(key, { value: saved, saving: false, error: '' });
      },
      (error) => {
        if (versions.get(key) === version)
          publish(key, {
            value,
            saving: false,
            error: error instanceof Error ? error.message : '保存失败',
          });
      },
    );
  }
  return { ...draft, save };
}

export async function flushFindingDrafts(id: string, scope: string) {
  const prefix = `${id}:${scope}:`;
  await Promise.all(
    [...queues].filter(([key]) => key.startsWith(prefix)).map(([, queue]) => queue),
  );
  const failed = [...drafts].find(([key, draft]) => key.startsWith(prefix) && draft.error);
  if (failed) throw new Error(failed[1].error);
}
