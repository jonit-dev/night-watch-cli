import { useEffect } from 'react';
import { fetchProjects } from '../api';
import { useStore } from '../store/useStore';

/**
 * Detects whether the server is running in global mode by probing /api/projects.
 * If the endpoint exists, enables global mode and populates the project list.
 * If it 404s, stays in single-project mode (no-op).
 */
export function useGlobalMode(): void {
  const { setGlobalMode, setProjects, selectProject, selectedProjectId } = useStore();

  useEffect(() => {
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
      });
    // Run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
