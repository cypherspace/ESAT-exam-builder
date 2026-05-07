import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const ERROR_LABELS: Record<string, string> = {
  google_error: 'Google rejected the sign-in attempt.',
  missing_params: 'Sign-in parameters were missing — try again.',
  stale_state: 'Sign-in took too long; please retry.',
  oauth_failed: 'Google OAuth exchange failed.',
  unverified_email: 'Your Google email is not verified.',
  not_allowed: 'This account is not on the allowlist.',
};

export function Login() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const detail = params.get('detail');
  const email = params.get('email');

  // Auto-redirect to /auth/google/start if no error param.
  useEffect(() => {
    if (!error && !import.meta.env.VITE_AUTH_DISABLED) {
      // Honour an explicit ?manual=1 to disable the auto-redirect for
      // testing.
      if (params.get('manual') !== '1') {
        window.location.href = `${import.meta.env.VITE_API_URL ?? ''}/api/v1/auth/google/start`;
      }
    }
  }, [error, params]);

  const message = useMemo(() => {
    if (!error) return null;
    const label = ERROR_LABELS[error] ?? `Sign-in error: ${error}`;
    if (error === 'not_allowed' && email) {
      return `${label} (${email})`;
    }
    if (detail) return `${label} (${detail})`;
    return label;
  }, [error, detail, email]);

  return (
    <div className="max-w-md grid gap-3">
      <h2 className="text-xl font-semibold">Sign in</h2>
      {message ? (
        <>
          <p className="text-sm text-red-700">{message}</p>
          <a
            href={`${import.meta.env.VITE_API_URL ?? ''}/api/v1/auth/google/start`}
            className="bg-blue-600 text-white rounded px-3 py-2 inline-block"
          >
            Continue with Google
          </a>
        </>
      ) : (
        <p className="text-sm text-slate-600">Redirecting to Google…</p>
      )}
    </div>
  );
}
