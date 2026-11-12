export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M10 23V10m0 7h6a6 6 0 0 0 6-6V8M18.5 11.5 22 8l3.5 3.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="24" r="2" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span>
          decisions<span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
