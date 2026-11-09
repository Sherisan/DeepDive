import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Icon({ children, ...p }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export const PliersIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 3l5 8 5-8" />
    <path d="M12 11l-4 10M12 11l4 10" />
    <circle cx="12" cy="11" r="1.5" />
  </Icon>
);

export const RadarIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <path d="M12 12l6-6" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </Icon>
);

export const ShieldIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
    <path d="M8.5 12l2.5 2.5 4.5-5" />
  </Icon>
);

export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const SoundIcon = ({ muted, ...p }: P & { muted?: boolean }) => (
  <Icon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    {muted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
  </Icon>
);

export const HelpIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5" />
    <circle cx="12" cy="17" r=".6" fill="currentColor" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const BoltIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
  </Icon>
);

export const StethoscopeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 3v5a5 5 0 0010 0V3" />
    <path d="M11 13v3a4 4 0 008 0v-2" />
    <circle cx="19" cy="12" r="2" />
  </Icon>
);
