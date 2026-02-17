import React from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: { label: string; value: string | number }[];
  value?: string | number;
  onChange?: (value: string) => void;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', label, error, helperText, options, value, onChange, children, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (onChange) {
        onChange(e.target.value);
      }
      // Also call original onChange if provided in props
      if (props.onChange) {
        (props.onChange as (e: React.ChangeEvent<HTMLSelectElement>) => void)(e);
      }
    };

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-slate-400 mb-1.5">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            className={`
              w-full appearance-none rounded-lg bg-slate-950 border border-slate-800
              px-3 py-2 pr-10 text-sm text-slate-200
              focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-200
              ${error ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500' : ''}
              ${className}
            `}
            value={value}
            onChange={handleChange}
            {...props}
          >
             {options
               ? options.map((opt) => (
                   <option key={opt.value} value={opt.value}>
                     {opt.label}
                   </option>
                 ))
               : children}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
             <ChevronDown className="h-4 w-4" />
          </div>
        </div>
        {error ? (
          <p className="mt-1.5 text-xs text-red-400">{error}</p>
        ) : helperText ? (
          <p className="mt-1.5 text-xs text-slate-500">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Select;