import { useState } from 'react';
import { triggerJob } from '../api.js';
import { useStore } from '../store/useStore.js';

type JobType = 'executor' | 'reviewer' | 'qa' | 'audit' | 'planner' | 'analytics';

export function useTriggerJob() {
  const { addToast } = useStore();
  const [triggeringJob, setTriggeringJob] = useState<JobType | null>(null);

  const triggerJobById = async (job: JobType): Promise<void> => {
    const registryId = job === 'planner' ? 'slicer' : job;
    setTriggeringJob(job);
    try {
      await triggerJob(registryId);
      addToast({
        title: 'Job Triggered',
        message: `${job[0].toUpperCase() + job.slice(1)} job has been queued.`,
        type: 'success',
      });
    } catch (err) {
      addToast({
        title: 'Trigger Failed',
        message: err instanceof Error ? err.message : `Failed to trigger ${job} job`,
        type: 'error',
      });
    } finally {
      setTriggeringJob(null);
    }
  };

  return { triggerJob: triggerJobById, triggeringJob };
}
