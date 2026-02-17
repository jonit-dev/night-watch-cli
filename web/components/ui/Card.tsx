import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => {
  return (
    <div 
      className={`
        relative bg-[#0b101b] rounded-xl border border-white/5 
        shadow-[0_4px_20px_-4px_rgba(0,0,0,0.5)] 
        transition-all duration-300
        ${onClick ? 'cursor-pointer hover:border-indigo-500/30 hover:shadow-indigo-500/5 group' : ''} 
        ${className}
      `}
      onClick={onClick}
    >
      {/* Optional gentle inner glow on hover for interactive cards */}
      {onClick && <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/[0.02] transition-colors rounded-xl pointer-events-none" />}
      
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
};

export default Card;