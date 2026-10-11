import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders the waiting screen', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Midora' })).toBeTruthy();
  expect(screen.getByText('Aguardando campanhas…')).toBeTruthy();
});
