/** The Tylia mark: a "y" drawn as two graph lanes joining (same shape as the app icon). */
export function Logo({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="256 208 512 640"
      className={className}
      aria-hidden
      fill="none"
    >
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth={64}>
        <path d="M364 272 V372 C364 470 540 468 540 566" stroke="var(--lane-2)" />
        <path
          d="M664 272 V420 C664 520 540 500 540 600 V640 C540 730 420 720 420 790"
          stroke="var(--lane-1)"
        />
      </g>
      <g stroke="var(--bg-app)" strokeWidth={20}>
        <circle cx={364} cy={272} r={62} fill="var(--lane-2)" />
        <circle cx={664} cy={272} r={62} fill="var(--lane-1)" />
        <circle cx={420} cy={790} r={62} fill="var(--lane-1)" />
      </g>
    </svg>
  );
}
