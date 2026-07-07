import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const API_URL = 'https://functions.poehali.dev/b9bed241-7334-4e64-ac69-6070b9e58504';

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<{ email: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Ссылка-приглашение не найдена');
      setLoading(false);
      return;
    }
    fetch(`${API_URL}?action=invite_info&token=${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Приглашение не найдено');
        } else {
          setInfo(data);
        }
      })
      .catch(() => setError('Сервер недоступен'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (password.length < 3) {
      toast.error('Пароль слишком короткий');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}?action=accept_invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Не удалось активировать аккаунт');
        return;
      }
      localStorage.setItem('sellerId', String(data.id));
      localStorage.setItem('sellerEmail', data.email);
      localStorage.setItem('sellerRole', data.role);
      toast.success('Аккаунт активирован, добро пожаловать!');
      navigate('/');
    } catch {
      toast.error('Сервер недоступен');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid-bg bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card rounded-lg shadow-2xl border border-border p-8 animate-scale-in">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded bg-primary flex items-center justify-center">
            <Icon name="ShieldCheck" className="text-primary-foreground" size={20} />
          </div>
          <span className="font-display font-bold text-lg tracking-tight">ЛОЯЛЬНОСТЬ<span className="text-accent">·CRM</span></span>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Активация приглашения продавца</p>

        {loading && (
          <div className="py-8 flex items-center justify-center text-muted-foreground">
            <Icon name="Loader2" size={20} className="animate-spin mr-2" /> Проверка ссылки…
          </div>
        )}

        {!loading && error && (
          <div className="py-4 text-sm text-destructive flex items-start gap-2">
            <Icon name="AlertTriangle" size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {!loading && info && (
          <div className="space-y-4">
            <div className="bg-secondary/60 rounded-lg p-3 text-sm">
              <div className="font-medium">{info.name}</div>
              <div className="text-muted-foreground tabular">{info.email}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Придумайте пароль</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Повторите пароль</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </div>
            <Button className="w-full" onClick={submit} disabled={busy}>
              <Icon name={busy ? 'Loader2' : 'CheckCircle'} size={16} className={`mr-2 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Активация…' : 'Активировать аккаунт'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
