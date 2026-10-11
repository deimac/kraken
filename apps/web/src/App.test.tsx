import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders brand and slogan', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Midora' })).toBeTruthy();
  expect(screen.getByText('Sua mídia. Múltiplas possibilidades.')).toBeTruthy();
});
