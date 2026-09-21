// import { Logo } from "@/components/custom/Logo";

export const Footer = () => {
  return (
    <footer className="py-4 px-4 lg:px-8 mt-0">
      <div className="container mx-auto">
        {/* <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Logo />
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm">Enlaces</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <a href="#" className="hover:text-foreground">
                  Ubicación
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-sm">Ayuda</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <a href="#" className="hover:text-foreground">
                  Contacto
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-medium text-sm">Empresa</h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <a href="#" className="hover:text-foreground">
                  Sobre Nosotros
                </a>
              </li>
            </ul>
          </div>
        </div> */}

        <div className="pt-4 text-center text-xs text-muted-foreground">
          <p>
            &copy; {new Date().getFullYear()} Monitoreo Ambiental IoT · Todos
            los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};
