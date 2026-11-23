import { redirect } from "next/navigation";
import { HOME_PATH } from "@/lib/supabase/config";

export default function Page() {
  redirect(HOME_PATH);
}
