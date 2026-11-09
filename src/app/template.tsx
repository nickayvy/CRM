import { PageTransition } from "@/lib/motion";

// Templates remount on every navigation, so each route change plays the enter transition.
export default function Template({ children }: { children: React.ReactNode }) {
  // h-full keeps the height chain from <main> intact so pages can use h-full (e.g. /lookup's panels).
  return <PageTransition className="h-full">{children}</PageTransition>;
}
