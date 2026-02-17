import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'neutral' | 'info';
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className = '' }) => {
  const variants = {
    default: "bg-indigo-500/10 text-indigo-400 ring-1 ring-inset ring-indigo-500/20",
    success: "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/20",
    error: "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20",
    neutral: "bg-slate-500/10 text-slate-400 ring-1 ring-inset ring-slate-500/20",
    info: "bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20",
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

export default Badge;