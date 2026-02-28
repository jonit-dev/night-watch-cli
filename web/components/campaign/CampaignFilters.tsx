import React from 'react';
import Select from '../ui/Select';
import type { IAdAccount, CampaignStatus } from '../../api';

interface ICampaignFiltersProps {
  adAccounts: IAdAccount[];
  selectedAccountId: string | null;
  onAccountChange: (accountId: string | null) => void;
  statusFilter: CampaignStatus | 'all';
  onStatusChange: (status: CampaignStatus | 'all') => void;
}

const STATUS_PILLS: Array<{ value: CampaignStatus | 'all'; label: string; color: string }> = [
  { value: 'all', label: 'All', color: 'bg-slate-800 text-slate-200 border-slate-700' },
  { value: 'scheduled', label: 'Scheduled', color: 'bg-blue-900/50 text-blue-300 border-blue-800' },
  { value: 'active', label: 'Active', color: 'bg-green-900/50 text-green-300 border-green-800' },
  { value: 'paused', label: 'Paused', color: 'bg-amber-900/50 text-amber-300 border-amber-800' },
  { value: 'completed', label: 'Completed', color: 'bg-slate-700/50 text-slate-300 border-slate-600' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-900/50 text-red-300 border-red-800' },
];

const CampaignFilters: React.FC<ICampaignFiltersProps> = ({
  adAccounts,
  selectedAccountId,
  onAccountChange,
  statusFilter,
  onStatusChange,
}) => {
  const accountOptions = [
    { label: 'All Accounts', value: '' },
    ...adAccounts.map((acc) => ({
      label: acc.name,
      value: acc.id,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-full sm:w-64">
          <Select
            label="Ad Account"
            options={accountOptions}
            value={selectedAccountId || ''}
            onChange={(val) => onAccountChange(val || null)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_PILLS.map((pill) => (
          <button
            key={pill.value}
            onClick={() => onStatusChange(pill.value)}
            className={`
              px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors
              ${statusFilter === pill.value
                ? pill.color
                : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300 border-transparent'
              }
            `}
          >
            {pill.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default CampaignFilters;
