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
  Receipt,
  ScanQrCode,
  Settings,
  Store,
  Users,
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
    { icon: Users, label: "Mi perfil", to: "/app/profile" },
    { icon: Store, label: "Establecimientos", to: "/app/environments" },
    ...(!isAdmin
      ? [{ icon: ScanQrCode, label: "Dispositivos", to: "/app/devices" }]
      : []),
    { icon: MapPin, label: "Mapa", to: "/app/map" },
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
              { icon: Users, label: "Usuarios", to: "/admin/users" },
              {
                icon: LockKeyhole,
                label: "Permisos",
                to: "/admin/permissions",
              },
              { icon: ScanQrCode, label: "Dispositivos", to: "/admin/devices" },
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
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
              ? "bg-gray-100 text-gray-900 border-r-2 border-primary"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
      className={`bg-gray-50 border-r border-gray-200 transition-all duration-300 ease-in-out  ${
        isCollapsed ? "w-20" : "w-72"
      } flex flex-col`}
    >
      {/* Header */}
      <div className="px-4 py-3 xl:py-4 flex items-center justify-between">
        {!isCollapsed && <Logo size="default" />}
        {!isMobile && (
          <button
            onClick={onToggle}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight size={20} />
            ) : (
              <ChevronLeft size={20} />
            )}
          </button>
        )}
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
          <div className="flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer">
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-700 font-semibold text-sm">
              {(user?.fullName || user?.username || "")
                .substring(0, 2)
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user?.fullName || user?.username}
              </p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
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
