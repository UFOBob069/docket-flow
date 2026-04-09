import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { ActivityAction, ActivityEntry, CalendarEvent, Case, Contact } from "@/lib/types";

/** Recursively strip `undefined` values from an object — Firestore rejects them. */
function clean<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(clean) as unknown as T;
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, clean(v)])
  ) as T;
}

/* ── Cases ────────────────────────────────────────────────────────── */

export function subscribeCase(
  db: Firestore,
  caseId: string,
  cb: (c: Case | null) => void
): Unsubscribe {
  return onSnapshot(doc(db, "cases", caseId), (snap) => {
    if (!snap.exists()) cb(null);
    else cb({ id: snap.id, ...(snap.data() as Omit<Case, "id">) });
  });
}

export function subscribeCases(
  db: Firestore,
  cb: (cases: Case[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "cases"),
    orderBy("updatedAt", "desc")
  );
  return onSnapshot(q, (snap) => {
    const list: Case[] = [];
    snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Case, "id">) }));
    cb(list);
  });
}

export async function fetchCasesWithEvents(
  db: Firestore
): Promise<{ case: Case; events: CalendarEvent[] }[]> {
  const q = query(
    collection(db, "cases"),
    orderBy("updatedAt", "desc")
  );
  const snap = await getDocs(q);
  const result: { case: Case; events: CalendarEvent[] }[] = [];
  for (const d of snap.docs) {
    const c = { id: d.id, ...(d.data() as Omit<Case, "id">) };
    const events = await fetchEventsForCase(db, c.id);
    result.push({ case: c, events });
  }
  return result;
}

export async function fetchEventsForCase(
  db: Firestore,
  caseId: string
): Promise<CalendarEvent[]> {
  const q = query(
    collection(db, "cases", caseId, "events"),
    orderBy("date", "asc")
  );
  const snap = await getDocs(q);
  const list: CalendarEvent[] = [];
  snap.forEach((d) =>
    list.push({ id: d.id, ...(d.data() as Omit<CalendarEvent, "id">) })
  );
  return list;
}

export function subscribeEvents(
  db: Firestore,
  caseId: string,
  cb: (events: CalendarEvent[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "cases", caseId, "events"),
    orderBy("date", "asc")
  );
  return onSnapshot(q, (snap) => {
    const list: CalendarEvent[] = [];
    snap.forEach((d) =>
      list.push({ id: d.id, ...(d.data() as Omit<CalendarEvent, "id">) })
    );
    cb(list);
  });
}

export async function createCase(
  db: Firestore,
  ownerId: string,
  input: Omit<
    Case,
    "id" | "ownerId" | "createdAt" | "updatedAt" | "assignedContactIds" | "status"
  > & { assignedContactIds?: string[] }
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, "cases"), clean({
    ...input,
    ownerId,
    status: "active" as const,
    assignedContactIds: input.assignedContactIds ?? [],
    createdAt: now,
    updatedAt: now,
  }));
  return ref.id;
}

export async function updateCase(
  db: Firestore,
  caseId: string,
  patch: Partial<Omit<Case, "id" | "ownerId">>
): Promise<void> {
  await updateDoc(doc(db, "cases", caseId), clean({
    ...patch,
    updatedAt: Date.now(),
  }));
}

export async function deleteCaseCascade(
  db: Firestore,
  caseId: string
): Promise<void> {
  const evSnap = await getDocs(collection(db, "cases", caseId, "events"));
  const batch = writeBatch(db);
  evSnap.forEach((d) => {
    batch.delete(d.ref);
  });
  batch.delete(doc(db, "cases", caseId));
  await batch.commit();
}

export async function setEventsForCase(
  db: Firestore,
  caseId: string,
  ownerId: string,
  events: CalendarEvent[]
): Promise<void> {
  const batch = writeBatch(db);
  for (const e of events) {
    const ref = doc(db, "cases", caseId, "events", e.id);
    batch.set(ref, clean({ ...e, caseId, ownerId }));
  }
  await batch.commit();
}

export async function saveEvent(
  db: Firestore,
  caseId: string,
  event: CalendarEvent
): Promise<void> {
  await setDoc(
    doc(db, "cases", caseId, "events", event.id),
    clean({ ...event, updatedAt: Date.now() }),
    { merge: true }
  );
}

export async function deleteEvent(
  db: Firestore,
  caseId: string,
  eventId: string
): Promise<void> {
  await deleteDoc(doc(db, "cases", caseId, "events", eventId));
}

/* ── Contacts ─────────────────────────────────────────────────────── */

export function subscribeContacts(
  db: Firestore,
  cb: (contacts: Contact[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "contacts"),
    orderBy("name")
  );
  return onSnapshot(q, (snap) => {
    const list: Contact[] = [];
    snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Contact, "id">) }));
    cb(list);
  });
}

export async function addContact(
  db: Firestore,
  ownerId: string,
  input: Omit<Contact, "id" | "ownerId" | "createdAt" | "updatedAt">
): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(collection(db, "contacts"), clean({
    ...input,
    ownerId,
    createdAt: now,
    updatedAt: now,
  }));
  return ref.id;
}

export async function updateContact(
  db: Firestore,
  contactId: string,
  patch: Partial<Omit<Contact, "id" | "ownerId">>
): Promise<void> {
  await updateDoc(doc(db, "contacts", contactId), clean({
    ...patch,
    updatedAt: Date.now(),
  }));
}

export async function deleteContact(
  db: Firestore,
  contactId: string
): Promise<void> {
  await deleteDoc(doc(db, "contacts", contactId));
}

/* ── Activity Log ──────────────────────────────────────────────────── */

export async function logActivity(
  db: Firestore,
  entry: Omit<ActivityEntry, "id" | "createdAt">
): Promise<void> {
  await addDoc(collection(db, "activity"), clean({
    ...entry,
    createdAt: Date.now(),
  }));
}

export function subscribeActivity(
  db: Firestore,
  max: number,
  cb: (entries: ActivityEntry[]) => void
): Unsubscribe {
  const q = query(
    collection(db, "activity"),
    orderBy("createdAt", "desc"),
    firestoreLimit(max)
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: ActivityEntry[] = [];
      snap.forEach((d) =>
        list.push({ id: d.id, ...(d.data() as Omit<ActivityEntry, "id">) })
      );
      cb(list);
    },
    (err) => {
      console.warn(
        "[firestore] activity listener:",
        err.message,
        "— deploy firestore.rules (match /activity/) or sign in with @ramosjames.com"
      );
      cb([]);
    }
  );
}

/* ── Bulk operations ───────────────────────────────────────────────── */

export async function bulkDeleteEvents(
  db: Firestore,
  caseId: string,
  eventIds: string[]
): Promise<void> {
  const batch = writeBatch(db);
  for (const eid of eventIds) {
    batch.delete(doc(db, "cases", caseId, "events", eid));
  }
  await batch.commit();
}

export async function bulkRescheduleEvents(
  db: Firestore,
  caseId: string,
  eventIds: string[],
  shiftDays: number
): Promise<void> {
  const batch = writeBatch(db);
  const snap = await getDocs(collection(db, "cases", caseId, "events"));
  for (const d of snap.docs) {
    if (!eventIds.includes(d.id)) continue;
    const ev = d.data() as CalendarEvent;
    const oldDate = new Date(ev.date + "T00:00:00");
    oldDate.setDate(oldDate.getDate() + shiftDays);
    const newDate = oldDate.toISOString().slice(0, 10);
    batch.update(d.ref, { date: newDate, updatedAt: Date.now() });
  }
  await batch.commit();
}
