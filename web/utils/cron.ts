/**
 * Cron utility functions for schedule management
 */

export type CronPreset = {
  label: string;
  value: string;
  description: string;
};

export const CRON_PRESETS: CronPreset[] = [
  {
    label: 'Balanced (recommended)',
    value: '5 */2 * * *',
    description: 'Every 2 hours at minute 5',
  },
  {
    label: 'Every 6 hours (very safe)',
    value: '10 */6 * * *',
    description: 'Every 6 hours at minute 10',
  },
  {
    label: 'Every 4 hours',
    value: '10 */4 * * *',
    description: 'Every 4 hours at minute 10',
  },
  {
    label: 'Twice daily',
    value: '20 2,14 * * *',
    description: 'At 02:20 and 14:20 UTC',
  },
  {
    label: 'Daily',
    value: '30 3 * * *',
    description: 'Once per day at 03:30 UTC',
  },
  {
    label: 'Weekdays only',
    value: '30 9 * * 1-5',
    description: 'At 09:30 UTC, Monday to Friday',
  },
  {
    label: 'Weekly (Monday)',
    value: '40 3 * * 1',
    description: 'At 03:40 UTC every Monday',
  },
  {
    label: 'Custom',
    value: '__custom__',
    description: 'Enter your own cron expression',
  },
];

export interface IScheduleTemplate {
  id: string;
  label: string;
  description: string;
  schedules: {
    executor: string;
    reviewer: string;
    qa: string;
    audit: string;
    slicer: string;
  };
  hints: {
    executor: string;
    reviewer: string;
    qa: string;
    audit: string;
    slicer: string;
  };
}

export const SCHEDULE_TEMPLATES: IScheduleTemplate[] = [
  {
    id: 'night-surge',
    label: 'Night Surge',
    description: 'Dense overnight execution every 2h with daytime reviews.',
    schedules: {
      executor: '5 20,22,0,2,4,6 * * *',
      reviewer: '25 8,14,20 * * *',
      qa: '45 22,10 * * *',
      audit: '50 4 * * 1',
      slicer: '35 19,7 * * *',
    },
    hints: {
      executor: '8pm–6am every 2h (6 runs)',
      reviewer: '8:25am, 2:25pm, 8:25pm',
      qa: '10:45pm & 10:45am',
      audit: 'Mon 4:50am',
      slicer: '7:35pm & 7:35am',
    },
  },
  {
    id: 'always-on',
    label: 'Always On (Recommended)',
    description: '24/7 with maximum cadence — executor every hour, reviewer every 3h.',
    schedules: {
      executor: '5 * * * *',
      reviewer: '25 */3 * * *',
      qa: '45 2,10,18 * * *',
      audit: '50 3 * * 1',
      slicer: '35 */6 * * *',
    },
    hints: {
      executor: 'Every hour at :05',
      reviewer: 'Every 3h at :25',
      qa: '2:45am, 10:45am & 6:45pm',
      audit: 'Mon 3:50am',
      slicer: 'Every 6h at :35',
    },
  },
  {
    id: 'day-shift',
    label: 'Day Shift',
    description: 'Weekday daytime — hourly executor 8am–8pm, reviews 4x/day.',
    schedules: {
      executor: '5 8-20 * * 1-5',
      reviewer: '25 9,13,17,19 * * 1-5',
      qa: '45 10,14,18 * * 1-5',
      audit: '50 9 * * 1',
      slicer: '35 7 * * 1',
    },
    hints: {
      executor: 'Hourly at :05, 8am–8pm weekdays',
      reviewer: '9:25am, 1:25pm, 5:25pm, 7:25pm',
      qa: '10:45am, 2:45pm & 6:45pm weekdays',
      audit: 'Mon 9:50am',
      slicer: 'Mon 7:35am',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Twice-daily executor and reviewer with weekly heavy jobs.',
    schedules: {
      executor: '5 2,14 * * *',
      reviewer: '25 8,20 * * *',
      qa: '45 3 * * 0',
      audit: '50 4 * * 0',
      slicer: '35 1 * * 1',
    },
    hints: {
      executor: '2:05am & 2:05pm',
      reviewer: '8:25am & 8:25pm',
      qa: 'Sun 3:45am',
      audit: 'Sun 4:50am',
      slicer: 'Mon 1:35am',
    },
  },
];

export function normalizeCronExpression(expr: string | undefined): string {
  if (!expr) return '';
  return expr.trim().replace(/\s+/g, ' ');
}

export function isCronEquivalent(left: string, right: string): boolean {
  return normalizeCronExpression(left) === normalizeCronExpression(right);
}

export function getTemplateById(id: string | null | undefined): IScheduleTemplate | undefined {
  if (!id) return undefined;
  return SCHEDULE_TEMPLATES.find((template) => template.id === id);
}

export function templateMatchesSchedules(
  template: IScheduleTemplate,
  executor: string,
  reviewer: string,
  qa: string,
  audit: string,
  slicer: string,
): boolean {
  return (
    isCronEquivalent(template.schedules.executor, executor) &&
    isCronEquivalent(template.schedules.reviewer, reviewer) &&
    isCronEquivalent(template.schedules.qa, qa) &&
    isCronEquivalent(template.schedules.audit, audit) &&
    isCronEquivalent(template.schedules.slicer, slicer)
  );
}

export function detectTemplate(
  executor: string,
  reviewer: string,
  qa: string,
  audit: string,
  slicer: string,
): IScheduleTemplate | undefined {
  return SCHEDULE_TEMPLATES.find((t) =>
    templateMatchesSchedules(t, executor, reviewer, qa, audit, slicer),
  );
}

/**
 * Resolve active template from persisted template id and current schedules.
 * Uses persisted id when it exists and still matches current schedules;
 * otherwise falls back to schedule-based detection.
 */
export function resolveActiveTemplate(
  scheduleBundleId: string | null | undefined,
  executor: string,
  reviewer: string,
  qa: string,
  audit: string,
  slicer: string,
): IScheduleTemplate | undefined {
  const byId = getTemplateById(scheduleBundleId);
  if (byId && templateMatchesSchedules(byId, executor, reviewer, qa, audit, slicer)) {
    return byId;
  }
  return detectTemplate(executor, reviewer, qa, audit, slicer);
}

/**
 * Convert cron expression to human-readable format
 */
export function cronToHuman(expr: string): string {
  const normalizedExpr = normalizeCronExpression(expr);
  const parts = normalizedExpr.split(/\s+/);
  if (parts.length !== 5) {
    return normalizedExpr;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const isFixedMinute = /^\d+$/.test(minute);

  // Check for presets
  const preset = CRON_PRESETS.find((p) => normalizeCronExpression(p.value) === normalizedExpr);
  if (preset) {
    return preset.label;
  }

  // Parse common patterns
  if (minute === '*/30' && hour === '*') {
    return 'Every 30 minutes';
  }
  if (minute === '0' && hour === '*') {
    return 'Every hour';
  }
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.replace('*/', ''), 10);
    return `Every ${interval} minutes`;
  }
  if (
    isFixedMinute &&
    hour.startsWith('*/') &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const interval = parseInt(hour.replace('*/', ''), 10);
    return minute === '0'
      ? `Every ${interval} hours`
      : `Every ${interval} hours at :${minute.padStart(2, '0')}`;
  }
  if (minute === '0' && hour.startsWith('*/')) {
    const interval = parseInt(hour.replace('*/', ''), 10);
    return `Every ${interval} hours`;
  }
  // Handle hour range (e.g., 0-21)
  if (minute === '0' && hour.includes('-')) {
    const [start, end] = hour.split('-');
    return `Every hour from ${formatHour(start)} to ${formatHour(end)}`;
  }
  if (isFixedMinute && hour.includes('-') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const [start, end] = hour.split('-');
    return `Every hour from ${formatTime(start, minute)} to ${formatTime(end, minute)}`;
  }

  // Handle comma-separated hours
  if (minute === '0' && hour.includes(',')) {
    const hours = hour.split(',').map(formatHour);
    if (hours.length <= 3) {
      return `At ${hours.join(' and ')}`;
    }
    return `At ${hours.slice(0, -1).join(', ')}, and ${hours[hours.length - 1]}`;
  }
  if (
    isFixedMinute &&
    hour.includes(',') &&
    dayOfMonth === '*' &&
    month === '*' &&
    (dayOfWeek === '*' || dayOfWeek === '1-5')
  ) {
    const times = hour.split(',').map((value) => formatTime(value, minute));
    const prefix = dayOfWeek === '1-5' ? 'Weekdays at ' : 'At ';
    if (times.length <= 3) {
      return `${prefix}${times.join(' and ')}`;
    }
    return `${prefix}${times.slice(0, -1).join(', ')}, and ${times[times.length - 1]}`;
  }

  if (minute === '0' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${formatHour(hour)}`;
  }
  if (
    isFixedMinute &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return `Daily at ${formatTime(hour, minute)}`;
  }
  if (minute === '0' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${formatHour(hour)}`;
  }
  if (
    isFixedMinute &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '1-5'
  ) {
    return `Weekdays at ${formatTime(hour, minute)}`;
  }

  // Default: return the expression itself
  return normalizedExpr;
}

/**
 * Format hour (24h) to 12h format
 */
function formatHour(hour: string): string {
  const h = parseInt(hour, 10);
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function formatTime(hour: string, minute: string): string {
  const paddedMinute = minute.padStart(2, '0');
  const h = parseInt(hour, 10);
  if (Number.isNaN(h)) {
    return `${hour}:${paddedMinute}`;
  }
  if (h === 0) return `12:${paddedMinute} AM`;
  if (h < 12) return `${h}:${paddedMinute} AM`;
  if (h === 12) return `12:${paddedMinute} PM`;
  return `${h - 12}:${paddedMinute} PM`;
}

/**
 * Get the preset value for a given cron expression
 */
export function getPresetValue(cronExpr: string): string {
  const normalizedExpr = normalizeCronExpression(cronExpr);
  const preset = CRON_PRESETS.find((p) => normalizeCronExpression(p.value) === normalizedExpr);
  return preset?.value ?? '__custom__';
}

/**
 * Get preset by value
 */
export function getPresetByValue(value: string): CronPreset | undefined {
  return CRON_PRESETS.find(p => p.value === value);
}

/**
 * Calculate next run time from cron expression
 */
export function getNextRunTime(cronExpr: string): Date | null {
  try {
    // Simple implementation - this is a basic approximation
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return null;

    const [minute, hour, , , dayOfWeek] = parts;
    const now = new Date();
    const next = new Date(now);

    // Handle minute patterns
    if (minute.startsWith('*/')) {
      const interval = parseInt(minute.replace('*/', ''), 10);
      next.setMinutes(next.getMinutes() + (interval - (next.getMinutes() % interval)));
    } else if (minute !== '*') {
      const targetMinute = parseInt(minute, 10);
      next.setMinutes(targetMinute, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
    } else {
      next.setMinutes(0, 0, 0);
      if (next <= now) {
        next.setHours(next.getHours() + 1);
      }
    }

    // Handle hour patterns
    if (hour.startsWith('*/')) {
      const interval = parseInt(hour.replace('*/', ''), 10);
      const currentHour = next.getHours();
      const targetHour = Math.ceil(currentHour / interval) * interval;
      next.setHours(targetHour % 24, 0, 0);
      if (targetHour >= 24) {
        next.setDate(next.getDate() + 1);
      }
    } else if (hour.includes('-')) {
      // Handle hour range (e.g., 0-21)
      const [start, end] = hour.split('-').map(Number);
      const currentHour = next.getHours();
      if (currentHour > end) {
        // Past the range, move to next day at start
        next.setDate(next.getDate() + 1);
        next.setHours(start, 0, 0);
      } else if (currentHour < start) {
        // Before the range, set to start
        next.setHours(start, 0, 0);
      }
      // Otherwise we're in the range, keep the hour
    } else if (hour !== '*' && !minute.startsWith('*/') && hour.includes(',')) {
      const hours = hour.split(',').map(Number);
      const currentHour = next.getHours();
      const nextHour = hours.find(h => h > currentHour);
      if (nextHour !== undefined) {
        next.setHours(nextHour, 0, 0);
      } else {
        // No more hours today, move to first hour tomorrow
        next.setDate(next.getDate() + 1);
        next.setHours(hours[0], 0, 0);
      }
    } else if (hour !== '*' && !minute.startsWith('*/')) {
      const targetHour = parseInt(hour, 10);
      next.setHours(targetHour, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    }

    // Handle day of week
    if (dayOfWeek !== '*' && dayOfWeek !== '1-5') {
      const targetDay = parseInt(dayOfWeek, 10);
      const currentDay = next.getDay();
      if (currentDay !== targetDay) {
        const daysUntilTarget = (targetDay - currentDay + 7) % 7 || 7;
        next.setDate(next.getDate() + daysUntilTarget);
      }
    } else if (dayOfWeek === '1-5') {
      // Weekdays only
      const currentDay = next.getDay();
      if (currentDay === 0) { // Sunday
        next.setDate(next.getDate() + 1);
      } else if (currentDay === 6) { // Saturday
        next.setDate(next.getDate() + 2);
      }
    }

    return next;
  } catch {
    return null;
  }
}

/**
 * Format relative time (e.g., "in 2 hours", "in 5 minutes")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'less than a minute';
  if (diffMins < 60) return `in ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
  if (diffHours < 24) return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
}

/**
 * Format absolute time (e.g., "Mon, Jan 15 at 9:00 AM")
 */
export function formatAbsoluteTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Check if a date is within 30 minutes from now
 */
export function isWithin30Minutes(date: Date): boolean {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  return diffMins >= 0 && diffMins < 30;
}
