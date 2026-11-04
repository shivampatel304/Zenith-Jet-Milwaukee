import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import PinGate from '../components/PinGate';
import * as api from '../lib/api';

it('shows PIN entry form with unlock button', () => {
  render(<PinGate onSuccess={vi.fn()} />);
  expect(screen.getByPlaceholderText('Enter 6-digit PIN')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
});

it('calls onSuccess when correct PIN is entered', async () => {
  vi.spyOn(api, 'verifyPin').mockResolvedValue(true);
  const onSuccess = vi.fn();
  render(<PinGate onSuccess={onSuccess} />);

  fireEvent.change(screen.getByPlaceholderText('Enter 6-digit PIN'), {
    target: { value: '123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
});

it('shows error message for wrong PIN', async () => {
  vi.spyOn(api, 'verifyPin').mockResolvedValue(false);
  render(<PinGate onSuccess={vi.fn()} />);

  fireEvent.change(screen.getByPlaceholderText('Enter 6-digit PIN'), {
    target: { value: '000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

  await waitFor(() => expect(screen.getByText(/invalid pin/i)).toBeInTheDocument());
});

it('does not call onSuccess for wrong PIN', async () => {
  vi.spyOn(api, 'verifyPin').mockResolvedValue(false);
  const onSuccess = vi.fn();
  render(<PinGate onSuccess={onSuccess} />);

  fireEvent.change(screen.getByPlaceholderText('Enter 6-digit PIN'), {
    target: { value: '000000' },
  });
  fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

  await waitFor(() => screen.getByText(/invalid pin/i));
  expect(onSuccess).not.toHaveBeenCalled();
});
