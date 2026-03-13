import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCronReinstall } from '../useCronReinstall.js';

const apiMocks = vi.hoisted(() => ({
  triggerInstallCron: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  triggerInstallCron: apiMocks.triggerInstallCron,
}));

vi.mock('../../store/useStore.js', () => ({
  useStore: () => ({
    addToast: storeMocks.addToast,
  }),
}));

describe('useCronReinstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls triggerInstallCron on reinstallCron', async () => {
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    const { result } = renderHook(() => useCronReinstall());

    await act(async () => {
      await result.current.reinstallCron({
        successTitle: 'Done',
        successMessage: 'Cron installed',
        failureTitle: 'Failed',
      });
    });

    expect(apiMocks.triggerInstallCron).toHaveBeenCalledTimes(1);
  });

  it('shows success toast on success', async () => {
    apiMocks.triggerInstallCron.mockResolvedValue({ started: true });
    const { result } = renderHook(() => useCronReinstall());

    await act(async () => {
      await result.current.reinstallCron({
        successTitle: 'Cron Installed',
        successMessage: 'All schedules updated',
        failureTitle: 'Install Failed',
      });
    });

    expect(storeMocks.addToast).toHaveBeenCalledWith({
      title: 'Cron Installed',
      message: 'All schedules updated',
      type: 'success',
    });
  });

  it('shows warning toast with error message on failure', async () => {
    apiMocks.triggerInstallCron.mockRejectedValue(new Error('cron install failed'));
    const { result } = renderHook(() => useCronReinstall());

    await act(async () => {
      await result.current.reinstallCron({
        successTitle: 'Done',
        successMessage: 'OK',
        failureTitle: 'Install Failed',
      });
    });

    expect(storeMocks.addToast).toHaveBeenCalledWith({
      title: 'Install Failed',
      message: 'cron install failed',
      type: 'warning',
    });
  });

  it('sets isReinstalling true while running and false after', async () => {
    let resolveInstall!: () => void;
    apiMocks.triggerInstallCron.mockImplementation(
      () => new Promise<void>((resolve) => { resolveInstall = resolve; }),
    );
    const { result } = renderHook(() => useCronReinstall());

    expect(result.current.isReinstalling).toBe(false);

    let promise: Promise<boolean>;
    act(() => {
      promise = result.current.reinstallCron({
        successTitle: 'Done',
        successMessage: 'OK',
        failureTitle: 'Failed',
      });
    });

    expect(result.current.isReinstalling).toBe(true);

    await act(async () => {
      resolveInstall();
      await promise!;
    });

    expect(result.current.isReinstalling).toBe(false);
  });
});
