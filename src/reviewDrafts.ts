import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { ReviewOptions } from './types';
type Draft = { options: ReviewOptions; initialized: boolean; saving: boolean; error: string };
const empty: Draft = {
  options: { standards: '', requirements: '' },
  initialized: false,
  saving: false,
  error: '',
};
const drafts = new Map<string, Draft>();
const queues = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const listeners = new Set<() => void>();
function publish(id: string, value: Draft) {
  drafts.set(id, value);
  listeners.forEach((listener) => listener());
}
export function initializeReviewDraft(id: string, options: ReviewOptions) {
  if (!drafts.get(id)?.initialized)
    publish(id, { options, initialized: true, saving: false, error: '' });
}
export function saveReviewDraft(id: string, options: ReviewOptions) {
  const version = (versions.get(id) || 0) + 1;
  versions.set(id, version);
  publish(id, { options, initialized: true, saving: true, error: '' });
  const queue = (queues.get(id) || Promise.resolve())
    .catch(() => {})
    .then(() => api.saveReviewOptions(id, options));
  queues.set(id, queue);
  void queue.then(
    () => {
      if (versions.get(id) === version)
        publish(id, { options, initialized: true, saving: false, error: '' });
    },
    (error) => {
      if (versions.get(id) === version)
        publish(id, {
          options,
          initialized: true,
          saving: false,
          error: error instanceof Error ? error.message : '保存失败',
        });
    },
  );
}
export async function flushReviewDraft(id: string) {
  await queues.get(id);
  const draft = drafts.get(id);
  if (draft?.error) throw new Error(draft.error);
}
export function useReviewDraft(id: string) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => drafts.get(id) || empty,
  );
}
