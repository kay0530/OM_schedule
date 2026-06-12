import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';

/**
 * Applies the selected theme (light / dark / system) to <html data-theme>.
 * Renders nothing. Must live inside AppProvider.
 * Initial pre-React paint is handled by the FOUC guard in index.html.
 */
export default function ThemeApplier() {
  const { settings } = useApp();
  const mode = settings.theme || 'light';

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (mode === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [mode]);

  return null;
}
