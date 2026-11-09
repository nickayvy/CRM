import { Brand } from "./brand";
import { TOPBAR_CLASS } from "./topbar-class";

/** Chrome for /login and /signup: the branded header and a centred max-w-md column. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="main-depth flex min-h-svh flex-col">
      <header className={TOPBAR_CLASS}>
        <Brand />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
