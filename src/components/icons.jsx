function Icon({ className, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function PlusIcon({ className }) {
  return (
    <Icon className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

export function MinusIcon({ className }) {
  return (
    <Icon className={className}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
  );
}

export function CheckIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="20 6 9 17 4 12" />
    </Icon>
  );
}

export function ClockIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Icon>
  );
}

export function EditIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

export function TrashIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </Icon>
  );
}

export function FolderIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  );
}

export function ChevronRightIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="9 6 15 12 9 18" />
    </Icon>
  );
}

export function ChevronLeftIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="15 6 9 12 15 18" />
    </Icon>
  );
}

export function SearchIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </Icon>
  );
}

export function XIcon({ className }) {
  return (
    <Icon className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
  );
}

export function ExternalIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </Icon>
  );
}

export function RefreshIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10" />
    </Icon>
  );
}

// An arrow down onto a line: download.
export function DownloadIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 4v11" />
      <polyline points="7 10 12 15 17 10" />
      <path d="M4 20h16" />
    </Icon>
  );
}

// A brain, as liveboard's generate button: two lobes and a midline, which stay a brain at 12px with
// a stroke 2 wide (q's five-path outline closes into a blob that small). The prompt for an AI agent.
export function BrainIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 4.5A4.5 4.5 0 0 0 4 7.3 4 4 0 0 0 3.2 14 4.6 4.6 0 0 0 12 19.5" />
      <path d="M12 4.5A4.5 4.5 0 0 1 20 7.3 4 4 0 0 1 20.8 14 4.6 4.6 0 0 1 12 19.5" />
      <path d="M12 4.5v15" />
    </Icon>
  );
}

export function UserIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </Icon>
  );
}

export function ListIcon({ className }) {
  return (
    <Icon className={className}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="4" y2="6" />
      <line x1="3" y1="12" x2="4" y2="12" />
      <line x1="3" y1="18" x2="4" y2="18" />
    </Icon>
  );
}

export function BoardIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </Icon>
  );
}

export function PieIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M21 12A9 9 0 1 1 12 3" />
      <path d="M12 3a9 9 0 0 1 9 9h-9Z" />
    </Icon>
  );
}

// Run (Claude Code on a task): a play triangle.
export function PlayIcon({ className }) {
  return (
    <Icon className={className}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </Icon>
  );
}

// Stop a run: a square.
export function StopIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="6" y="6" width="12" height="12" />
    </Icon>
  );
}
