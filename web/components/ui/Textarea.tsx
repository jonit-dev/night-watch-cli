import React from 'react';

interface ITextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, ITextareaProps>(
  ({ label, helperText, error, className = '', ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = props.id ?? generatedId;
    const errorId = error ? `${textareaId}-error` : undefined;
    const helperTextId = !error && helperText ? `${textareaId}-help` : undefined;
    const describedBy = [errorId, helperTextId].filter(Boolean).join(' ') || undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-slate-400 mb-1.5">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : props['aria-invalid']}
          className={`
            w-full rounded-lg bg-slate-950 border border-slate-800
            px-3 py-2 text-sm text-slate-200
            placeholder:text-slate-600
            focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200 resize-y
            ${error ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500' : ''}
            ${className}
          `}
          {...props}
        />
        {error ? (
          <p id={errorId} className="mt-1.5 text-xs text-red-400">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperTextId} className="mt-1.5 text-xs text-slate-500">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export default Textarea;
