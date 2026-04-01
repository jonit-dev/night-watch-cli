import React from 'react';
import { ChevronDown, LucideIcon } from 'lucide-react';
import Switch from '../ui/Switch';
import Badge from '../ui/Badge';

interface JobAccordionProps {
  title: string;
  icon: LucideIcon;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  expanded: boolean;
  onExpandChange: (expanded: boolean) => void;
  scheduleSummary?: string;
  providerLabel?: string;
  children: React.ReactNode;
  id?: string;
}

const JobAccordion: React.FC<JobAccordionProps> = ({
  title,
  icon: Icon,
  description,
  enabled,
  onToggle,
  expanded,
  onExpandChange,
  scheduleSummary,
  providerLabel,
  children,
  id,
}) => {
  return (
    <div
      id={id}
      className={`border border-slate-800 rounded-xl overflow-hidden transition-all duration-200 ${
        expanded ? 'bg-slate-900/50 ring-1 ring-indigo-500/20' : 'bg-slate-900/20 hover:bg-slate-900/40'
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => onExpandChange(!expanded)}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className={`p-2 rounded-lg ${expanded ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="overflow-hidden">
            <h3 className="text-sm font-medium text-slate-200 truncate">{title}</h3>
            {!expanded && (
               <p className="text-xs text-slate-500 truncate">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {!expanded && (
            <div className="hidden sm:flex items-center gap-2">
              {scheduleSummary && (
                <Badge variant="neutral" className="bg-slate-800/50 text-[10px]">
                  {scheduleSummary}
                </Badge>
              )}
              {providerLabel && (
                <Badge variant="info" className="bg-blue-500/5 text-[10px]">
                  {providerLabel}
                </Badge>
              )}
            </div>
          )}
          
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={enabled}
              onChange={onToggle}
            />
          </div>
          
          <ChevronDown
            className={`h-5 w-5 text-slate-500 transition-transform duration-300 ${
              expanded ? 'rotate-180 text-indigo-400' : ''
            }`}
          />
        </div>
      </div>

      {/* Content */}
      <div
        className={`grid transition-all duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="p-6 pt-0 space-y-6 border-t border-slate-800/50 mt-2">
            <div className="pt-6">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobAccordion;
