import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { OfflineBanner } from "./OfflineBanner";

const navItems = [
  { to: "/", label: "Дашборд", icon: "M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-18v6h8V3h-8z" },
  { to: "/orders", label: "Заказы", icon: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" },
  { to: "/clients", label: "Клиенты", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { to: "/catalog", label: "Справочник", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" },
  { to: "/settings", label: "Настройки", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function Layout() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const isMaster = profile?.role === "master";
  // Мастеру не показываем то, чем он не может пользоваться:
  // настройки (админ) и создание заказа (менеджер/админ)
  const visibleNav = navItems.filter(
    (item) => item.to !== "/settings" || profile?.role === "admin",
  );

  return (
    <div className="min-h-dvh md:flex">
      {/* Sidebar — планшет и ПК */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-surface">
        <div className="px-4 py-5">
          <span className="text-lg font-bold tracking-tight">ultra<span className="text-primary">CRM</span></span>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-primary/15 text-primary" : "text-muted hover:bg-surface-2 hover:text-text"
                }`
              }
            >
              <NavIcon d={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <p className="truncate px-2 text-sm">{profile?.full_name}</p>
          <p className="px-2 pb-2 text-xs text-muted">
            {profile?.role === "admin" ? "Администратор" : profile?.role === "manager" ? "Менеджер" : "Мастер"}
          </p>
          <button
            onClick={() => void signOut()}
            className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-text"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Контент */}
      <main className="flex-1 md:ml-56 pb-20 md:pb-6">
        <OfflineBanner />
        <Outlet />
      </main>

      {/* Нижняя навигация — смартфон */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.slice(0, 2).map((item) => (
          <MobileNavLink key={item.to} {...item} />
        ))}
        {!isMaster && (
          <button
            onClick={() => navigate("/orders/new")}
            className="flex flex-1 flex-col items-center justify-center py-2"
            aria-label="Новый заказ"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </button>
        )}
        {[navItems[2], ...(profile?.role === "admin" ? [navItems[4]] : [navItems[3]])].map((item) => (
          <MobileNavLink key={item.to} {...item} />
        ))}
      </nav>
    </div>
  );
}

function MobileNavLink({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? "text-primary" : "text-muted"}`
      }
    >
      <NavIcon d={icon} />
      {label}
    </NavLink>
  );
}
