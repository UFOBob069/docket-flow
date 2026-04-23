"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth, userAvatarUrl, userDisplayName } from "@/context/AuthContext";
import { useState } from "react";

const FIRM_LOGO_PATH = "/firm-logo.webp";

const navLinks = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/calendar", label: "Calendar", match: (p: string) => p.startsWith("/calendar") },
  {
    href: "/cases",
    label: "Cases",
    match: (p: string) => p.startsWith("/cases") && p !== "/cases/new",
  },
  { href: "/cases/new", label: "New Case", match: (p: string) => p === "/cases/new" },
  {
    href: "/import-calendar",
    label: "Import ICS",
    match: (p: string) => p.startsWith("/import-calendar"),
  },
  { href: "/contacts", label: "Contacts", match: (p: string) => p.startsWith("/contacts") },
];

export function NavBar() {
  const pathname = usePathname();
  const { user, logout, supabaseReady, loading } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const avatarSrc = user ? userAvatarUrl(user) : undefined;

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy shadow-lg shadow-navy-deep/40">
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-6 px-6 py-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white"
        >
          {!logoError && (
            <Image
              src={FIRM_LOGO_PATH}
              alt="Firm logo"
              width={32}
              height={32}
              className="h-8 w-8 rounded-md object-contain"
              onError={() => setLogoError(true)}
              unoptimized
            />
          )}
          <span className="font-serif">
            Docket<span className="text-pink">Flow</span>
          </span>
        </Link>

        <nav className="flex flex-1 items-center justify-end gap-1">
          {navLinks.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "text-white"
                    : "text-white/60 hover:text-white/90"
                }`}
              >
                {l.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-3 h-0.5 rounded-full bg-pink" />
                )}
              </Link>
            );
          })}

          <div className="ml-4 h-5 w-px bg-white/15" />

          {!loading && supabaseReady && (
            <div className="ml-3 flex items-center gap-3">
              {user ? (
                <>
                  {avatarSrc && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={avatarSrc}
                      alt=""
                      className="h-7 w-7 rounded-full ring-2 ring-white/20"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className="hidden text-xs text-white/70 sm:inline">
                    {userDisplayName(user) || user.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
                >
                  Sign in
                </Link>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
