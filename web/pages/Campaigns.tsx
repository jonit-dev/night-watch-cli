import React, { useState, useMemo } from 'react';
import { RefreshCw, AlertCircle, Megaphone, X } from 'lucide-react';
import Calendar from '../components/campaign/Calendar';
import CampaignCard from '../components/campaign/CampaignCard';
import CampaignFilters from '../components/campaign/CampaignFilters';
import ScheduleModal from '../components/campaign/ScheduleModal';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { useStore } from '../store/useStore';
import {
  useApi,
  fetchCampaigns,
  fetchAdAccounts,
  syncCampaigns,
  updateCampaignSchedule,
  createCampaignSchedule,
  deleteCampaignSchedule,
  type ICampaignWithSchedule,
  type CampaignStatus,
  type CreateCampaignScheduleInput,
  type UpdateCampaignScheduleInput,
} from '../api';

interface IDayCampaignsPanelProps {
  date: Date;
  campaigns: ICampaignWithSchedule[];
  onClose: () => void;
  onEditSchedule: (campaign: ICampaignWithSchedule) => void;
  onDeleteSchedule: (campaign: ICampaignWithSchedule) => void;
}

const DayCampaignsPanel: React.FC<IDayCampaignsPanelProps> = ({
  date,
  campaigns,
  onClose,
  onEditSchedule,
  onDeleteSchedule,
}) => {
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Card className="p-6 bg-slate-900 border-indigo-900/50">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-slate-200">Campaigns for {formattedDate}</h3>
          <p className="text-sm text-slate-400 mt-1">{campaigns.length} campaign(s)</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-slate-500 text-sm">No campaigns scheduled for this day.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.campaignId}
              campaign={campaign}
              onEditSchedule={onEditSchedule}
              onDeleteSchedule={onDeleteSchedule}
            />
          ))}
        </div>
      )}
    </Card>
  );
};

const Campaigns: React.FC = () => {
  const { addToast, globalModeLoading } = useStore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');
  const [selectedDay, setSelectedDay] = useState<{ date: Date; campaigns: ICampaignWithSchedule[] } | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<ICampaignWithSchedule | null>(null);
  const [syncing, setSyncing] = useState(false);

  const {
    data: campaignsData,
    loading: campaignsLoading,
    error: campaignsError,
    refetch: refetchCampaigns,
  } = useApi(fetchCampaigns, [], { enabled: !globalModeLoading });

  const {
    data: adAccountsData,
    loading: accountsLoading,
    error: accountsError,
    refetch: refetchAccounts,
  } = useApi(fetchAdAccounts, [], { enabled: !globalModeLoading });

  const campaigns = campaignsData ?? [];
  const adAccounts = adAccountsData ?? [];

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((campaign) => {
      if (selectedAccountId && campaign.adAccountId !== selectedAccountId) {
        return false;
      }
      if (statusFilter !== 'all' && campaign.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [campaigns, selectedAccountId, statusFilter]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCampaigns(selectedAccountId ?? undefined);
      addToast({
        title: 'Sync Complete',
        message: `Synced ${result.length} campaigns from Meta Ads`,
        type: 'success',
      });
      refetchCampaigns();
    } catch (error) {
      addToast({
        title: 'Sync Failed',
        message: error instanceof Error ? error.message : 'Failed to sync campaigns',
        type: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDayClick = (date: Date, dayCampaigns: ICampaignWithSchedule[]) => {
    setSelectedDay({ date, campaigns: dayCampaigns });
  };

  const handleCampaignClick = (campaign: ICampaignWithSchedule) => {
    setEditingCampaign(campaign);
  };

  const handleEditSchedule = (campaign: ICampaignWithSchedule) => {
    setEditingCampaign(campaign);
    setSelectedDay(null);
  };

  const handleDeleteSchedule = async (campaign: ICampaignWithSchedule) => {
    if (!window.confirm(`Remove schedule for "${campaign.campaignName}"?`)) {
      return;
    }

    try {
      await deleteCampaignSchedule(campaign.campaignId);
      addToast({
        title: 'Schedule Removed',
        message: `Schedule for "${campaign.campaignName}" has been removed.`,
        type: 'info',
      });
      refetchCampaigns();
      if (selectedDay) {
        setSelectedDay(null);
      }
    } catch (error) {
      addToast({
        title: 'Delete Failed',
        message: error instanceof Error ? error.message : 'Failed to delete schedule',
        type: 'error',
      });
    }
  };

  const handleSaveSchedule = async (
    campaignId: string,
    schedule: CreateCampaignScheduleInput | UpdateCampaignScheduleInput
  ) => {
    const existingCampaign = campaigns.find((c) => c.campaignId === campaignId);

    if (existingCampaign?.schedule) {
      await updateCampaignSchedule(campaignId, schedule as UpdateCampaignScheduleInput);
    } else {
      await createCampaignSchedule(campaignId, schedule as CreateCampaignScheduleInput);
    }

    addToast({
      title: 'Schedule Saved',
      message: 'Campaign schedule has been updated.',
      type: 'success',
    });
    refetchCampaigns();
  };

  const isLoading = campaignsLoading || accountsLoading;
  const hasError = campaignsError || accountsError;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading campaigns...</div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-slate-300">Failed to load campaigns</div>
        <div className="text-sm text-slate-500">
          {campaignsError?.message || accountsError?.message || 'Unknown error'}
        </div>
        <div className="flex space-x-2">
          <Button onClick={() => { refetchCampaigns(); refetchAccounts(); }}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Megaphone className="h-8 w-8 text-indigo-400" />
          <div>
            <h1 className="text-3xl font-bold text-slate-100">Campaigns</h1>
            <p className="text-sm text-slate-400">
              {filteredCampaigns.length} campaign{filteredCampaigns.length !== 1 ? 's' : ''} visible
            </p>
          </div>
        </div>
        <Button onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync from Meta'}
        </Button>
      </div>

      {/* Filters */}
      <CampaignFilters
        adAccounts={adAccounts}
        selectedAccountId={selectedAccountId}
        onAccountChange={setSelectedAccountId}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {/* Calendar */}
      <Card className="p-6">
        <Calendar
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          campaigns={filteredCampaigns}
          onDayClick={handleDayClick}
          onCampaignClick={handleCampaignClick}
        />
      </Card>

      {/* Selected Day Panel */}
      {selectedDay && (
        <DayCampaignsPanel
          date={selectedDay.date}
          campaigns={selectedDay.campaigns}
          onClose={() => setSelectedDay(null)}
          onEditSchedule={handleEditSchedule}
          onDeleteSchedule={handleDeleteSchedule}
        />
      )}

      {/* Schedule Edit Modal */}
      <ScheduleModal
        isOpen={editingCampaign !== null}
        onClose={() => setEditingCampaign(null)}
        campaign={editingCampaign}
        onSave={handleSaveSchedule}
      />
    </div>
  );
};

export default Campaigns;
