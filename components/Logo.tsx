export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-accent-600" />
      {/* a loop that returns to its start: "recall" */}
      <path
        d="M10.5 21.5V10.5h6.25a4.25 4.25 0 0 1 0 8.5H13.5l6.5 6"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="10.5" r="1.9" fill="white" opacity="0.85" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-lg font-semibold tracking-tight">Recall</span>
    </span>
  );
}
