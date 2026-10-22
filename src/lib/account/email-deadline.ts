const DAY_MS = 24 * 60 * 60 * 1000;

type DeadlineAuthor = {
  emailVerified?: boolean;
  emailVerifyBy?: string | null;
};

export type VerifyPromptState =
  | { kind: "none" }
  | { kind: "reminder"; daysLeft: number }
  | { kind: "overdue" };

// The server sets emailVerifyBy (identity/email.js) for a signed-in account with
// no confirmed address while email is on. Past it, account writes answer
// email_verification_required; reads and playback carry on.
export function verifyPromptState(
  author: DeadlineAuthor | null,
  emailOn: boolean,
  now: number,
): VerifyPromptState {
  if (!emailOn || !author || author.emailVerified || !author.emailVerifyBy) return { kind: "none" };
  const end = Date.parse(author.emailVerifyBy);
  if (!Number.isFinite(end)) return { kind: "none" };
  if (now >= end) return { kind: "overdue" };
  return { kind: "reminder", daysLeft: Math.max(1, Math.ceil((end - now) / DAY_MS)) };
}

// "Later" puts a reminder off for a day. Once overdue there is no Later: the
// prompt shows on every launch until the address is confirmed.
export function promptDue(
  state: VerifyPromptState,
  laterAt: number | null,
  now: number,
): boolean {
  if (state.kind === "none") return false;
  if (state.kind === "overdue") return true;
  return laterAt === null || now - laterAt >= DAY_MS;
}
