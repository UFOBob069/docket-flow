export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8" aria-busy="true">
      <div className="h-9 w-56 max-w-full animate-pulse rounded-lg bg-border/60" />
      <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-border/40" />
      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="h-40 animate-pulse rounded-2xl bg-border/30" />
        <div className="h-40 animate-pulse rounded-2xl bg-border/30" />
        <div className="h-40 animate-pulse rounded-2xl bg-border/30" />
      </div>
    </div>
  );
}

export function NarrowPageSkeleton() {
  return (
    <div className="mx-auto max-w-md px-6 py-20" aria-busy="true">
      <div className="h-8 w-48 max-w-full animate-pulse rounded-lg bg-border/60" />
      <div className="mt-2 h-4 w-64 max-w-full animate-pulse rounded bg-border/40" />
      <div className="mt-10 h-10 w-full animate-pulse rounded-xl bg-border/30" />
      <div className="mt-4 h-10 w-full animate-pulse rounded-xl bg-border/30" />
      <div className="mt-6 h-11 w-full animate-pulse rounded-lg bg-border/50" />
    </div>
  );
}
