import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTriggerJob } from '../useTriggerJob.js';

const apiMocks = vi.hoisted(() => ({
  triggerJob: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  triggerJob: apiMocks.triggerJob,
}));

vi.mock('../../store/useStore.js', () => ({
  useStore: () => ({
    addToast: storeMocks.addToast,
  }),
}));

describe('useTriggerJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls triggerJob with "executor" for executor', async () => {
    apiMocks.triggerJob.mockResolvedValue({ started: true });
    const { result } = renderHook(() => useTriggerJob());

    await act(async () => {
      await result.current.triggerJob('executor');
    });

    expect(apiMocks.triggerJob).toHaveBeenCalledWith('executor');
  });

  it('maps planner to slicer when calling triggerJob', async () => {
    apiMocks.triggerJob.mockResolvedValue({ started: true });
    const { result } = renderHook(() => useTriggerJob());

    await act(async () => {
      await result.current.triggerJob('planner');
    });

    expect(apiMocks.triggerJob).toHaveBeenCalledWith('slicer');
  });

  it('shows success toast on success', async () => {
    apiMocks.triggerJob.mockResolvedValue({ started: true });
    const { result } = renderHook(() => useTriggerJob());

    await act(async () => {
      await result.current.triggerJob('executor');
    });

    expect(storeMocks.addToast).toHaveBeenCalledWith({
      title: 'Job Triggered',
      message: 'Executor job has been queued.',
      type: 'success',
    });
  });

  it('shows error toast on failure', async () => {
    apiMocks.triggerJob.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useTriggerJob());

    await act(async () => {
      await result.current.triggerJob('reviewer');
    });

    expect(storeMocks.addToast).toHaveBeenCalledWith({
      title: 'Trigger Failed',
      message: 'network error',
      type: 'error',
    });
  });

  it('sets triggeringJob during the call and resets to null after', async () => {
    let resolveJob!: () => void;
    apiMocks.triggerJob.mockImplementation(
      () => new Promise<void>((resolve) => { resolveJob = resolve; }),
    );
    const { result } = renderHook(() => useTriggerJob());

    expect(result.current.triggeringJob).toBeNull();

    let promise: Promise<void>;
    act(() => {
      promise = result.current.triggerJob('executor');
    });

    expect(result.current.triggeringJob).toBe('executor');

    await act(async () => {
      resolveJob();
      await promise!;
    });

    expect(result.current.triggeringJob).toBeNull();
  });
});
