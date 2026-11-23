import type { SVGProps } from "react";

export type PrecisionIconName =
  | "about" | "audio" | "auto" | "check" | "close" | "display" | "expand"
  | "exit" | "gallery" | "hide" | "history" | "menu" | "preview" | "reset" | "restart"
  | "rollback" | "save" | "settings" | "skip" | "start" | "text";

interface PrecisionIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: PrecisionIconName;
  size?: number;
}

function IconGeometry({ name }: { name: PrecisionIconName }) {
  switch (name) {
    case "expand": return <><circle cx="6.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="17.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></>;
    case "preview": return <><rect x="4.25" y="4.25" width="15.5" height="15.5" rx="4" /><path d="m10.2 8.7 5.2 3.3-5.2 3.3Z" /><path className="precision-icon__accent" d="M7 2.75h4" /></>;
    case "rollback": return <><path d="M5.25 9.25A7.25 7.25 0 1 1 5.8 16" /><path d="m5.25 5.8-.1 3.55 3.55-.1" /><path className="precision-icon__accent" d="M12 8.2v4.1l2.8 1.7" /></>;
    case "auto": return <><circle cx="12" cy="12.5" r="7.2" /><path d="M9.4 3.2h5.2M12 5.3v2.1M12 12.5l3.1-2" /><path className="precision-icon__accent" d="M17.2 7.5 19 5.8" /></>;
    case "skip": return <><path d="m5.4 6.4 6.1 5.6-6.1 5.6ZM11.7 6.4l6.1 5.6-6.1 5.6Z" /><path className="precision-icon__accent" d="M19.2 6.2v11.6" /></>;
    case "save": return <><path d="M5 3.8h11.7L20 7.1v13.1H4V4.8Z" /><path d="M8 3.8v5h8v-5M7.5 20.2v-7.1h9v7.1" /><path className="precision-icon__accent" d="M13.8 5.7v1.4" /></>;
    case "history": return <><path d="M5.2 8.4A7.5 7.5 0 1 1 4.7 15M5.2 4.8v3.7H1.5M12 8v4.4l3 1.8" /><circle className="precision-icon__accent" cx="12" cy="12" r="1" /></>;
    case "settings": return <><path d="M4 6.5h7M15 6.5h5M4 12h3M11 12h9M4 17.5h9M17 17.5h3" /><circle cx="13" cy="6.5" r="2" /><circle className="precision-icon__accent" cx="9" cy="12" r="2" /><circle cx="15" cy="17.5" r="2" /></>;
    case "hide": return <><path d="M3.2 12s3.1-5 8.8-5 8.8 5 8.8 5-3.1 5-8.8 5-8.8-5-8.8-5Z" /><circle cx="12" cy="12" r="2.5" /><path className="precision-icon__accent" d="m4 4 16 16" /></>;
    case "menu": return <><path d="M8.5 6h11M8.5 12h11M8.5 18h11" /><circle cx="4.5" cy="6" r="1" /><circle className="precision-icon__accent" cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>;
    case "display": return <><rect x="3.2" y="4.5" width="17.6" height="12.5" rx="3" /><path d="M9 20h6M12 17v3" /><path className="precision-icon__accent" d="M6.5 8V7.2h3M17.5 13.5v.8h-3" /></>;
    case "text": return <><path d="M5 5.2h14M12 5.2v13.6M8.5 18.8h7" /><path className="precision-icon__accent" d="M5 8.2v-3h3M19 8.2v-3h-3" /></>;
    case "audio": return <><path d="M4 10v4h3.7l4.5 3.6V6.4L7.7 10ZM15.3 9.1a4 4 0 0 1 0 5.8M17.8 6.7a7.4 7.4 0 0 1 0 10.6" /><path className="precision-icon__accent" d="M4 10h3.7" /></>;
    case "start": return <><circle cx="12" cy="12" r="8.2" /><path d="m10.2 8.4 5.4 3.6-5.4 3.6Z" /><path className="precision-icon__accent" d="M12 2.2v2" /></>;
    case "restart": return <><path d="M5 8.5A8 8 0 1 1 4.7 16M5 4.7v3.9H1.2" /><path className="precision-icon__accent" d="m10.3 8.7 5 3.3-5 3.3Z" /></>;
    case "gallery": return <><rect x="3.5" y="4" width="17" height="16" rx="3.5" /><circle cx="9" cy="9" r="1.7" /><path d="m5.7 17 4.2-4.2 2.8 2.8 2.1-2.1 3.5 3.5" /><path className="precision-icon__accent" d="M16.5 6.5h1.5V8" /></>;
    case "about": return <><circle cx="12" cy="12" r="8.3" /><path d="M12 10.8v5.1" /><circle className="precision-icon__accent" cx="12" cy="7.5" r="1" /></>;
    case "exit": return <><path d="M10 4.2H5.2v15.6H10M14.2 8.2 18 12l-3.8 3.8M8.5 12H18" /><path className="precision-icon__accent" d="M12 3.2h7v17.6h-7" /></>;
    case "close": return <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />;
    case "reset": return <><path d="M5.1 8.8a7.5 7.5 0 1 1-.2 6.8M5.1 4.9v4H1.2" /><path className="precision-icon__accent" d="M12 7.8v4.5l-2.5 2" /></>;
    case "check": return <><path d="m5 12.4 4.2 4.2L19.3 6.5" /><path className="precision-icon__accent" d="M3 12.4h2M19.3 6.5l1.7-1.7" /></>;
  }
}

export function PrecisionIcon({ name, size = 20, className = "", ...props }: PrecisionIconProps) {
  return (
    <svg aria-hidden="true" className={`precision-icon ${className}`.trim()} data-precision-icon={name} fill="none" height={size} viewBox="0 0 24 24" width={size} {...props}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65" vectorEffect="non-scaling-stroke">
        <IconGeometry name={name} />
      </g>
    </svg>
  );
}
