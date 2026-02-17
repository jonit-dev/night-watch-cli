import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  loading = false, 
  className = '', 
  disabled,
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-[#030712] disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]";
  
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500 focus:ring-indigo-500 shadow-[0_0_15px_-3px_rgba(79,70,229,0.4)] border border-indigo-500/50 hover:shadow-[0_0_20px_-3px_rgba(79,70,229,0.5)]",
    secondary: "bg-[#1f2937] text-slate-200 hover:bg-[#374151] focus:ring-slate-500 border border-white/5",
    danger: "bg-red-600/10 text-red-400 hover:bg-red-600/20 focus:ring-red-500 border border-red-900/50 hover:border-red-500/50",
    ghost: "bg-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200 focus:ring-slate-400",
    outline: "border border-slate-700/50 bg-transparent text-slate-300 hover:bg-white/5 hover:border-slate-500 focus:ring-slate-400",
  };

  const sizes = {
    sm: "h-8 px-3 text-xs tracking-wide",
    md: "h-10 px-4 py-2 text-sm",
    lg: "h-12 px-6 text-base",
    icon: "h-9 w-9",
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
};

export default Button;