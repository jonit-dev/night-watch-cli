import { create } from 'zustand';
import { ProjectInfo, setCurrentProject, setGlobalMode as setApiGlobalMode } from '../api';

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

  // Multi-project state
  globalModeLoading: boolean;
  setGlobalModeLoading: (v: boolean) => void;
  isGlobalMode: boolean;
  setGlobalMode: (v: boolean) => void;
  projects: ProjectInfo[];
  setProjects: (p: ProjectInfo[]) => void;
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;
}

const savedProjectId = typeof localStorage !== 'undefined'
  ? localStorage.getItem('nw-selected-project')
  : null;

export const useStore = create<AppState>((set) => ({
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
    set({ selectedProjectId: id });
  },
}));
