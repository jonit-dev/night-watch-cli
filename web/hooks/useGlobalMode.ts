import { useEffect } from 'react';
import { fetchProjects } from '../api';
import { useStore } from '../store/useStore';

/**
 * Detects whether the server is running in global mode by probing /api/projects.
 * If the endpoint exists, enables global mode and populates the project list.
 * If it 404s, stays in single-project mode (no-op).
 */
export function useGlobalMode(): void {
  const { setGlobalMode, setGlobalModeLoading, setProjects, selectProject, selectedProjectId } = useStore();

  useEffect(() => {
    setGlobalModeLoading(true);
    fetchProjects()
      .then((projects) => {
        setGlobalMode(true);
        setProjects(projects);

        const validProjects = projects.filter((p) => p.valid);

        // Restore previous selection if still valid, otherwise pick first
        if (selectedProjectId && validProjects.some((p) => p.name === selectedProjectId)) {
          selectProject(selectedProjectId);
        } else if (validProjects.length > 0) {
          selectProject(validProjects[0].name);
        }
      })
      .catch(() => {
        // /api/projects doesn't exist — single-project mode
        setGlobalMode(false);
      })
      .finally(() => {
        setGlobalModeLoading(false);
      });
    // Run only on mount
  }, []);
}
