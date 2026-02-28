import React from 'react';
import type { ICampaignWithSchedule, CampaignStatus } from '../../api';

interface ICalendarDayProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  campaigns: ICampaignWithSchedule[];
  onDayClick: (date: Date, campaigns: ICampaignWithSchedule[]) => void;
  onCampaignClick: (campaign: ICampaignWithSchedule) => void;
}

const STATUS_COLORS: Record<CampaignStatus, { bg: string; border: string; text: string }> = {
  scheduled: { bg: 'bg-blue-500/20', border: 'border-blue-500/50', text: 'text-blue-300' },
  active: { bg: 'bg-green-500/20', border: 'border-green-500/50', text: 'text-green-300' },
  paused: { bg: 'bg-amber-500/20', border: 'border-amber-500/50', text: 'text-amber-300' },
  completed: { bg: 'bg-slate-500/20', border: 'border-slate-500/50', text: 'text-slate-300' },
  cancelled: { bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-300' },
};

const CalendarDay: React.FC<ICalendarDayProps> = ({
  date,
  isCurrentMonth,
  isToday,
  campaigns,
  onDayClick,
  onCampaignClick,
}) => {
  const dayNumber = date.getDate();

  const handleClick = () => {
    onDayClick(date, campaigns);
  };

  const handleCampaignClick = (e: React.MouseEvent, campaign: ICampaignWithSchedule) => {
    e.stopPropagation();
    onCampaignClick(campaign);
  };

  return (
    <div
      onClick={handleClick}
      className={`
        min-h-[100px] p-2 border border-slate-800/50 rounded-lg transition-all cursor-pointer
        ${isCurrentMonth ? 'bg-slate-900/50' : 'bg-slate-950/50'}
        ${isToday ? 'ring-2 ring-indigo-500 ring-offset-1 ring-offset-slate-900' : ''}
        hover:bg-slate-800/50
      `}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className={`
            text-sm font-medium
            ${isToday ? 'text-indigo-400' : isCurrentMonth ? 'text-slate-300' : 'text-slate-600'}
          `}
        >
          {dayNumber}
        </span>
        {campaigns.length > 0 && (
          <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
            {campaigns.length}
          </span>
        )}
      </div>

      <div className="space-y-1 overflow-hidden">
        {campaigns.slice(0, 3).map((campaign) => {
          const colors = STATUS_COLORS[campaign.status];
          return (
            <div
              key={campaign.campaignId}
              onClick={(e) => handleCampaignClick(e, campaign)}
              className={`
                text-xs truncate px-1.5 py-0.5 rounded border cursor-pointer
                transition-all hover:scale-[1.02]
                ${colors.bg} ${colors.border} ${colors.text}
              `}
              title={campaign.campaignName}
            >
              {campaign.campaignName}
            </div>
          );
        })}
        {campaigns.length > 3 && (
          <div className="text-xs text-slate-500 px-1">
            +{campaigns.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarDay;
