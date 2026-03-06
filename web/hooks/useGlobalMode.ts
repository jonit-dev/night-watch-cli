import { useEffect } from 'react';
import { fetchProjects, fetchServerMode } from '../api';
import { useStore } from '../store/useStore';

/**
 * Detects whether the server is running in global mode without relying on a
 * failing /api/projects probe in single-project mode.
 */
export function useGlobalMode(): void {
  const { setGlobalMode, setGlobalModeLoading, setProjects, selectProject, selectedProjectId } = useStore();

  useEffect(() => {
    setGlobalModeLoading(true);
    fetchServerMode()
      .then(async ({ globalMode }) => {
        setGlobalMode(globalMode);
        if (!globalMode) {
          return;
        }

        const projects = await fetchProjects();
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
        setGlobalMode(false);
      })
      .finally(() => {
        setGlobalModeLoading(false);
      });
    // Run only on mount
  }, []);
}
