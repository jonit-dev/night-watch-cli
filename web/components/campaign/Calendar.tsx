import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import CalendarDay from './CalendarDay';
import type { ICampaignWithSchedule } from '../../api';

interface ICalendarProps {
  currentDate: Date;
  onDateChange: (date: Date) => void;
  campaigns: ICampaignWithSchedule[];
  onDayClick: (date: Date, campaigns: ICampaignWithSchedule[]) => void;
  onCampaignClick: (campaign: ICampaignWithSchedule) => void;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const Calendar: React.FC<ICalendarProps> = ({
  currentDate,
  onDateChange,
  campaigns,
  onDayClick,
  onCampaignClick,
}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { year, month } = useMemo(() => ({
    year: currentDate.getFullYear(),
    month: currentDate.getMonth(),
  }), [currentDate]);

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const startDay = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthLastDay - i);
      days.push({ date, isCurrentMonth: false });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({ date, isCurrentMonth: true });
    }

    // Next month days (fill to complete the grid)
    const remainingDays = 42 - days.length; // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      days.push({ date, isCurrentMonth: false });
    }

    return days;
  }, [year, month]);

  const getCampaignsForDay = useMemo(() => {
    return (date: Date): ICampaignWithSchedule[] => {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayStartTime = dayStart.getTime();

      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      const dayEndTime = dayEnd.getTime();

      return campaigns.filter((campaign) => {
        const campaignStart = campaign.startDate * 1000;
        const campaignEnd = campaign.endDate * 1000;
        // Campaign overlaps with this day if it starts on or before day end AND ends on or after day start
        return campaignStart <= dayEndTime && campaignEnd >= dayStartTime;
      });
    };
  }, [campaigns]);

  const goToPreviousMonth = () => {
    onDateChange(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    onDateChange(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    onDateChange(new Date());
  };

  const isToday = (date: Date): boolean => {
    return date.getTime() === today.getTime();
  };

  return (
    <div className="space-y-4">
      {/* Header with navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <h2 className="text-xl font-semibold text-slate-100">
            {MONTHS[month]} {year}
          </h2>
          <button
            onClick={goToToday}
            className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Today
          </button>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={goToPreviousMonth}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={goToNextMonth}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Days of week header */}
      <div className="grid grid-cols-7 gap-2">
        {DAYS_OF_WEEK.map((day) => (
          <div
            key={day}
            className="text-center text-xs font-medium text-slate-500 py-2"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {calendarDays.map(({ date, isCurrentMonth }, index) => (
          <CalendarDay
            key={index}
            date={date}
            isCurrentMonth={isCurrentMonth}
            isToday={isToday(date)}
            campaigns={getCampaignsForDay(date)}
            onDayClick={onDayClick}
            onCampaignClick={onCampaignClick}
          />
        ))}
      </div>
    </div>
  );
};

export default Calendar;
