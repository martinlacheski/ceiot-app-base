import { Link } from "react-router";
import { LogOut, Menu, User, Lock } from "lucide-react";
import { useAuthStore } from "@/auth/store/auth.store";
import { showConfirmDialog } from "@/store/confirm.store";
import { ThemeToggle } from "@/components/custom/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SidebarHeaderProps {
  onMobileMenuOpen?: () => void;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  onMobileMenuOpen,
}) => {
  const { user, logout } = useAuthStore();

  const isAdmin = useAuthStore((state) => state.isAdmin());
  const userDisplayName = user?.fullName || user?.username || "Usuario";
  const userInitials = userDisplayName.substring(0, 2).toUpperCase();
  const userSubtitle = isAdmin ? "Administrador" : user?.email || "Cuenta";

  const handleLogout = () => {
    showConfirmDialog("¿Estás seguro de que deseas salir?", () => {
      logout();
    });
  };

  return (
    <header className="bg-background border-b border-border px-6 py-2 xl:py-3">
      <div className="flex items-center justify-between">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onMobileMenuOpen}
          className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5 text-muted-foreground" />
        </button>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`${userDisplayName} ${userSubtitle}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-foreground transition-colors hover:bg-accent outline-none focus:ring-2 focus:ring-ring"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                  {userInitials}
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-foreground">
                    {userDisplayName}
                  </span>
                  <span className="text-xs text-muted-foreground">{userSubtitle}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem asChild>
                <Link to="/app/profile" className="cursor-pointer">
                  <User className="mr-2 h-4 w-4" />
                  <span>Mi perfil</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/app/change-password" className="cursor-pointer">
                  <Lock className="mr-2 h-4 w-4" />
                  <span>Cambiar Contraseña</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-red-600 focus:text-red-600 cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Salir</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};
