import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import type {
  ICampaignWithSchedule,
  CreateCampaignScheduleInput,
  UpdateCampaignScheduleInput,
  CampaignStatus,
  IBudgetSchedule,
} from '../../api';

interface IScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaign: ICampaignWithSchedule | null;
  onSave: (campaignId: string, schedule: CreateCampaignScheduleInput | UpdateCampaignScheduleInput) => Promise<void>;
}

const STATUS_OPTIONS = [
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

const ScheduleModal: React.FC<IScheduleModalProps> = ({
  isOpen,
  onClose,
  campaign,
  onSave,
}) => {
  const [saving, setSaving] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<CampaignStatus>('scheduled');
  const [baseBudget, setBaseBudget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (campaign) {
      const sd = new Date(campaign.startDate * 1000);
      const ed = new Date(campaign.endDate * 1000);
      setStartDate(sd.toISOString().split('T')[0]);
      setEndDate(ed.toISOString().split('T')[0]);
      setStatus(campaign.status);
      setBaseBudget(
        campaign.schedule?.budgetSchedule?.baseAmount?.toString() || ''
      );
    }
    setError(null);
  }, [campaign]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaign || !startDate || !endDate) {
      setError('Please fill in all required fields');
      return;
    }

    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

    if (endTimestamp < startTimestamp) {
      setError('End date must be after start date');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const budgetSchedule: IBudgetSchedule | null = baseBudget
        ? {
            baseAmount: parseFloat(baseBudget),
            schedules: campaign.schedule?.budgetSchedule?.schedules || [],
          }
        : null;

      const scheduleData: CreateCampaignScheduleInput = {
        campaignId: campaign.campaignId,
        adAccountId: campaign.adAccountId,
        campaignName: campaign.campaignName,
        startDate: startTimestamp,
        endDate: endTimestamp,
        status,
        budgetSchedule,
      };

      await onSave(campaign.campaignId, scheduleData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  if (!campaign) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Edit Schedule: ${campaign.campaignName}`}>
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Start Date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <Input
            label="End Date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        <Select
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(val) => setStatus(val as CampaignStatus)}
        />

        <Input
          label="Base Budget (USD)"
          type="number"
          value={baseBudget}
          onChange={(e) => setBaseBudget(e.target.value)}
          placeholder="e.g., 1000"
          helperText="Daily budget amount in USD (optional)"
        />

        <div className="text-xs text-slate-500 space-y-1">
          <p>Campaign ID: <span className="font-mono">{campaign.campaignId}</span></p>
          <p>Ad Account: <span className="font-mono">{campaign.adAccountId}</span></p>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Schedule'
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default ScheduleModal;
