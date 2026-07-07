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
  type: string;
  refId: number | null;
  tempPoints: number;
  lifePoints: number;
  vouchers: number;
  purchases: number;
  joined: string;
  productName: string;
  purchaseAmount: number;
  purchaseDate: string;
  totalEarnedPoints: number;
  invitedCount: number;
  sellerName?: string | null;
  sellerEmail?: string | null;
};

type Seller = {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'seller';
  status: 'invited' | 'active' | 'blocked';
  invitedAt: string | null;
  activatedAt: string | null;
  customersCount: number;
};

const sellerNav = [
  { key: 'customers', label: 'Покупатели', icon: 'Users' },
  { key: 'points', label: 'Баллы', icon: 'Coins' },
  { key: 'vouchers', label: 'Фиолки', icon: 'Ticket' },
  { key: 'profile', label: 'Профиль', icon: 'UserCog' },
] as const;

const adminNav = [
  { key: 'sellers', label: 'Продавцы', icon: 'Users' },
  { key: 'allCustomers', label: 'Все покупатели', icon: 'Network' },
  { key: 'profile', label: 'Профиль', icon: 'UserCog' },
] as const;

type NavKey = (typeof sellerNav)[number]['key'] | (typeof adminNav)[number]['key'];
type Stats = { totalTemp: number; totalLife: number; totalVouchers: number };
type Form = {
  name: string; phone: string; birth: string; refId: string;
  productName: string; purchaseAmount: string; purchaseDate: string;
};

const EMPTY_FORM: Form = {
  name: '', phone: '', birth: '', refId: '',
  productName: '', purchaseAmount: '', purchaseDate: '',
};

export default function Index() {
  const [sellerId, setSellerId] = useState<number | null>(() => {
    const v = localStorage.getItem('sellerId');
    return v ? Number(v) : null;
  });
  const [email, setEmail] = useState(() => localStorage.getItem('sellerEmail') || '');
  const [role, setRole] = useState<'admin' | 'seller'>(() => (localStorage.getItem('sellerRole') as 'admin' | 'seller') || 'seller');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<NavKey>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ customer: Customer; invited: Customer[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const authed = sellerId !== null;
  const isAdmin = role === 'admin';

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

  const loadSellers = async (sid: number) => {
    try {
      const res = await fetch(`${API_URL}?action=list_sellers`, { headers: { 'X-Seller-Id': String(sid) } });
      const data = await res.json();
      if (res.ok) setSellers(data.sellers || []);
    } catch {
      toast.error('Не удалось загрузить продавцов');
    }
  };

  const loadAllCustomers = async (sid: number) => {
    try {
      const res = await fetch(`${API_URL}?action=all_customers`, { headers: { 'X-Seller-Id': String(sid) } });
      const data = await res.json();
      if (res.ok) setAllCustomers(data.customers || []);
    } catch {
      toast.error('Не удалось загрузить покупателей');
    }
  };

  useEffect(() => {
    if (sellerId === null) return;
    if (isAdmin) {
      loadSellers(sellerId);
      loadAllCustomers(sellerId);
    } else {
      loadCustomers(sellerId);
    }
  }, [sellerId, isAdmin]);

  const inviteSeller = async (inviteEmail: string, inviteName: string) => {
    try {
      const res = await fetch(`${API_URL}?action=invite_seller`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': String(sellerId) },
        body: JSON.stringify({ email: inviteEmail, name: inviteName }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Не удалось создать приглашение');
        return null;
      }
      await loadSellers(sellerId as number);
      return data.inviteToken as string;
    } catch {
      toast.error('Сервер недоступен');
      return null;
    }
  };

  const setSellerStatus = async (id: number, status: 'active' | 'blocked') => {
    try {
      const res = await fetch(`${API_URL}?action=set_seller_status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': String(sellerId) },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Не удалось изменить статус');
        return;
      }
      toast.success(status === 'blocked' ? 'Продавец заблокирован' : 'Продавец разблокирован');
      await loadSellers(sellerId as number);
    } catch {
      toast.error('Сервер недоступен');
    }
  };

  const openDetail = async (id: number) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}?action=customer_detail&id=${id}`, {
        headers: { 'X-Seller-Id': String(sellerId) },
      });
      const data = await res.json();
      if (res.ok) setDetail(data);
      else toast.error(data.error || 'Не удалось загрузить данные покупателя');
    } catch {
      toast.error('Сервер недоступен');
    } finally {
      setDetailLoading(false);
    }
  };

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
      localStorage.setItem('sellerRole', data.role);
      setSellerId(data.id);
      setEmail(data.email);
      setRole(data.role);
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
    localStorage.removeItem('sellerRole');
    setSellerId(null);
    setCustomers([]);
    setSellers([]);
    setAllCustomers([]);
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
        toast.success(`Пригласившему «${data.notify}» начислено ${pts} ${pts === 1 ? 'балл' : 'баллов'}. Отправлен PUSH.`, { icon: '🔔' });
      }
      toast.success('Покупатель добавлен, выдано 5 фиолок');
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

  const nav = isAdmin ? adminNav : sellerNav;
  const activeTab = isAdmin && (tab === 'customers' || tab === 'points' || tab === 'vouchers') ? 'sellers' : tab;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <Header tab={activeTab} email={email} nav={nav} isAdmin={isAdmin} />
      <div className="flex flex-1">
        <Sidebar tab={activeTab} setTab={setTab} nav={nav} />
        <main className="flex-1 p-5 md:p-8 max-w-[1400px] w-full mx-auto animate-fade-in pb-24 md:pb-8" key={activeTab}>
          {!isAdmin && activeTab === 'customers' && (
            <Customers {...{ customers, stats, setAddOpen, openDetail }} />
          )}
          {!isAdmin && activeTab === 'points' && <Points customers={customers} stats={stats} />}
          {!isAdmin && activeTab === 'vouchers' && <Vouchers customers={customers} spendVoucher={spendVoucher} />}
          {isAdmin && activeTab === 'sellers' && (
            <Sellers sellers={sellers} setInviteOpen={setInviteOpen} setSellerStatus={setSellerStatus} />
          )}
          {isAdmin && activeTab === 'allCustomers' && (
            <AllCustomers customers={allCustomers} openDetail={openDetail} />
          )}
          {activeTab === 'profile' && (
            <Profile email={email} logout={logout} stats={stats} count={isAdmin ? allCustomers.length : customers.length} sellerId={sellerId as number} isAdmin={isAdmin} />
          )}
        </main>
      </div>
      <MobileNav tab={activeTab} setTab={setTab} nav={nav} />
      {!isAdmin && <AddDialog {...{ addOpen, setAddOpen, form, setForm, addCustomer, customers, busy }} />}
      <CustomerDetailDialog
        open={detailId !== null}
        onOpenChange={(v) => !v && setDetailId(null)}
        loading={detailLoading}
        detail={detail}
      />
      {isAdmin && (
        <InviteSellerDialog open={inviteOpen} setOpen={setInviteOpen} inviteSeller={inviteSeller} />
      )}
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
        <p className="text-sm text-muted-foreground mb-6">Кабинет продавца и администратора</p>
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

type NavItem = { key: string; label: string; icon: string };

function Header({ tab, email, nav, isAdmin }: { tab: NavKey; email: string; nav: readonly NavItem[]; isAdmin: boolean }) {
  const title = nav.find((n) => n.key === tab)?.label;
  return (
    <header className="h-14 border-b border-border bg-card flex items-center px-5 gap-3 sticky top-0 z-20">
      <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
        <Icon name="ShieldCheck" className="text-primary-foreground" size={16} />
      </div>
      <span className="font-display font-bold tracking-tight hidden sm:inline">ЛОЯЛЬНОСТЬ<span className="text-accent">·CRM</span></span>
      <span className="text-muted-foreground hidden sm:inline">/</span>
      <span className="text-sm font-medium">{title}</span>
      {isAdmin && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">Админ</span>}
      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="User" size={16} />
        <span className="hidden sm:inline tabular">{email}</span>
      </div>
    </header>
  );
}

function Sidebar({ tab, setTab, nav }: { tab: NavKey; setTab: (k: NavKey) => void; nav: readonly NavItem[] }) {
  return (
    <aside className="hidden md:flex flex-col w-52 border-r border-border bg-card py-4 shrink-0">
      {nav.map((n) => (
        <button
          key={n.key}
          onClick={() => setTab(n.key as NavKey)}
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

function MobileNav({ tab, setTab, nav }: { tab: NavKey; setTab: (k: NavKey) => void; nav: readonly NavItem[] }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border flex z-20">
      {nav.map((n) => (
        <button key={n.key} onClick={() => setTab(n.key as NavKey)}
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

function Customers({ customers, stats, setAddOpen, openDetail }: {
  customers: Customer[]; stats: Stats; setAddOpen: (v: boolean) => void; openDetail: (id: number) => void;
}) {
  const refName = (id: number | null) =>
    id ? customers.find((c: Customer) => c.id === id)?.name.split(' ').slice(0, 2).join(' ') : '—';
  const invitersCount = customers.filter((c) => c.refId === null).length;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold font-display">Покупатели</h1>
          <p className="text-sm text-muted-foreground">Единая цепочка приглашений любой длины · нажмите на строку для подробностей</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Icon name="UserPlus" size={16} className="mr-2" /> Добавить покупателя
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="Users" label="Всего покупателей" value={customers.length} />
        <Stat icon="Crown" label="Без пригласившего" value={invitersCount} />
        <Stat icon="Network" label="По приглашению" value={customers.length - invitersCount} />
        <Stat icon="Coins" label="Временных баллов" value={stats.totalTemp.toFixed(1)} accent />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ф.И.О.</th>
                <th className="px-4 py-3 font-medium">Телефон</th>
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
                <tr key={c.id} onClick={() => openDetail(c.id)} className="border-t border-border hover:bg-secondary/40 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium">{c.name}<div className="text-xs text-muted-foreground font-normal">с {c.joined}</div></td>
                  <td className="px-4 py-3 tabular text-muted-foreground">{c.phone}</td>
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
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-display">Баллы лояльности</h1>
        <p className="text-sm text-muted-foreground">1 балл = {RUB} ₽ · начисление 1 балл за каждую 1000 ₽ покупки приглашённого · пожизненные лимит {LIFETIME_CAP}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat icon="Coins" label="Временные баллы" value={stats.totalTemp.toFixed(1)} />
        <Stat icon="Infinity" label="Пожизненные баллы" value={stats.totalLife.toFixed(1)} accent />
        <Stat icon="Wallet" label="Эквивалент, ₽" value={(stats.totalTemp * RUB).toLocaleString('ru')} />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground font-medium">
          Начисления по покупателям
        </div>
        <div className="divide-y divide-border">
          {customers.map((c) => {
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

function Vouchers({ customers, spendVoucher }: { customers: Customer[]; spendVoucher: (id: number) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-display">Фиолки</h1>
        <p className="text-sm text-muted-foreground">Выдаются каждому зарегистрированному покупателю · до {VOUCHERS_PER_BATCH} шт. за раз</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {customers.map((c) => (
          <div key={c.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-medium leading-tight">{c.name.split(' ').slice(0, 2).join(' ')}</div>
                <div className="text-xs text-muted-foreground tabular">{c.phone}</div>
              </div>
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

function Sellers({ sellers, setInviteOpen, setSellerStatus }: {
  sellers: Seller[]; setInviteOpen: (v: boolean) => void; setSellerStatus: (id: number, status: 'active' | 'blocked') => void;
}) {
  const statusLabel = { invited: 'Ждёт активации', active: 'Активен', blocked: 'Заблокирован' } as const;
  const statusClass = {
    invited: 'bg-secondary text-muted-foreground',
    active: 'bg-accent/10 text-accent',
    blocked: 'bg-destructive/10 text-destructive',
  } as const;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold font-display">Продавцы</h1>
          <p className="text-sm text-muted-foreground">Приглашение и управление доступом продавцов</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Icon name="UserPlus" size={16} className="mr-2" /> Пригласить продавца
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Имя</th>
                <th className="px-4 py-3 font-medium">Email (логин)</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium text-right">Покупателей</th>
                <th className="px-4 py-3 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-secondary/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 tabular text-muted-foreground">{s.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusClass[s.status]}`}>
                      {statusLabel[s.status]}
                    </span>
                    {s.role === 'admin' && (
                      <span className="ml-1.5 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Админ</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular">{s.customersCount}</td>
                  <td className="px-4 py-3 text-right">
                    {s.role !== 'admin' && s.status !== 'invited' && (
                      s.status === 'active' ? (
                        <Button size="sm" variant="outline" onClick={() => setSellerStatus(s.id, 'blocked')}>
                          <Icon name="Ban" size={14} className="mr-1" /> Заблокировать
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => setSellerStatus(s.id, 'active')}>
                          <Icon name="CheckCircle" size={14} className="mr-1" /> Разблокировать
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AllCustomers({ customers, openDetail }: { customers: Customer[]; openDetail: (id: number) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold font-display">Все покупатели</h1>
        <p className="text-sm text-muted-foreground">Покупатели всех продавцов системы · нажмите на строку для подробностей</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon="Users" label="Всего покупателей" value={customers.length} />
        <Stat icon="Coins" label="Временных баллов" value={customers.reduce((s, c) => s + c.tempPoints, 0).toFixed(1)} accent />
      </div>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Ф.И.О.</th>
                <th className="px-4 py-3 font-medium">Телефон</th>
                <th className="px-4 py-3 font-medium">Продавец</th>
                <th className="px-4 py-3 font-medium">Товар</th>
                <th className="px-4 py-3 font-medium text-right">Объём, ₽</th>
                <th className="px-4 py-3 font-medium text-right">Врем. баллы</th>
                <th className="px-4 py-3 font-medium text-right">Пожизн.</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} onClick={() => openDetail(c.id)} className="border-t border-border hover:bg-secondary/40 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium">{c.name}<div className="text-xs text-muted-foreground font-normal">с {c.joined}</div></td>
                  <td className="px-4 py-3 tabular text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.sellerName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.productName || '—'}</td>
                  <td className="px-4 py-3 text-right tabular">{c.purchaseAmount ? c.purchaseAmount.toLocaleString('ru') : '—'}</td>
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

function InviteSellerDialog({ open, setOpen, inviteSeller }: {
  open: boolean; setOpen: (v: boolean) => void; inviteSeller: (email: string, name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setName('');
    setEmail('');
    setLink('');
  };

  const submit = async () => {
    if (!email.includes('@')) {
      toast.error('Введите корректный email');
      return;
    }
    setBusy(true);
    const token = await inviteSeller(email, name);
    setBusy(false);
    if (token) {
      const url = `${window.location.origin}/invite?token=${token}`;
      setLink(url);
      toast.success('Приглашение создано');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    toast.success('Ссылка скопирована');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Пригласить продавца</DialogTitle>
        </DialogHeader>
        {!link ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Имя продавца</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванов Иван" />
            </div>
            <div className="space-y-1.5">
              <Label>Email (будет логином)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seller@company.ru" type="email" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Отправьте эту ссылку продавцу на почту — по ней он задаст пароль и войдёт в систему.</p>
            <div className="flex gap-2">
              <Input value={link} readOnly className="tabular text-xs" />
              <Button variant="outline" onClick={copyLink}>
                <Icon name="Copy" size={16} />
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>{link ? 'Готово' : 'Отмена'}</Button>
          {!link && (
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Создание…' : 'Создать приглашение'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Profile({ email, logout, stats, count, sellerId, isAdmin }: {
  email: string; logout: () => void; stats: Stats; count: number; sellerId: number; isAdmin: boolean;
}) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changing, setChanging] = useState(false);

  const changePassword = async () => {
    if (!oldPassword || newPassword.length < 3) {
      toast.error('Заполните текущий и новый пароль (минимум 3 символа)');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Новый пароль и подтверждение не совпадают');
      return;
    }
    setChanging(true);
    try {
      const res = await fetch(`${API_URL}?action=change_password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Seller-Id': String(sellerId) },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Не удалось сменить пароль');
        return;
      }
      toast.success('Пароль успешно изменён');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('Сервер недоступен');
    } finally {
      setChanging(false);
    }
  };

  const rights = isAdmin
    ? ['Приглашать и блокировать продавцов', 'Просматривать всех покупателей и баллы системы']
    : ['Вносить данные новых покупателей', 'Просматривать баллы', 'Списывать выданные фиолки'];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold font-display">{isAdmin ? 'Профиль администратора' : 'Профиль продавца'}</h1>
        <p className="text-sm text-muted-foreground">Учётная запись и сводка</p>
      </div>
      <div className="bg-card border border-border rounded-lg p-6 flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
          <Icon name="User" size={26} />
        </div>
        <div>
          <div className="font-semibold">{isAdmin ? 'Администратор' : 'Продавец'}</div>
          <div className="text-sm text-muted-foreground tabular">{email}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat icon="Users" label={isAdmin ? 'Покупателей в системе' : 'Покупателей внесено'} value={count} />
        <Stat icon="Ticket" label="Активных фиолок" value={stats.totalVouchers} accent />
      </div>
      <div className="bg-card border border-border rounded-lg p-5 text-sm space-y-2">
        <div className="font-medium mb-1">Права доступа</div>
        {rights.map((p) => (
          <div key={p} className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Check" size={15} className="text-accent" /> {p}
          </div>
        ))}
      </div>
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="font-medium">Смена пароля</div>
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Текущий пароль</Label>
          <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Новый пароль</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Повторите пароль</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && changePassword()} />
          </div>
        </div>
        <Button onClick={changePassword} disabled={changing}>
          <Icon name={changing ? 'Loader2' : 'KeyRound'} size={16} className={`mr-2 ${changing ? 'animate-spin' : ''}`} />
          {changing ? 'Сохранение…' : 'Сменить пароль'}
        </Button>
      </div>
      <Button variant="outline" onClick={logout}>
        <Icon name="LogOut" size={16} className="mr-2" /> Выйти
      </Button>
    </div>
  );
}

function AddDialog({ addOpen, setAddOpen, form, setForm, addCustomer, customers, busy }: {
  addOpen: boolean; setAddOpen: (v: boolean) => void;
  form: Form; setForm: (v: Form) => void; addCustomer: () => void; customers: Customer[]; busy: boolean;
}) {
  return (
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Новый покупатель</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
          <div className="space-y-1.5">
            <Label>Кто пригласил (необязательно)</Label>
            <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">— без приглашения —</option>
              {customers.map((c: Customer) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
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

function CustomerDetailDialog({ open, onOpenChange, loading, detail }: {
  open: boolean; onOpenChange: (v: boolean) => void; loading: boolean;
  detail: { customer: Customer; invited: Customer[] } | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Карточка покупателя</DialogTitle>
        </DialogHeader>
        {loading && (
          <div className="py-10 flex items-center justify-center text-muted-foreground">
            <Icon name="Loader2" size={20} className="animate-spin mr-2" /> Загрузка…
          </div>
        )}
        {!loading && detail && (
          <div className="space-y-5">
            <div>
              <div className="font-semibold text-lg">{detail.customer.name}</div>
              <div className="text-sm text-muted-foreground tabular">{detail.customer.phone}</div>
              <div className="text-xs text-muted-foreground mt-1">Покупатель с {detail.customer.joined}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Stat icon="UserPlus" label="Приглашено покупателей" value={detail.customer.invitedCount} accent />
              <Stat icon="Trophy" label="Заработано баллов всего" value={detail.customer.totalEarnedPoints.toFixed(1)} accent />
              <Stat icon="Coins" label="Временные баллы" value={detail.customer.tempPoints.toFixed(1)} />
              <Stat icon="Infinity" label="Пожизненные баллы" value={detail.customer.lifePoints.toFixed(1)} />
            </div>

            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Кого пригласил ({detail.invited.length})
              </div>
              {detail.invited.length === 0 && (
                <div className="px-4 py-4 text-sm text-muted-foreground">Пока никого не пригласил</div>
              )}
              <div className="divide-y divide-border max-h-56 overflow-y-auto">
                {detail.invited.map((c) => (
                  <div key={c.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground tabular">{c.phone}</div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular">
                      {c.purchaseAmount ? `${c.purchaseAmount.toLocaleString('ru')} ₽` : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}