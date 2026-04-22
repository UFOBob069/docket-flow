import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  forwardRef,
} from "react";

// --------------- BUTTON ---------------
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "pink";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const btnBase = "inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

const btnVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-sm hover:bg-primary-hover active:shadow-none",
  secondary: "bg-white text-text border border-border shadow-sm hover:bg-surface-alt active:bg-surface-alt",
  ghost: "text-text-secondary hover:bg-surface-alt active:bg-border/30",
  danger: "bg-danger-light text-danger border border-danger/20 hover:bg-danger/10",
  pink: "bg-pink text-white shadow-sm hover:bg-pink-hover",
};

const btnSizes: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2 rounded-lg gap-2",
  lg: "text-sm px-6 py-2.5 rounded-lg gap-2",
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className}`} {...props} />;
}

// --------------- INPUT ---------------
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", type, onClick, ...props }, ref) {
    const openDatePicker = (e: MouseEvent<HTMLInputElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || type !== "date") return;
      const el = e.currentTarget;
      if (typeof el.showPicker === "function") {
        try {
          el.showPicker();
        } catch {
          /* not a user gesture in some browsers */
        }
      }
    };

    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...props}
        type={type}
        onClick={type === "date" ? openDatePicker : onClick}
      />
    );
  }
);

// --------------- SELECT ---------------
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...props}
      />
    );
  }
);

// --------------- TEXTAREA ---------------
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={`w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...props}
      />
    );
  }
);

// --------------- LABEL ---------------
export function Label({ children, required, className = "" }: { children: ReactNode; required?: boolean; className?: string }) {
  return (
    <label className={`block text-sm font-medium text-text-secondary ${className}`}>
      {children}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </label>
  );
}

// --------------- CARD ---------------
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-b border-border px-6 py-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

// --------------- BADGE ---------------
type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "pink" | "trial" | "discovery" | "motions" | "pretrial" | "mediation" | "experts" | "other";

const badgeColors: Record<BadgeVariant, string> = {
  default: "bg-surface-alt text-text-secondary border-border",
  primary: "bg-primary-light text-primary border-primary/20",
  success: "bg-success-light text-success border-success/20",
  warning: "bg-warning-light text-warning border-warning/20",
  danger: "bg-danger-light text-danger border-danger/20",
  pink: "bg-pink-light text-pink border-pink/20",
  trial: "bg-red-50 text-cat-trial border-red-200",
  discovery: "bg-blue-50 text-cat-discovery border-blue-200",
  motions: "bg-purple-50 text-cat-motions border-purple-200",
  pretrial: "bg-amber-50 text-cat-pretrial border-amber-200",
  mediation: "bg-green-50 text-cat-mediation border-green-200",
  experts: "bg-cyan-50 text-cat-experts border-cyan-200",
  other: "bg-slate-50 text-cat-other border-slate-200",
};

export function Badge({ children, variant = "default", className = "" }: { children: ReactNode; variant?: BadgeVariant; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeColors[variant]} ${className}`}>
      {children}
    </span>
  );
}

// --------------- PAGE WRAPPER ---------------
export function PageWrapper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto max-w-[1280px] px-6 py-8 lg:px-8 lg:py-10 ${className}`}>
      {children}
    </div>
  );
}

// --------------- PAGE HEADER ---------------
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

// --------------- EMPTY STATE ---------------
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-alt/50 px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-light">
        <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --------------- SPINNER ---------------
export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-primary ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
