import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { redirect } = useSearch({ strict: false }) as { redirect?: string };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email, password);
      // Honor the deep-link the auth guard captured; fall back to the dashboard.
      navigate({ to: redirect || '/' });
    } catch {
      setError(t('login.invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-parchment px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-ember rounded-xl mb-4">
            <Flame className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-serif text-ink">Heorth</h1>
          <p className="text-sm text-ash mt-1">{t('login.signInToHome')}</p>
        </div>

        <div className="bg-card rounded-xl border border-tan shadow-sm p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('login.emailPlaceholder')} autoFocus />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('login.passwordPlaceholder')} />
            </div>
            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading || !email || !password}>
              {isLoading ? t('login.signingIn') : t('login.signIn')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
