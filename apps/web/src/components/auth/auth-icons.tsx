/**
 * Icon helpers used by auth and marketing panels.
 */

type IconProps = {
  className?: string;
};

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function AuthLogoIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="2.5" {...stroke} />
      <circle cx="18" cy="6" r="2.5" {...stroke} />
      <circle cx="18" cy="18" r="2.5" {...stroke} />
      <path d="M8.4 11.2 15.4 7.2M8.4 12.8l6.8 4.2" {...stroke} />
    </svg>
  );
}

export function AuthSparkleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 13.4 8.6 18.5 10 13.4 11.4 12 16.5 10.6 11.4 5.5 10 10.6 8.6z" {...stroke} />
      <path d="M19 4.5v2M20 5.5h-2M5 18.5v2M6 19.5H4" {...stroke} />
    </svg>
  );
}

export function AuthEnvelopeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" {...stroke} />
      <path d="m4.5 7.5 7.5 5.5 7.5-5.5" {...stroke} />
    </svg>
  );
}

export function AuthLockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" {...stroke} />
      <path d="M8.5 10.5V8.5a3.5 3.5 0 0 1 7 0v2" {...stroke} />
    </svg>
  );
}

export function AuthCaptureIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" {...stroke} />
      <path d="M8.5 20.5h7M12 16.5v4" {...stroke} />
      <circle cx="12" cy="10.5" r="2.5" {...stroke} />
    </svg>
  );
}

export function AuthReviewIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 6.5h13v11.5H9.5L5.5 21.5V6.5z" {...stroke} />
      <path d="M9 10.5h6M9 13.5h4" {...stroke} />
    </svg>
  );
}

export function AuthDraftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 4.5h9l3 3v12.5H7.5V4.5z" {...stroke} />
      <path d="M16.5 4.5V7.5h3M10 12.5h6M10 15.5h4" {...stroke} />
    </svg>
  );
}
