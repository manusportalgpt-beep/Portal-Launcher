import { create } from 'zustand';

type DialogKind = 'confirm' | 'alert' | 'prompt';

interface DialogRequest {
  id: number;
  kind: DialogKind;
  title?: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (v: boolean | string) => void;
}

interface DialogStore {
  queue: DialogRequest[];
  push: (req: Omit<DialogRequest, 'id'>) => void;
  resolveTop: (v: boolean | string) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogStore>((set, get) => ({
  queue: [],
  push: (req) => set(s => ({ queue: [...s.queue, { ...req, id: nextId++ }] })),
  resolveTop: (v) => {
    const top = get().queue[0];
    if (top) top.resolve(v);
    set(s => ({ queue: s.queue.slice(1) }));
  },
}));

/** await dialog.confirm('Delete instance "X"?', { danger: true }) → boolean */
export const dialog = {
  confirm(message: string, opts: { title?: string; danger?: boolean; confirmLabel?: string; cancelLabel?: string } = {}) {
    return new Promise<boolean>(resolve => {
      useDialogStore.getState().push({ kind: 'confirm', message, resolve: value => resolve(value === true), ...opts });
    });
  },
  alert(message: string, opts: { title?: string; danger?: boolean } = {}) {
    return new Promise<void>(resolve => {
      useDialogStore.getState().push({ kind: 'alert', message, resolve: () => resolve(), ...opts });
    });
  },
  prompt(message: string, defaultValue = '', opts: { title?: string; danger?: boolean; confirmLabel?: string; cancelLabel?: string; placeholder?: string } = {}) {
    return new Promise<string | null>(resolve => {
      useDialogStore.getState().push({ kind: 'prompt', message, defaultValue, resolve: value => resolve(typeof value === 'string' ? value : null), ...opts });
    });
  },
};
