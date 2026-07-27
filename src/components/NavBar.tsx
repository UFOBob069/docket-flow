"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth, userAvatarUrl, userDisplayName } from "@/context/AuthContext";
import { canAccessCalendarMissingSync } from "@/lib/calendar-gap-sync";
import { useEffect, useId, useState } from "react";

const FIRM_LOGO_PATH = "/firm-logo.webp";

const navLinks = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/calendar", label: "Calendar", match: (p: string) => p === "/calendar" },
  {
    href: "/calendar/missing-sync",
    label: "Missing sync",
    match: (p: string) => p.startsWith("/calendar/missing-sync"),
  },
  {
    href: "/cases",
    label: "Cases",
    match: (p: string) => p.startsWith("/cases") && p !== "/cases/new",
  },
  { href: "/cases/new", label: "New Case", match: (p: string) => p === "/cases/new" },
  {
    href: "/backfill",
    label: "Backfill",
    match: (p: string) => p.startsWith("/backfill"),
  },
  { href: "/contacts", label: "Contacts", match: (p: string) => p.startsWith("/contacts") },
  { href: "/faq", label: "FAQ", match: (p: string) => p.startsWith("/faq") },
];

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { user, logout, supabaseReady, loading } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const avatarSrc = user ? userAvatarUrl(user) : undefined;

  const visibleLinks = navLinks.filter(
    (l) => l.href !== "/calendar/missing-sync" || canAccessCalendarMissingSync(user?.email)
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy shadow-lg shadow-navy-deep/40">
      <div className="mx-auto flex max-w-[1360px] items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5 text-lg font-semibold tracking-tight text-white"
          onClick={() => setMenuOpen(false)}
        >
          {!logoError && (
            <Image
              src={FIRM_LOGO_PATH}
              alt="Firm logo"
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 rounded-md object-contain"
              onError={() => setLogoError(true)}
              unoptimized
            />
          )}
          <span className="font-serif">
            Docket<span className="text-pink">Flow</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden flex-1 items-center justify-end gap-1 lg:flex">
          {visibleLinks.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active ? "text-white" : "text-white/60 hover:text-white/90"
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
                  <span className="hidden text-xs text-white/70 xl:inline">
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

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white lg:hidden"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <MenuIcon open={menuOpen} />
        </button>
      </div>

      {/* Mobile panel */}
      {menuOpen && (
        <div
          id={menuId}
          className="border-t border-white/10 bg-navy lg:hidden"
        >
          <nav className="mx-auto flex max-w-[1360px] flex-col px-4 py-3 sm:px-6">
            {visibleLinks.map((l) => {
              const active = l.match(pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                  onClick={() => setMenuOpen(false)}
                >
                  {l.label}
                </Link>
              );
            })}

            {!loading && supabaseReady && (
              <div className="mt-2 border-t border-white/10 pt-3">
                {user ? (
                  <div className="flex flex-col gap-2 px-3 pb-2">
                    <div className="flex items-center gap-3">
                      {avatarSrc && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={avatarSrc}
                          alt=""
                          className="h-8 w-8 rounded-full ring-2 ring-white/20"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <span className="min-w-0 truncate text-sm text-white/70">
                        {userDisplayName(user) || user.email}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void logout();
                      }}
                      className="rounded-lg px-3 py-3 text-left text-base font-medium text-white/60 transition hover:bg-white/5 hover:text-white"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <Link
                    href="/login"
                    className="mx-3 mb-2 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
