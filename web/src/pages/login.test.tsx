import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
const login = vi.fn().mockResolvedValue(undefined);
let search: { redirect?: string } = {};

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => search,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ login }) }));

import LoginPage from './login';

async function signIn() {
  const user = userEvent.setup();
  render(<LoginPage />);
  await user.type(screen.getByLabelText('Email'), 'ada@home.example');
  await user.type(screen.getByLabelText('Password'), 'hunter2hunter2');
  await user.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('LoginPage redirect', () => {
  beforeEach(() => { navigate.mockClear(); login.mockClear(); search = {}; });

  it('navigates to the guard-captured deep link after login', async () => {
    search = { redirect: '/feoh' };
    await signIn();
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({ to: '/feoh' });
  });

  it('falls back to the dashboard when there is no redirect param', async () => {
    search = {};
    await signIn();
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith({ to: '/' });
  });
});
