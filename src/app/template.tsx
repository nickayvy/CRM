import { PageTransition } from "@/lib/motion";

// Templates remount on every navigation, so each route change plays the enter transition.
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
