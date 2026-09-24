import { useAuthStore } from "@/auth/store/auth.store";
import { Logo } from "@/components/custom/Logo";
import { showConfirmDialog } from "@/store/confirm.store";
import {
  // Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  // Droplet,
  // FileText,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPin,
  // MessageSquare,
  Radio,
  Receipt,
  ScanQrCode,
  Settings,
  Store,
  Users,
  History,
  Cpu,
  Gauge,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  isMobile?: boolean;
  onNavigate?: () => void;
}

interface MenuItem {
  icon?: LucideIcon;
  label: string;
  to?: string;
  children?: MenuItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggle,
  isMobile = false,
  onNavigate,
}) => {
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const isAdmin = useAuthStore((state) => state.isAdmin());

  const handleLogout = () => {
    showConfirmDialog("¿Estás seguro de que deseas salir?", () => {
      logout();
    });
  };

  const isActiveRoute = (path?: string) => {
    if (!path) return false;
    if (path === "/" && pathname !== "/") return false;
    if (path === "/app") {
      return pathname === "/app" || pathname === "/app/";
    }
    return pathname.startsWith(path);
  };

  // Check if any descendant is active to highlight parent or auto-expand
  const isChildActiveRecursive = (currentItem: MenuItem): boolean => {
    if (currentItem.to && isActiveRoute(currentItem.to)) return true;
    if (currentItem.children) {
      return currentItem.children.some(isChildActiveRecursive);
    }
    return false;
  };

  const menuItems: MenuItem[] = [
    // Dashboard items visible to all authenticated users
    {
      icon: LayoutDashboard,
      label: "Inicio",
      to: "/app",
    },
    { icon: MapPin, label: "Mapa", to: "/app/map" },
    { icon: Users, label: "Mi perfil", to: "/app/profile" },
    { icon: Store, label: "Establecimientos", to: "/app/environments" },
    ...(isAdmin
      ? [
          { icon: ScanQrCode, label: "Dispositivos", to: "/admin/devices" },
          { icon: Radio, label: "Emulador", to: "/admin/emulator" },
          {
            icon: ScanQrCode,
            label: "Vista de dispositivos",
            to: "/app/devices",
          },
          { icon: History, label: "Historial de dispositivos", to: "/app/devices/history" },
          ...(user?.permissions?.includes("sensor_catalog:read")
            ? [
                { icon: Cpu, label: "Sensores", to: "/admin/sensors" },
                { icon: Gauge, label: "Variables", to: "/admin/variables" },
              ]
            : []),
          { icon: Users, label: "Usuarios", to: "/admin/users" },
        ]
      : [
          { icon: ScanQrCode, label: "Dispositivos", to: "/app/devices" },
          { icon: History, label: "Historial de dispositivos", to: "/app/devices/history" },
        ]),
    // { icon: FileText, label: "Reportes", to: "/app/reports" },
    // { icon: Bell, label: "Notificaciones", to: "/notifications" },
    // { icon: MessageSquare, label: "Mensajes", to: "/messages" },
    // Admin specific items grouped under Settings
    ...(isAdmin
      ? [
          {
            icon: Settings,
            label: "Ajustes",
            children: [
              {
                icon: LockKeyhole,
                label: "Permisos",
                to: "/admin/permissions",
              },
              {
                icon: Store,
                label: "Tipos de Establecimientos",
                to: "/admin/environments/types",
              },
              {
                icon: MapPin,
                label: "Localización",
                children: [
                  { label: "Países", to: "/admin/locations/countries" },
                  { label: "Provincias", to: "/admin/locations/states" },
                  { label: "Ciudades", to: "/admin/locations/cities" },
                ],
              },

              {
                icon: Receipt,
                label: "Tipos de Documento",
                to: "/admin/identification-types",
              },
            ],
          },
        ]
      : []),
  ];

  // State to track expanded items by their label
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(
    () => {
      const initialExpanded: Record<string, boolean> = {};
      const traverse = (items: MenuItem[]) => {
        items.forEach((item) => {
          if (item.children) {
            if (isChildActiveRecursive(item)) {
              initialExpanded[item.label] = true;
            }
            traverse(item.children);
          }
        });
      };
      traverse(menuItems);
      return initialExpanded;
    },
  );

  const toggleExpand = (label: string) => {
    // If the sidebar is collapsed (icon-only mode), a click on an item with
    // children can't reveal its submenu in place — expand the whole sidebar
    // first so the user can see the options.
    if (isCollapsed) {
      onToggle();
      setExpandedItems((prev) => ({
        ...prev,
        [label]: true,
      }));
      return;
    }

    setExpandedItems((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  };

  // Recursively render menu items
  const renderMenuItem = (item: MenuItem, level: number = 0) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems[item.label];
    const isChildActive = hasChildren && isChildActiveRecursive(item);

    // Padding based on level for indentation
    const paddingLeft = level * 12 + 12;

    if (hasChildren) {
      return (
        <li key={item.label}>
          <div>
            <button
              onClick={() => toggleExpand(item.label)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition-all duration-200 group ${
                isChildActive || isExpanded
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
              style={level > 0 ? { paddingLeft: `${paddingLeft}px` } : {}}
            >
              <div className="flex items-center space-x-3">
                {Icon && <Icon size={20} className="flex-shrink-0" />}
                {!isCollapsed && (
                  <span className="font-medium text-sm">{item.label}</span>
                )}
              </div>
              {!isCollapsed && (
                <div className="flex items-center">
                  {/* Show ChevronDown/Right based on expansion */}
                  {isExpanded ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                </div>
              )}
            </button>
            {/* Submenu */}
            {!isCollapsed && isExpanded && (
              <ul className="mt-1 space-y-1 block">
                {item.children!.map((child) =>
                  renderMenuItem(child, level + 1),
                )}
              </ul>
            )}
          </div>
        </li>
      );
    }

    return (
      <li key={item.label}>
        <Link
          to={item.to || "#"}
          onClick={onNavigate}
          className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-all duration-200 group ${
            isActiveRoute(item.to)
              ? "bg-sidebar-accent text-sidebar-accent-foreground border-r-2 border-primary"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          }`}
          style={level > 0 ? { paddingLeft: `${paddingLeft}px` } : {}}
        >
          {Icon && <Icon size={20} className="flex-shrink-0" />}
          {/* If no icon and grouped, maybe add dot or indent? Indent handled by style */}
          {!isCollapsed && (
            <span className="font-medium text-sm">{item.label}</span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div
      className={`bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out  ${
        isCollapsed ? "w-20" : "w-72"
      } flex flex-col`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 xl:py-4">
        {!isCollapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Logo size="small" />
            <span className="truncate text-sm font-semibold text-sidebar-foreground">
              Monitoreo Ambiental IoT
            </span>
          </div>
        )}
        <div className={`flex justify-end ${isCollapsed ? "mx-auto" : "ml-auto"}`}>
          {!isMobile && (
            <button
              onClick={onToggle}
              className="rounded-lg p-2 transition-colors hover:bg-sidebar-accent"
            >
              {isCollapsed ? (
                <ChevronRight size={20} />
              ) : (
                <ChevronLeft size={20} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-2">
          {menuItems.map((item) => renderMenuItem(item))}
        </ul>
      </nav>

      {/* User Profile */}
      {!isCollapsed && (
        <div className="p-2">
          <div className="flex items-center space-x-3 p-2 rounded-lg hover:bg-sidebar-accent transition-colors cursor-pointer">
            <div className="w-8 h-8 bg-sidebar-accent rounded-full flex items-center justify-center text-sidebar-accent-foreground font-semibold text-sm">
              {(user?.fullName || user?.username || "")
                .substring(0, 2)
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user?.fullName || user?.username}
              </p>
              <p className="text-xs text-sidebar-foreground/70 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-sidebar-foreground/70 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
