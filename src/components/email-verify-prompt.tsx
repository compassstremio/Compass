import { useCallback, useEffect, useState } from "react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { fetchMe } from "@/lib/account/identity";
import { promptDue, verifyPromptState } from "@/lib/account/email-deadline";
import { currentAuthor, subscribeAuthor } from "@/lib/theme-auth";
import { useAccountCapabilities } from "@/hooks/use-account-capabilities";
import { useT } from "@/lib/i18n";
import { SButton } from "@/views/settings/ui";
import { AccountEmailCard } from "@/views/account/account-email-card";

const LATER_KEY = "compass.emailVerifyLater.";

function readLater(userId: string): number | null {
  try {
    const v = Number(localStorage.getItem(LATER_KEY + userId));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeLater(userId: string, at: number): void {
  try {
    localStorage.setItem(LATER_KEY + userId, String(at));
  } catch {
    /* a reminder that comes back sooner is the only cost */
  }
}

// Closed in this run of the app. Overdue prompts come back on the next launch.
const closedThisRun = new Set<string>();

export function EmailVerifyPrompt() {
  const t = useT();
  const caps = useAccountCapabilities();
  const [author, setAuthor] = useState(currentAuthor);
  const [open, setOpen] = useState(false);

  useEffect(() => subscribeAuthor(() => setAuthor(currentAuthor())), []);

  // /me is what starts the server's clock and carries emailVerifyBy.
  useEffect(() => {
    if (author && caps.email) void fetchMe();
  }, [author?.id, caps.email]);

  // The link is opened in a browser, so pick up the confirmation on return.
  const waiting = !!author?.emailPending && !author.emailVerified;
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => void fetchMe();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting]);

  const state = verifyPromptState(author, caps.email, Date.now());
  const userId = author?.id ?? "";

  useEffect(() => {
    if (state.kind === "none") {
      setOpen(false);
      return;
    }
    if (closedThisRun.has(userId)) return;
    if (promptDue(state, readLater(userId), Date.now())) setOpen(true);
  }, [state.kind, userId]);

  const onClosed = useCallback(() => {
    closedThisRun.add(userId);
    if (state.kind === "reminder") writeLater(userId, Date.now());
    setOpen(false);
  }, [userId, state.kind]);
  const { closing, close } = useModalExit(onClosed, open);

  if (!open || !author || state.kind === "none") return null;
  const overdue = state.kind === "overdue";

  return (
    <ModalShell closing={closing} onDismiss={close} width={600} labelledBy="email-verify-title">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h2 id="email-verify-title" className="text-[20px] font-semibold leading-7 text-ink">
            {overdue ? t("Confirm your email to unpause your account") : t("Confirm your email")}
          </h2>
          <p className="text-[15px] leading-[22px] text-ink-muted">
            {overdue
              ? t(
                  "Publishing, comments, ratings, friends and sync are paused until you confirm an email. Watching is not affected.",
                )
              : t(
                  "Confirm an email address to keep publishing, comments, ratings, friends and sync. It's also how you reset your password. Days left: {days}",
                  { days: state.daysLeft },
                )}
          </p>
        </div>
        <AccountEmailCard author={author} />
        <div className="flex justify-end">
          <SButton onClick={close}>{overdue ? t("Close") : t("Later")}</SButton>
        </div>
      </div>
    </ModalShell>
  );
}
