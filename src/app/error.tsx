"use client";

import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/brand";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-page">
      <Brand />
      <h1>A small pause.</h1>
      <p>We couldn’t load your workspace. Give it another try.</p>
      <button className="button button-primary" onClick={reset}>
        Try again <ArrowRight size={16} />
      </button>
    </main>
  );
}
