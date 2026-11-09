import { redirect } from "next/navigation";

// The v1 dashboard moves to /overview in WP-16.
export default function Page() {
  redirect("/lookup");
}
