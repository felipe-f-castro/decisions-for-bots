import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { PasswordForm } from "@/components/password-form";
import { getAccess, type Access } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  let access: Access;
  try {
    access = await getAccess();
  } catch {
    redirect("/login");
  }
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "needs-setup") redirect("/setup");
  if (access.kind === "denied") redirect("/not-authorized");
  return (
    <main className="error-page password-page">
      <Brand />
      <h1>Set your password.</h1>
      {access.kind === "demo" ? (
        <p>Passwords aren’t used in demo mode.</p>
      ) : (
        <>
          <p>
            Choose a new password for this workspace. You will need your current password to confirm
            the change.
          </p>
          <PasswordForm />
        </>
      )}
      <Link className="text-button" href="/">
        Back to your inbox
      </Link>
    </main>
  );
}
