import { useState, useMemo, useEffect } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

const API_URL = 'https://functions.poehali.dev/b9bed241-7334-4e64-ac69-6070b9e58504';
const RUB = 100;
const LIFETIME_CAP = 30;
const VOUCHERS_PER_BATCH = 5;

type Customer = {
  id: number;
  name: string;
  phone: string;
  birth: string;
  type: 'first' | 'second';
  refId: number | null;
  tempPoints: number;
  lifePoints: number;
  vouchers: number;
  purchases: number;
  joined: string;
  productName: string;
  purchaseAmount: number;
  purchaseDate: string;
};

const nav = [
  { key: 'customers', label: 'Покупатели', icon: 'Users' },
  { key: 'points', label: 'Баллы', icon: 'Coins' },
  { key: 'vouchers', label: 'Фиолки', icon: 'Ticket' },
  { key: 'profile', label: 'Профиль', icon: 'UserCog' },
] as const;

type NavKey = (typeof nav)[number]['key'];
type Stats = { totalTemp: number; totalLife: number; totalVouchers: number };
type Form = {
  name: string; phone: string; birth: string; type: 'first' | 'second'; refId: string;
  productName: string; purchaseAmount: string; purchaseDate: string;
};

const EMPTY_FORM: Form = {
  name: '', phone: '', birth: '', type: 'first', refId: '',
  productName: '', purchaseAmount: '', purchaseDate: '',
};

export default function Index() {
  const [sellerId, setSellerId] = useState<number | null>(() => {
    const v = localStorage.getItem('sellerId');
    return v ? Number(v) : null;
  });
  const [email, setEmail] = useState(() => localStorage.getItem('sellerEmail') || '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<NavKey>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);

  const authed = sellerId !== null;
  const firsts = customers.filter((c) => c.type === 'first');
  const seconds = customers.filter((c) => c.type === 'second');

  const stats = useMemo(() => {
    const totalTemp = customers.reduce((s, c) => s + c.tempPoints, 0);
    const totalLife = customers.reduce((s, c) => s + Math.min(c.lifePoints, LIFETIME_CAP), 0);
    const totalVouchers = customers.reduce((s, c) => s + c.vouchers, 0);
    return { totalTemp, totalLife, totalVouchers };
  }, [customers]);

  const loadCustomers = async (sid: number) => {
    try {
      const res = await fetch(API_URL, { headers: { 'X-Seller-Id': String(sid) } });
      const data = await res.json();
      if (res.ok) setCustomers(data.customers || []);
    } catch {
      toast.error('Не удалось загрузить данные');
    }
  };

  useEffect(() => {
    if (sellerId !== null) loadCustomers(sellerId);
  }, [sellerId]);

  const login = async () => {
    if (!email.includes('@') || pass.length < 3) {
      toast.error('Введите корректный email и пароль');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}?action=login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Ошибка входа');
        return;
      }
      localStorage.setItem('sellerId', String(data.id));
      localStorage.setItem('sellerEmail', data.email);
      setSellerId(data.id);
      setEmail(data.email);
      setPass('');
      toast.success('Добро пожаловать в систему');
    } catch {
      toast.error('Сервер недоступен');
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('sellerId');
    localStorage.removeItem('sellerEmail');
    setSellerId(null);
    setCustomers([]);
  };

  const addCustomer = async () => {
    if (!form.name || !form.phone) {
      toast.error('Заполните Ф.И.О. и телефон');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}?action=add_customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': String(sellerId) },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Ошибка сохранения');
        return;
      }
      if (data.notify) {
        const pts = data.earnedPoints ?? 1;
        toast.success(`Первому покупателю «${data.notify}» начислено ${pts} ${pts === 1 ? 'балл' : 'баллов'}. Отправлен PUSH.`, { icon: '🔔' });
      } else {
        toast.success('Покупатель добавлен, выдано 5 фиолок');
      }
      await loadCustomers(sellerId as number);
      setAddOpen(false);
      setForm(EMPTY_FORM);
    } catch {
      toast.error('Сервер недоступен');
    } finally {
      setBusy(false);
    }
  };

  const spendVoucher = async (id: number) => {
    try {
      const res = await fetch(`${API_URL}?action=spend_voucher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': String(sellerId) },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Нет доступных фиолок');
        return;
      }
      await loadCustomers(sellerId as number);
      toast.success('Фиолка списана');
    } catch {
      toast.error('Сервер недоступен');
    }
  };

  if (!authed) return <Login {...{ email, setEmail, pass, setPass, login, busy }} />;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <Header tab={tab} email={email} />
      <div className="flex flex-1">
        <Sidebar tab={tab} setTab={setTab} />
        <main className="flex-1 p-5 md:p-8 max-w-[1400px] w-full mx-auto animate-fade-in pb-24 md:pb-8" key={tab}>
          {tab === 'customers' && (
            <Customers {...{ customers, firsts, seconds, stats, setAddOpen }} />
          )}
          {tab === 'points' && <Points customers={customers} stats={stats} />}
          {tab === 'vouchers' && <Vouchers firsts={firsts} spendVoucher={spendVoucher} />}
          {tab === 'profile' && <Profile email={email} logout={logout} stats={stats} count={customers.length} />}
        </main>
      </div>
      <MobileNav tab={tab} setTab={setTab} />
      <AddDialog {...{ addOpen, setAddOpen, form, setForm, addCustomer, firsts, busy }} />
    </div>
  );
}

function Login({ email, setEmail, pass, setPass, login, busy }: {
  email: string; setEmail: (v: string) => void;
  pass: string; setPass: (v: string) => void; login: () => void; busy: boolean;
}) {
  return (
    <div className="min-h-screen grid-bg bg-primary flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card rounded-lg shadow-2xl border border-border p-8 animate-scale-in">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-9 h-9 rounded bg-primary flex items-center justify-center">
            <Icon name="ShieldCheck" className="text-primary-foreground" size={20} />
          </div>
          <span className="font-display font-bold text-lg tracking-tight">ЛОЯЛЬНОСТЬ<span className="text-accent">·CRM</span></span>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Кабинет продавца</p>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Электронная почта</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@company.ru" type="email" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Пароль</Label>
            <Input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" type="password" onKeyDown={(e) => e.key === 'Enter' && login()} />
          </div>
          <Button className="w-full" onClick={login} disabled={busy}>
            <Icon name={busy ? 'Loader2' : 'LogIn'} size={16} className={`mr-2 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Вход…' : 'Войти в систему'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground text-center mt-6">Демо-доступ: seller@company.ru / demo123</p>
      </div>
    </div>
  );
}

function Header({ tab, email }: { tab: NavKey; email: string }) {
  const title = nav.find((n) => n.key === tab)?.label;
  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-5 gap-3 sticky top-0 z-20">
      <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
        <Icon name="ShieldCheck" className="text-primary-foreground" size={16} />
      </div>
      <span className="font-display font-bold tracking-tight hidden sm:inline">ЛОЯЛЬНОСТЬ<span className="text-accent">·CRM</span></span>
      <span className="text-muted-foreground hidden sm:inline">/</span>
      <span className="text-sm font-medium">{title}</span>
      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="User" size={16} />
        <span className="hidden sm:inline tabular">{email}</span>
      </div>
    </header>
  );
}

function Sidebar({ tab, setTab }: { tab: NavKey; setTab: (k: NavKey) => void }) {
  return (
    <aside className="hidden md:flex flex-col w-52 border-r border-border bg-card py-4 shrink-0">
      {nav.map((n) => (
        <button
          key={n.key}
          onClick={() => setTab(n.key)}
          className={`flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-colors border-l-2 ${
            tab === n.key
              ? 'border-accent bg-secondary text-primary'
              : 'border-transparent text-muted-foreground hover:bg-secondary/60'
          }`}
        >
          <Icon name={n.icon} size={18} />
          {n.label}
        </button>
      ))}
    </aside>
  );
}

function MobileNav({ tab, setTab }: { tab: NavKey; setTab: (k: NavKey) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border flex z-20">
      {nav.map((n) => (
        <button key={n.key} onClick={() => setTab(n.key)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] ${tab === n.key ? 'text-accent' : 'text-muted-foreground'}`}>
          <Icon name={n.icon} size={18} />
          {n.label}
        </button>
      ))}
    </nav>
  );
}

function Stat({ icon, label, value, accent }: { icon: string; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded flex items-center justify-center ${accent ? 'bg-accent/10 text-accent' : 'bg-secondary text-primary'}`}>
        <Icon name={icon} size={20} />
      </div>
      <div>
        <div className="text-2xl font-bold tabular leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </div>
  );
}

function Customers({ customers, firsts, seconds, stats, setAddOpen }: {
  customers: Customer[]; firsts: Customer[]; seconds: Customer[]; stats: Stats; setAddOpen: (v: boolean) => void;
}) {
  const refName = (id: number | null) =>
    id ? customers.find((c: Customer) => c.id === id)?.name.split(' ').slice(0, 2).join(' ') : '—';
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold font-display">Покупатели</h1>
          <p className="text-sm text-muted-foreground">Первые и вторые покупатели, реферальные связи</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Icon name="UserPlus" size={16} className="mr-2" /> Добавить покупателя
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="Users" label="Всего покупателей" value={customers.length} />
        <Stat icon="Crown" label="Первые покупатели" value={firsts.length} />
        <Stat icon="Network" label="Вторые покупатели" value={seconds.length} />
        <Stat icon="Coins" label="Временных баллов" value={stats.totalTemp.toFixed(1)} accent />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ф.И.О.</th>
                <th className="px-4 py-3 font-medium">Телефон</th>
                <th className="px-4 py-3 font-medium">Тип</th>
                <th className="px-4 py-3 font-medium">Пригласил</th>
                <th className="px-4 py-3 font-medium">Товар</th>
                <th className="px-4 py-3 font-medium text-right">Объём, ₽</th>
                <th className="px-4 py-3 font-medium">Дата покупки</th>
                <th className="px-4 py-3 font-medium text-right">Покупки</th>
                <th className="px-4 py-3 font-medium text-right">Врем. баллы</th>
                <th className="px-4 py-3 font-medium text-right">Пожизн.</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: Customer) => (
                <tr key={c.id} className="border-t border-border hover:bg-secondary/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.name}<div className="text-xs text-muted-foreground font-normal">с {c.joined}</div></td>
                  <td className="px-4 py-3 tabular text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.type === 'first' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}>
                      {c.type === 'first' ? 'Первый' : 'Второй'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{refName(c.refId)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.productName || '—'}</td>
                  <td className="px-4 py-3 text-right tabular">{c.purchaseAmount ? c.purchaseAmount.toLocaleString('ru') : '—'}</td>
                  <td className="px-4 py-3 tabular text-muted-foreground">{c.purchaseDate || '—'}</td>
                  <td className="px-4 py-3 text-right tabular">{c.purchases}</td>
                  <td className="px-4 py-3 text-right tabular font-semibold">{c.tempPoints.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right tabular font-semibold text-accent">{c.lifePoints.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Points({ customers, stats }: { customers: Customer[]; stats: Stats }) {
  const firsts = customers.filter((c) => c.type === 'first');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-display">Баллы лояльности</h1>
        <p className="text-sm text-muted-foreground">1 балл = {RUB} ₽ · начисление 1 балл за каждую 1000 ₽ покупки · пожизненные лимит {LIFETIME_CAP}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat icon="Coins" label="Временные баллы" value={stats.totalTemp.toFixed(1)} />
        <Stat icon="Infinity" label="Пожизненные баллы" value={stats.totalLife.toFixed(1)} accent />
        <Stat icon="Wallet" label="Эквивалент, ₽" value={(stats.totalTemp * RUB).toLocaleString('ru')} />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Начисления по первым покупателям
        </div>
        <div className="divide-y divide-border">
          {firsts.map((c) => {
            const pct = Math.min((c.lifePoints / LIFETIME_CAP) * 100, 100);
            return (
              <div key={c.id} className="px-4 py-4">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <span className="font-medium">{c.name}</span>
                  <div className="flex gap-4 text-sm shrink-0">
                    <span className="tabular"><span className="text-muted-foreground">врем.</span> <b>{c.tempPoints.toFixed(1)}</b></span>
                    <span className="tabular text-accent"><span className="text-muted-foreground">пожизн.</span> <b>{c.lifePoints.toFixed(1)}</b></span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 tabular">{c.lifePoints.toFixed(1)} / {LIFETIME_CAP} пожизненных</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Vouchers({ firsts, spendVoucher }: { firsts: Customer[]; spendVoucher: (id: number) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-display">Фиолки</h1>
        <p className="text-sm text-muted-foreground">Выдано первым покупателям · до {VOUCHERS_PER_BATCH} шт. за раз</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {firsts.map((c) => (
          <div key={c.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-medium leading-tight">{c.name.split(' ').slice(0, 2).join(' ')}</div>
                <div className="text-xs text-muted-foreground tabular">{c.phone}</div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Первый</span>
            </div>
            <div className="flex gap-1.5 mb-4">
              {Array.from({ length: VOUCHERS_PER_BATCH }).map((_, i) => (
                <div key={i} className={`flex-1 h-9 rounded flex items-center justify-center ${i < c.vouchers ? 'bg-accent text-white' : 'bg-secondary text-muted-foreground'}`}>
                  <Icon name="Ticket" size={16} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm tabular"><b>{c.vouchers}</b> <span className="text-muted-foreground">из {VOUCHERS_PER_BATCH}</span></span>
              <Button size="sm" variant="outline" disabled={c.vouchers === 0} onClick={() => spendVoucher(c.id)}>
                <Icon name="Minus" size={14} className="mr-1" /> Списать
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Profile({ email, logout, stats, count }: {
  email: string; logout: () => void; stats: Stats; count: number;
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold font-display">Профиль продавца</h1>
        <p className="text-sm text-muted-foreground">Учётная запись и сводка</p>
      </div>
      <div className="bg-card border border-border rounded-lg p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
          <Icon name="User" size={26} />
        </div>
        <div>
          <div className="font-semibold">Продавец</div>
          <div className="text-sm text-muted-foreground tabular">{email}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat icon="Users" label="Покупателей внесено" value={count} />
        <Stat icon="Ticket" label="Активных фиолок" value={stats.totalVouchers} accent />
      </div>
      <div className="bg-card border border-border rounded-lg p-5 text-sm space-y-2">
        <div className="font-medium mb-1">Права доступа</div>
        {['Вносить данные покупателей', 'Просматривать баллы', 'Списывать выданные фиолки'].map((p) => (
          <div key={p} className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Check" size={15} className="text-accent" /> {p}
          </div>
        ))}
      </div>
      <Button variant="outline" onClick={logout}>
        <Icon name="LogOut" size={16} className="mr-2" /> Выйти
      </Button>
    </div>
  );
}

function AddDialog({ addOpen, setAddOpen, form, setForm, addCustomer, firsts, busy }: {
  addOpen: boolean; setAddOpen: (v: boolean) => void;
  form: Form; setForm: (v: Form) => void; addCustomer: () => void; firsts: Customer[]; busy: boolean;
}) {
  return (
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Новый покупатель</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            {(['first', 'second'] as const).map((t) => (
              <button key={t} onClick={() => setForm({ ...form, type: t })}
                className={`flex-1 py-2 rounded border text-sm font-medium transition ${form.type === t ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted-foreground'}`}>
                {t === 'first' ? 'Первый покупатель' : 'Второй покупатель'}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label>Ф.И.О.</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Иванов Иван Иванович" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 900 000-00-00" />
            </div>
            <div className="space-y-1.5">
              <Label>Дата рождения</Label>
              <Input type="date" value={form.birth} onChange={(e) => setForm({ ...form, birth: e.target.value })} />
            </div>
          </div>
          {form.type === 'second' && (
            <div className="space-y-1.5">
              <Label>По фиолке от (первый покупатель)</Label>
              <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">— выберите —</option>
                {firsts.map((c: Customer) => (
                  <option key={c.id} value={c.id}>{c.name} · фиолок: {c.vouchers}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Наименование товара</Label>
            <Input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="Например, кроссовки Air Max" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Объём покупки, ₽</Label>
              <Input type="number" min="0" value={form.purchaseAmount} onChange={(e) => setForm({ ...form, purchaseAmount: e.target.value })} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Дата покупки</Label>
              <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddOpen(false)} disabled={busy}>Отмена</Button>
          <Button onClick={addCustomer} disabled={busy}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}