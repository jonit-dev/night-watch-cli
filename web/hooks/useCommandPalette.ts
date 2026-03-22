import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.js';

export function useCommandPalette(): void {
  const { commandPaletteOpen, setCommandPaletteOpen } = useStore();
  const navigate = useNavigate();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isShortcut = e.metaKey || e.ctrlKey;

    // Cmd+K / Ctrl+K to Toggle command palette
    if (isShortcut && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      setCommandPaletteOpen(!commandPaletteOpen);
      return;
    }

    // Cmd+1-4 for quick navigation
    if (isShortcut && e.key >= '1' && e.key <= '4') {
      e.preventDefault();
      const routeMap: Record<number, string> = {
        1: '/',
        2: '/logs',
        3: '/board',
        4: '/scheduling',
      };
      navigate(routeMap[Number(e.key)]);
      setCommandPaletteOpen(false);
      return;
    }

    // Cmd+, for Settings shortcut
    if (isShortcut && e.key === ',') {
      e.preventDefault();
      navigate('/settings');
      setCommandPaletteOpen(false);
      return;
    }

    // Escape to close command palette
    if (commandPaletteOpen && e.key === 'Escape') {
      setCommandPaletteOpen(false);
    }
  }, [commandPaletteOpen, navigate, setCommandPaletteOpen]);

  // Register keyboard listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  // Close on click outside
  useEffect(() => {
    if (!commandPaletteOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isInsidePalette = target.closest('[data-command-palette]') !== null;
      if (!isInsidePalette) {
        setCommandPaletteOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [commandPaletteOpen, setCommandPaletteOpen]);
}
