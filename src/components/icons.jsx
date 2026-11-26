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

// Programming: the repository's source code, opened in VS Code.
export function CodeIcon({ className }) {
  return (
    <Icon className={className}>
      <polyline points="8 7 3 12 8 17" />
      <polyline points="16 7 21 12 16 17" />
      <line x1="14" y1="5" x2="10" y2="19" />
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

// A brain, the same one on every project's AI buttons (rab's 認識, liveboard's generate, q, tgen,
// stash): two lobes with their folds. The prompt for an AI agent.
export function BrainIcon({ className }) {
  return (
    <Icon className={className}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
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

// The scheduler: a sundial, its round dial with the gnomon standing in the middle and the hour
// marks around the lower half.
export function SundialIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 13V5l5 8Z" />
      <line x1="12" y1="17" x2="12" y2="19" />
      <line x1="6.5" y1="15.5" x2="7.9" y2="14.7" />
      <line x1="17.5" y1="15.5" x2="16.1" y2="14.7" />
    </Icon>
  );
}

// The day's calendar under the scheduler's page: a sheet with its two rings and the line under its head.
export function CalendarIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="3" y="5" width="18" height="16" rx="1" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </Icon>
  );
}

// How something is done: a question mark in a circle.
export function HelpCircleIcon({ className }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-2.9 2.6-2.9 4" />
      <line x1="12" y1="17.5" x2="12" y2="17.5" />
    </Icon>
  );
}

// The task panel (what the scheduler's button goes back to): a sheet with a ticked box and its lines.
export function TaskIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 9l1.5 1.5L12 8" />
      <line x1="14" y1="9" x2="16" y2="9" />
      <line x1="8" y1="15" x2="16" y2="15" />
    </Icon>
  );
}

// Machines (the computers Claude Code can be run on): a screen on its stand.
export function MonitorIcon({ className }) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <line x1="8" y1="20" x2="16" y2="20" />
      <line x1="12" y1="16" x2="12" y2="20" />
    </Icon>
  );
}

// The playlist (the runs of Claude Code still going): the lines of a list, a play triangle beside them.
export function PlaylistIcon({ className }) {
  return (
    <Icon className={className}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="12" y2="12" />
      <line x1="3" y1="18" x2="12" y2="18" />
      <polygon points="16 11 21 14.5 16 18 16 11" />
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
