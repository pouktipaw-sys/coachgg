import { redirect } from "next/navigation";
import { getCurrentUser } from "./session";

export async function requirePageUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
