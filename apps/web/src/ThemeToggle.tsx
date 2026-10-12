import { IconMoon, IconSun } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { applyTheme, initialTheme, saveTheme, type Theme } from './theme';

// Shows the mode the button switches to: moon while light, sun while dark.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const next: Theme = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={next === 'dark' ? 'Ativar tema noturno' : 'Ativar tema claro'}
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
    >
      {next === 'dark' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </button>
  );
}
