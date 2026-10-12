import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../src/ThemeToggle';
import { initialTheme } from '../src/theme';

const stubSystem = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q }) as MediaQueryList);

describe('theme', () => {
  it('uses the saved choice, else the system preference', () => {
    stubSystem(true);
    expect(initialTheme()).toBe('dark');
    localStorage.setItem('kraken-theme', 'light');
    expect(initialTheme()).toBe('light');
  });

  it('shows the moon in light mode, switches to dark and remembers it', async () => {
    stubSystem(false);
    render(<ThemeToggle />);
    const btn = screen.getByRole('button', { name: 'Ativar tema noturno' });
    expect(document.documentElement.dataset.theme).toBe('light');
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('kraken-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Ativar tema claro' })).toBeTruthy();
  });

  it('index.html applies the theme before React renders', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const html = await readFile(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<script>[^<]*kraken-theme[^<]*dataset\.theme/);
  });
});
