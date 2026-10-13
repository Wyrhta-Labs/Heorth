import * as React from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastVariant = 'default' | 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = React.createContext<ToastContextValue>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const toast = React.useCallback((message: string, variant: ToastVariant = 'default') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-[calc(22px+env(safe-area-inset-bottom,0px))] left-1/2 z-[60] flex w-[min(460px,calc(100%-32px))] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg bg-fg px-3.5 py-2.5 text-[13px] text-surface shadow-pop"
          >
            {t.variant === 'success' && <CheckCircle className="h-4 w-4 shrink-0 text-success-border" />}
            {t.variant === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-danger-border" />}
            {t.variant === 'info' && <Info className="h-4 w-4 shrink-0 text-primary-border" />}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-surface/70 hover:text-surface"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return React.useContext(ToastContext);
}
