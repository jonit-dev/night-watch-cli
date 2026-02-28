import React from 'react';
import { ExternalLink, Calendar, DollarSign, Clock, Edit, Trash2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import type { ICampaignWithSchedule, CampaignStatus } from '../../api';

interface ICampaignCardProps {
  campaign: ICampaignWithSchedule;
  onEditSchedule: (campaign: ICampaignWithSchedule) => void;
  onDeleteSchedule: (campaign: ICampaignWithSchedule) => void;
}

const STATUS_CONFIG: Record<CampaignStatus, { label: string; bg: string; text: string; border: string }> = {
  scheduled: { label: 'Scheduled', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  active: { label: 'Active', bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  paused: { label: 'Paused', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  completed: { label: 'Completed', bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
};

const CampaignCard: React.FC<ICampaignCardProps> = ({
  campaign,
  onEditSchedule,
  onDeleteSchedule,
}) => {
  const statusConfig = STATUS_CONFIG[campaign.status];
  const startDate = new Date(campaign.startDate * 1000);
  const endDate = new Date(campaign.endDate * 1000);

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const openInMeta = () => {
    const url = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${campaign.adAccountId.replace('act_', '')}&selected_campaign_ids=${campaign.campaignId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-100 truncate" title={campaign.campaignName}>
            {campaign.campaignName}
          </h4>
          <div className="flex items-center space-x-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded border ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
              {statusConfig.label}
            </span>
            <span className="text-xs text-slate-500 font-mono" title={campaign.campaignId}>
              {campaign.campaignId.slice(0, 12)}...
            </span>
          </div>
        </div>
        <button
          onClick={openInMeta}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="View in Meta Ads Manager"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center text-xs text-slate-400">
          <Calendar className="h-3.5 w-3.5 mr-2" />
          <span>{formatDate(startDate)}</span>
          <span className="mx-2">-</span>
          <span>{formatDate(endDate)}</span>
        </div>

        {campaign.schedule?.budgetSchedule && (
          <div className="flex items-center text-xs text-slate-400">
            <DollarSign className="h-3.5 w-3.5 mr-2" />
            <span>Base: {formatCurrency(campaign.schedule.budgetSchedule.baseAmount)}</span>
            {campaign.schedule.budgetSchedule.schedules.length > 0 && (
              <span className="ml-2 text-slate-500">
                ({campaign.schedule.budgetSchedule.schedules.length} scheduled changes)
              </span>
            )}
          </div>
        )}

        {campaign.schedule && (
          <div className="flex items-center text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5 mr-2" />
            <span>Updated {new Date(campaign.schedule.updatedAt * 1000).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEditSchedule(campaign)}
        >
          <Edit className="h-3.5 w-3.5 mr-1" />
          Edit Schedule
        </Button>
        {campaign.schedule && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => onDeleteSchedule(campaign)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
};

export default CampaignCard;
