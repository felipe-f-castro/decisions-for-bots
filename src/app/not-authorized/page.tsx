import Link from "next/link";
import { Brand } from "@/components/brand";
import { signOut } from "@/app/actions";

export const dynamic = "force-dynamic";

export default function NotAuthorized() {
  return (
    <main className="error-page">
      <Brand />
      <h1>This inbox is by invitation.</h1>
      <p>
        Your email isn’t authorized to use this workspace. Ask the owner to add it to the allowed
        email list.
      </p>
      <form action={signOut}>
        <button className="button button-primary">Try another email</button>
      </form>
      <Link className="text-button" href="/login">
        Back to sign in
      </Link>
    </main>
  );
}
