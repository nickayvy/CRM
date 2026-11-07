import type { Metadata } from "next";
import { DesignShowcase } from "./showcase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Design system" };

export default function Page() {
  return <DesignShowcase />;
}
