import { useState } from 'react';
import { triggerInstallCron } from '../api.js';
import { useStore } from '../store/useStore.js';

interface ICronReinstallOptions {
  successTitle: string;
  successMessage: string;
  failureTitle: string;
}

export function useCronReinstall() {
  const { addToast } = useStore();
  const [isReinstalling, setIsReinstalling] = useState(false);

  const reinstallCron = async (opts: ICronReinstallOptions): Promise<boolean> => {
    setIsReinstalling(true);
    try {
      await triggerInstallCron();
      addToast({ title: opts.successTitle, message: opts.successMessage, type: 'success' });
      return true;
    } catch (err) {
      addToast({
        title: opts.failureTitle,
        message: err instanceof Error ? err.message : 'Failed to reinstall cron schedules',
        type: 'warning',
      });
      return false;
    } finally {
      setIsReinstalling(false);
    }
  };

  return { reinstallCron, isReinstalling };
}
