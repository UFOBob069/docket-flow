import admin from "firebase-admin";

function init(): void {
  if (admin.apps.length) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!json) return;
  try {
    const creds = JSON.parse(json) as admin.ServiceAccount;
    admin.initializeApp({ credential: admin.credential.cert(creds) });
  } catch {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT_KEY JSON");
  }
}

init();

export function getAdminAuth(): admin.auth.Auth | null {
  if (!admin.apps.length) return null;
  return admin.auth();
}

export async function verifyIdToken(
  bearer: string | null
): Promise<{ uid: string } | null> {
  if (!bearer?.startsWith("Bearer ")) return null;
  const token = bearer.slice(7);
  const auth = getAdminAuth();
  if (!auth) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "FIREBASE_SERVICE_ACCOUNT_KEY missing — API auth skipped in development"
      );
      return { uid: "dev" };
    }
    return null;
  }
  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}
