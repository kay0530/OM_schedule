/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback, createContext, useContext, useMemo } from 'react';

const TYPE_STYLES = {
  success: {
    container: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30',
    icon: (
      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  error: {
    container: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
    icon: (
      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
  info: {
    container: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
    icon: (
      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  warning: {
    container: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30',
    icon: (
      <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
  },
};

/**
 * Toast notification hook.
 * @returns {{ toasts: Array, addToast: (message: string, type?: string, durationMs?: number) => string, removeToast: (id: string) => void }}
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    // durationMs 0 = sticky (manual dismiss) — use for errors the user must
    // act on (e.g. per-member Outlook failures)
    (message, type = 'info', durationMs = 3000) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const toast = { id, message, type };
      setToasts((prev) => [...prev, toast]);

      if (durationMs > 0) {
        setTimeout(() => {
          removeToast(id);
        }, durationMs);
      }

      return id;
    },
    [removeToast]
  );

  return { toasts, addToast, removeToast };
}

const ToastContext = createContext(null);

/**
 * App-level provider so any component can push toasts without prop drilling.
 * Renders the container itself (z-[100] — above the z-50 modal layer).
 */
export function ToastProvider({ children }) {
  const { toasts, addToast, removeToast } = useToast();
  // Context value deliberately EXCLUDES `toasts`: only ToastContainer (props)
  // needs the list. A value that changed with each show/dismiss would
  // re-render every consumer (incl. AppInner → the whole grid) twice per toast.
  const api = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToastContext() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToastContext must be used within a ToastProvider');
  return ctx;
}

/**
 * Single toast notification item.
 */
function ToastItem({ toast, onRemove }) {
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg ${style.container} animate-slide-in`}
    >
      <div className="shrink-0">{style.icon}</div>
      <p className="text-sm font-medium flex-1 whitespace-pre-line break-words">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Toast container rendering active toasts.
 * @param {{ toasts: Array, removeToast: (id: string) => void }}
 */
export function ToastContainer({ toasts, removeToast }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
