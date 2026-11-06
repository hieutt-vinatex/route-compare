import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useServices } from '@/hooks/useServices';
import { useTracking } from '@/hooks/useTracking';
import { COPY } from './copy';

const NAV: readonly { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Trang chủ', icon: 'home', end: true },
  { to: '/history', label: 'Lịch sử', icon: 'history' },
  { to: '/compare', label: 'So sánh', icon: 'compare' },
];

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold',
    isActive ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-100',
  ].join(' ');
}

function bottomNavClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-sm font-semibold',
    isActive ? 'text-teal-800' : 'text-slate-600',
  ].join(' ');
}

export function AppLayout() {
  const { gpsSource } = useServices();
  const tracking = useTracking();
  const location = useLocation();
  const onTracking = location.pathname === '/tracking';
  const active = tracking.status !== 'IDLE';

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Bỏ qua điều hướng
      </a>

      <aside className="hidden border-r border-slate-200 bg-white md:flex md:w-56 md:flex-col md:gap-1 md:p-3">
        <Link to="/" className="mb-3 px-3 py-2 text-xl font-extrabold text-teal-800">
          RouteTrack
        </Link>
        <nav aria-label="Điều hướng chính" className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false} className={navClass}>
              <Icon name={item.icon} /> {item.label}
            </NavLink>
          ))}
          {active && (
            <NavLink to="/tracking" className={navClass}>
              <Icon name="record" /> Đang đo
            </NavLink>
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 md:hidden">
          {onTracking ? (
            <Link
              to="/"
              className="flex min-h-11 items-center gap-1 text-sm font-semibold text-teal-800"
            >
              <Icon name="back" /> Trang chủ
            </Link>
          ) : (
            <Link to="/" className="text-lg font-extrabold text-teal-800">
              RouteTrack
            </Link>
          )}
          {active && !onTracking && (
            <Link
              to="/tracking"
              data-testid="active-trip-link"
              className="flex min-h-11 items-center gap-1 rounded-full bg-red-50 px-3 text-sm font-semibold text-red-900 ring-1 ring-red-300"
            >
              <Icon name="record" className="h-4 w-4" /> Đang đo
            </Link>
          )}
        </header>

        {gpsSource === 'demo' && (
          <div
            role="status"
            data-testid="demo-banner"
            className="bg-fuchsia-700 px-4 py-1.5 text-center text-sm font-bold text-white"
          >
            {COPY.demoGps}
          </div>
        )}

        <main id="main" className={`flex-1 ${onTracking ? 'pb-4' : 'pb-20'} md:pb-6`}>
          <Outlet />
        </main>
      </div>

      {!onTracking && (
        <nav
          aria-label="Điều hướng chính (di động)"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end ?? false} className={bottomNavClass}>
              <Icon name={item.icon} /> {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
