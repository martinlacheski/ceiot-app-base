import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";

import { Footer } from "@/app/components/Footer";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "../components/Sidebar";
import { SidebarHeader } from "../components/SidebarHeader";

const DESKTOP_BREAKPOINT = 1024;

const getIsBelowBreakpoint = () =>
  typeof window !== "undefined" && window.innerWidth < DESKTOP_BREAKPOINT;

const MainLayout = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getIsBelowBreakpoint);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isBelowBreakpointRef = useRef(getIsBelowBreakpoint());

  useEffect(() => {
    const handleResize = () => {
      const isBelowBreakpoint = getIsBelowBreakpoint();

      // Only resync when the width crosses the 1024px threshold, so a
      // manual toggle by the user within the same range isn't overridden.
      if (isBelowBreakpoint !== isBelowBreakpointRef.current) {
        isBelowBreakpointRef.current = isBelowBreakpoint;
        setSidebarCollapsed(isBelowBreakpoint);
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
          <Sidebar
            isCollapsed={false}
            onToggle={() => {}}
            isMobile
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0">
        <SidebarHeader onMobileMenuOpen={() => setMobileOpen(true)} />

        <main className="flex-1 p-4 xl:p-5 2xl:p-6">
          <Outlet />
        </main>

        <Footer />
      </div>
    </div>
  );
};

export default MainLayout;
