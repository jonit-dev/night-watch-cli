import React from 'react';
import { useStore, ToastMessage } from '../../store/useStore';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  const icons = {
    success: <CheckCircle className="h-5 w-5 text-green-400" />,
    error: <AlertCircle className="h-5 w-5 text-red-400" />,
    info: <Info className="h-5 w-5 text-blue-400" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-400" />,
  };

  const borders = {
    success: 'border-l-green-500',
    error: 'border-l-red-500',
    info: 'border-l-blue-500',
    warning: 'border-l-amber-500',
  };

  return (
    <div className={`
      pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg 
      bg-slate-900 border border-slate-800 border-l-4 ${borders[toast.type]}
      shadow-lg ring-1 ring-black ring-opacity-5 transition-all
      animate-in slide-in-from-right-full fade-in duration-300
    `}>
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            {icons[toast.type]}
          </div>
          <div className="ml-3 w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-slate-200">{toast.title}</p>
            {toast.message && (
              <p className="mt-1 text-sm text-slate-400">{toast.message}</p>
            )}
          </div>
          <div className="ml-4 flex flex-shrink-0">
            <button
              type="button"
              className="inline-flex rounded-md text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onClick={() => onDismiss(toast.id)}
            >
              <span className="sr-only">Close</span>
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useStore();

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-0 flex flex-col items-end px-4 py-6 sm:items-end sm:p-6 z-[100] gap-4"
    >
       {toasts.map((toast) => (
         <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
       ))}
    </div>
  );
};