import { create } from 'zustand';
import type { IStatusSnapshot } from '@shared/types';
import { ProjectInfo, setCurrentProject, setGlobalMode as setApiGlobalMode } from '../api';
import { WEB_JOB_REGISTRY } from '../utils/jobs';

export interface IWebJobState {
  id: string;
  label: string;
  processName: string;
  color: { bg: string; border: string };
  enabled: boolean;
  schedule: string;
  triggerEndpoint: string;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastMessage {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
}

interface AppState {
  projectName: string;
  setProjectName: (name: string) => void;

  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;

  // Status state (single source of truth, synced via SSE + polling)
  status: IStatusSnapshot | null;
  setStatus: (s: IStatusSnapshot) => void;

  // Multi-project state
  globalModeLoading: boolean;
  setGlobalModeLoading: (v: boolean) => void;
  isGlobalMode: boolean;
  setGlobalMode: (v: boolean) => void;
  projects: ProjectInfo[];
  setProjects: (p: ProjectInfo[]) => void;
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;

  // Jobs computed state (derived from status.config via WEB_JOB_REGISTRY)
  getJobStates: () => IWebJobState[];
}

const savedProjectId = typeof localStorage !== 'undefined'
  ? localStorage.getItem('nw-selected-project')
  : null;

export const useStore = create<AppState>((set, get) => ({
  projectName: 'Night Watch',
  setProjectName: (name) => set({ projectName: name }),

  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));

    // Auto dismiss
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  // Status state (single source of truth, updated by useStatusSync)
  status: null,
  setStatus: (snapshot) => set((state) => {
    // Only update if the incoming snapshot is newer than the stored one
    // This prevents stale SSE payload overwriting a fresher poll result
    if (!state.status || new Date(snapshot.timestamp) > new Date(state.status.timestamp)) {
      return { status: snapshot };
    }
    return state;
  }),

  // Multi-project state
  globalModeLoading: true,
  setGlobalModeLoading: (v) => set({ globalModeLoading: v }),
  isGlobalMode: false,
  setGlobalMode: (v) => {
    setApiGlobalMode(v);
    set({ isGlobalMode: v });
  },

  projects: [],
  setProjects: (p) => set({ projects: p }),

  selectedProjectId: savedProjectId,
  selectProject: (id) => {
    setCurrentProject(id);
    if (id) {
      localStorage.setItem('nw-selected-project', id);
    } else {
      localStorage.removeItem('nw-selected-project');
    }
    set((state) => {
      const project = state.projects.find((p) => p.name === id);
      return {
        selectedProjectId: id,
        ...(project ? { projectName: project.name } : {}),
      };
    });
  },

  getJobStates: () => {
    const { status } = get();
    const config = status?.config;
    return WEB_JOB_REGISTRY.map((job) => ({
      id: job.id,
      label: job.label,
      processName: job.processName,
      color: job.color,
      enabled: config ? job.getEnabled(config) : true,
      schedule: config ? job.getSchedule(config) : '',
      triggerEndpoint: job.triggerEndpoint,
    }));
  },
}));
