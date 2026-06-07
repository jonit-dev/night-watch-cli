import { useEffect } from 'react';
import { fetchProjects, fetchServerMode } from '../api';
import { useStore } from '../store/useStore';
import { trackWebTelemetry } from '../telemetry';

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
        trackWebTelemetry('web_ui_action', {
          uiArea: 'app',
          action: 'open',
          resource: 'app',
          globalMode,
        });
        if (!globalMode) {
          return;
        }

        const projects = await fetchProjects();
        setProjects(projects);

        const validProjects = projects.filter((p) => p.valid);
        trackWebTelemetry('web_ui_action', {
          uiArea: 'project_selector',
          action: 'view',
          resource: 'project',
          projectCount: validProjects.length,
          itemCount: validProjects.length,
          globalMode: true,
        });

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
