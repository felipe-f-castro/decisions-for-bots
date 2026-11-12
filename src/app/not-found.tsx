import Link from "next/link";
import { Brand } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="error-page">
      <Brand />
      <h1>A little off track.</h1>
      <p>There isn’t a page here. Your decisions are waiting in your inbox.</p>
      <Link className="button button-primary" href="/">
        Back to my inbox
      </Link>
    </main>
  );
}
