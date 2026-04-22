"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getBrowserSupabase } from "@/lib/supabase/singleton";
import {
  addContact,
  deleteContact,
  subscribeContacts,
  updateContact,
} from "@/lib/supabase/repo";
import type { Contact, ContactRole } from "@/lib/types";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useHydrated } from "@/hooks/useHydrated";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Label,
  PageHeader,
  PageWrapper,
  Select,
} from "@/components/ui";

const roles: ContactRole[] = ["attorney", "paralegal", "legal_assistant", "other"];

const roleLabel: Record<ContactRole, string> = {
  attorney: "Attorney",
  paralegal: "Paralegal",
  legal_assistant: "Legal Assistant",
  other: "Other",
};

const roleBadge: Record<ContactRole, "primary" | "success" | "pink" | "default"> = {
  attorney: "primary",
  paralegal: "success",
  legal_assistant: "pink",
  other: "default",
};

export default function ContactsPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { user, loading, supabaseReady } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ContactRole>("paralegal");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseReady || loading || !user) return;
    const supabase = getBrowserSupabase();
    const unsub = subscribeContacts(supabase, user.id, setContacts);
    return () => unsub();
  }, [user, loading, supabaseReady]);

  useEffect(() => {
    if (!loading && supabaseReady && !user) router.replace("/login");
  }, [user, loading, supabaseReady, router]);

  const sorted = useMemo(
    () => [...contacts].sort((a, b) => a.name.localeCompare(b.name)),
    [contacts]
  );

  if (!hydrated) return <PageSkeleton />;

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setErr(null);
    setSaving(true);
    try {
      const supabase = getBrowserSupabase();
      await addContact(supabase, user.id, { name, email, role });
      setName("");
      setEmail("");
      setRole("paralegal");
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save contact");
    } finally {
      setSaving(false);
    }
  }

  async function onRoleChange(c: Contact, r: ContactRole) {
    const supabase = getBrowserSupabase();
    await updateContact(supabase, c.id, { role: r });
  }

  async function onDelete(c: Contact) {
    if (!confirm(`Delete ${c.name}?`)) return;
    const supabase = getBrowserSupabase();
    await deleteContact(supabase, c.id);
  }

  if (!isSupabaseConfigured()) {
    return (
      <PageWrapper>
        <p className="text-text-muted">Configure Supabase to manage contacts.</p>
      </PageWrapper>
    );
  }

  if (!user) return null;

  return (
    <PageWrapper>
      <PageHeader
        title="Contacts"
        subtitle="Attorneys, paralegals, and legal assistants invited to calendar events."
      />

      <Card className="mt-8">
        <CardHeader>
          <h2 className="text-sm font-semibold text-text">Add Contact</h2>
        </CardHeader>
        <CardBody>
          <form
            onSubmit={onAdd}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            <div className="sm:col-span-1 lg:col-span-2">
              <Label required>Name</Label>
              <Input
                required
                className="mt-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="sm:col-span-1 lg:col-span-2">
              <Label required>Email</Label>
              <Input
                type="email"
                required
                className="mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@ramosjames.com"
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select
                className="mt-1.5"
                value={role}
                onChange={(e) => setRole(e.target.value as ContactRole)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end sm:col-span-2 lg:col-span-5">
              <Button type="submit" disabled={saving} size="md">
                {saving ? "Saving…" : "Add Contact"}
              </Button>
            </div>
            {err && (
              <div className="sm:col-span-2 lg:col-span-5">
                <div className="rounded-lg border border-danger/20 bg-danger-light px-4 py-2" role="alert">
                  <p className="text-sm text-danger">{err}</p>
                </div>
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      {sorted.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No contacts yet"
            description="Add team members who should receive calendar invitations."
          />
        </div>
      ) : (
        <Card className="mt-8">
          <div className="divide-y divide-border">
            {sorted.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-text">{c.name}</p>
                    <Badge variant={roleBadge[c.role]}>{roleLabel[c.role]}</Badge>
                  </div>
                  <p className="truncate text-sm text-text-muted">{c.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Select
                    className="w-auto text-xs"
                    value={c.role}
                    onChange={(e) =>
                      void onRoleChange(c, e.target.value as ContactRole)
                    }
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel[r]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void onDelete(c)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </PageWrapper>
  );
}
