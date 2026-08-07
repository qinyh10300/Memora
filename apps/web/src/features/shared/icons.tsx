import Image from "next/image";
import type { ReactNode } from "react";

import type { CurrentUser } from "./contracts";

export function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <Image alt="" height={1024} src="/memora-logo-owl-minimal-tight.png" width={1024} />
    </span>
  );
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CaptureIcon() {
  return (
    <Icon>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </Icon>
  );
}

export function LibraryIcon() {
  return (
    <Icon>
      <path d="M6 3h11a2 2 0 0 1 2 2v16H8a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1Z" />
      <path d="M5 17h14M9 7h6M9 10h5" />
    </Icon>
  );
}

export function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </Icon>
  );
}

export function AttachmentIcon() {
  return (
    <Icon>
      <path d="m20.5 11.5-8.7 8.7a6 6 0 0 1-8.5-8.5l9.4-9.4a4 4 0 0 1 5.7 5.7L9 17.4a2 2 0 0 1-2.8-2.8l8.7-8.7" />
    </Icon>
  );
}

export function GlobeIcon() {
  return (
    <Icon size={16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </Icon>
  );
}

export function SparkleIcon() {
  return (
    <Icon>
      <path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25Z" />
      <path d="m18.5 14 .75 2.25L21.5 17l-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75Z" />
    </Icon>
  );
}

export function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function PreviewIcon({ hidden = false }: { hidden?: boolean }) {
  return (
    <Icon size={16}>
      <path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </Icon>
  );
}

export function UserAvatar({
  user,
  src = user.avatar_url,
  className = "",
}: {
  user: Pick<CurrentUser, "display_name" | "avatar_url">;
  src?: string | null;
  className?: string;
}) {
  return (
    <span className={`user-avatar ${className}`} aria-hidden="true">
      <Image
        alt=""
        className="user-avatar-default"
        height={96}
        src="/memora-logo-owl-minimal-tight.png"
        width={96}
      />
      {src ? (
        <Image
          alt=""
          height={96}
          key={src}
          src={src}
          unoptimized
          width={96}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}
