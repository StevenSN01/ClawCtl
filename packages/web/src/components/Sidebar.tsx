import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  Activity,
  Radio,
  ShieldCheck,
  FileCode2,
  Wrench,
  Play,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sessions", label: "Sessions", icon: MessageSquare },
  { to: "/channels", label: "Channels", icon: Radio },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/security", label: "Security", icon: ShieldCheck },
  { to: "/config", label: "Config", icon: FileCode2 },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/operations", label: "Operations", icon: Play },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={`flex flex-col bg-deep border-r border-edge transition-all duration-200 ${collapsed ? "w-16" : "w-56"}`}>
      {/* Brand */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-edge">
        {!collapsed && (
          <span className="font-bold text-lg tracking-tight">
            <span className="text-brand">Claw</span>
            <span className="text-ink">Ctl</span>
          </span>
        )}
        <button onClick={onToggle} className="text-ink-3 hover:text-ink transition-colors p-1 rounded hover:bg-s1">
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? "bg-brand-dim text-brand shadow-glow-brand"
                  : "text-ink-2 hover:text-ink hover:bg-s1"
              }`
            }
          >
            <item.icon size={18} strokeWidth={1.8} className="shrink-0" />
            {!collapsed && <span className="font-medium">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Settings */}
      <div className="border-t border-edge py-3 px-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
              isActive
                ? "bg-brand-dim text-brand shadow-glow-brand"
                : "text-ink-2 hover:text-ink hover:bg-s1"
            }`
          }
        >
          <Settings size={18} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && <span className="font-medium">Settings</span>}
        </NavLink>
      </div>
    </aside>
  );
}
