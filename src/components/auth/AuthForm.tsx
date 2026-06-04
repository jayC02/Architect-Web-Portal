import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Building2, LogIn } from 'lucide-react';
import { apiRequest } from '@/lib/api/http';

type Mode = 'login' | 'register';

export default function AuthForm({ mode }: { mode: Mode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (event: Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0]) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      if (mode === 'login') {
        await apiRequest('/api/auth/login', {
          method: 'POST',
          json: { email: payload.email, password: payload.password },
        });
      } else {
        await apiRequest('/api/auth/register', {
          method: 'POST',
          json: {
            name: payload.name,
            email: payload.email,
            password: payload.password,
            organisationName: payload.organisationName,
          },
        });
      }
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="panel mx-auto w-full max-w-md rounded-lg p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink text-paper">
          {mode === 'login' ? <LogIn size={20} /> : <Building2 size={20} />}
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">{mode === 'login' ? 'Sign in' : 'Create practice workspace'}</h1>
          <p className="text-sm text-stone-500">
            {mode === 'login' ? 'Open your project dashboard.' : 'Start with an owner account and organisation.'}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {mode === 'register' && (
          <>
            <label className="block">
              <span className="label">Your name</span>
              <input required name="name" minLength={2} className="field" />
            </label>
            <label className="block">
              <span className="label">Organisation</span>
              <input required name="organisationName" minLength={2} className="field" />
            </label>
          </>
        )}
        <label className="block">
          <span className="label">Email</span>
          <input required type="email" name="email" className="field" />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input required type="password" name="password" minLength={mode === 'register' ? 8 : 1} className="field" />
        </label>
      </div>

      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={loading} className="btn btn-primary mt-6 w-full">
        {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <p className="mt-4 text-center text-sm text-stone-500">
        {mode === 'login' ? (
          <>
            Need a workspace? <a className="font-semibold text-ink" href="/register">Register</a>
          </>
        ) : (
          <>
            Already registered? <a className="font-semibold text-ink" href="/login">Sign in</a>
          </>
        )}
      </p>
    </form>
  );
}
