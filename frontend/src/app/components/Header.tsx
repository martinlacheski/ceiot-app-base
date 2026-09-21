import { Logo } from "@/components/custom/Logo";
import { Button } from "@/components/ui/button";
import { showConfirmDialog } from "@/store/confirm.store";
import { Lock, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { useAuthStore } from "@/auth/store/auth.store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Header = () => {
  const { authStatus, isAdmin, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    showConfirmDialog("¿Estás seguro que deseas salir?", () => {
      logout();
      navigate("/auth/login");
    });
  };

  // State for Dropdown Menu
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b backdrop-blur bg-gray-50">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Logo />

          <div className="flex items-center space-x-4">
            {authStatus === "not-authenticated" ? (
              <Link to="/auth/login">
                <Button variant="default" size="sm" className="ml-2">
                  Login
                </Button>
              </Link>
            ) : (
              <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-2 cursor-pointer"
                  >
                    <UserIcon className="h-4 w-4" />
                    Mi cuenta
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/app/profile" className="cursor-pointer">
                      <UserIcon className="mr-2 h-4 w-4" />
                      <span>Información Personal</span>
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
                    className="text-red-500 focus:text-red-500 cursor-pointer"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Salir</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {isAdmin() && (
              <Link to="/admin">
                <Button
                  variant="destructive"
                  size="sm"
                  className="ml-2 cursor-pointer"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Panel
                </Button>
              </Link>
            )}

            {authStatus === "authenticated" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="ml-2 gap-2 text-red-500 hover:text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Salir
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
