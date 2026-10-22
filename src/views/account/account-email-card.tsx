import { useState } from "react";
import { Loader2, Mail } from "@/views/settings/icons";
import { attachEmail, normaliseEmail, resendEmailVerification } from "@/lib/account/email";
import { accountErrorMessage, type AccountErrorMessage } from "@/lib/account/error-messages";
import { fetchMe } from "@/lib/account/identity";
import { useAccountCapabilities } from "@/hooks/use-account-capabilities";
import type { Author } from "@/lib/theme-auth";
import { useT } from "@/lib/i18n";
import { SettingRow } from "@/views/settings/kit";
import { SButton } from "@/views/settings/ui";
import { TextField } from "./fields";

type Busy = "save" | "resend" | null;

export function AccountEmailCard({ author }: { author: Author }) {
  const t = useT();
  const caps = useAccountCapabilities();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [newsletter, setNewsletter] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AccountErrorMessage | null>(null);

  if (!caps.email) return null;

  const verified = author.emailVerified && author.email ? author.email : null;
  const pending = author.emailPending;
  const optIn = newsletter ?? caps.newsletter.defaultChecked;
  const draftOk = normaliseEmail(draft) !== "";

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
      await fetchMe();
      setSent(true);
      setEditing(false);
      setDraft("");
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!draftOk) return;
    void run("save", () => attachEmail(draft, caps.newsletter.enabled && optIn));
  };

  const desc = pending
    ? t("We sent a link to {email}. Open it to confirm the address.", { email: pending })
    : verified
      ? t("{email} · Confirmed", { email: verified })
      : t("Add an email so you can reset your password without the recovery key.");

  return (
    <SettingRow
      label={t("Email")}
      desc={desc}
      icon={<Mail size={18} />}
      wide={editing}
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex w-full max-w-[560px] flex-col gap-4"
        >
          <TextField
            label={verified ? t("New email") : t("Email")}
            value={draft}
            onChange={setDraft}
            placeholder={t("you@example.com")}
            maxLength={254}
            inputMode="email"
            autoComplete="email"
            autoFocus
            hint={
              verified
                ? t("Your current address stays until you confirm the new one.")
                : undefined
            }
            onEnter={save}
          />
          {caps.newsletter.enabled && (
            <label className="flex cursor-pointer items-start gap-2.5 text-[14px] leading-[21px] text-ink-muted transition-colors hover:text-ink">
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setNewsletter(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-edge bg-elevated accent-ink"
              />
              {caps.newsletter.label}
            </label>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error.kind === "built-in" ? t(error.key) : error.detail}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <SButton
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              {t("Cancel")}
            </SButton>
            <SButton variant="primary" onClick={save} disabled={!draftOk || !!busy}>
              {busy === "save" && <Loader2 size={15} className="animate-spin" />}
              {t("Send confirmation link")}
            </SButton>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {pending && (
              <SButton
                onClick={() => void run("resend", resendEmailVerification)}
                disabled={!!busy}
              >
                {busy === "resend" && <Loader2 size={15} className="animate-spin" />}
                {t("Resend")}
              </SButton>
            )}
            <SButton
              variant={verified || pending ? "secondary" : "primary"}
              onClick={() => {
                setEditing(true);
                setSent(false);
                setError(null);
              }}
            >
              {verified || pending ? t("Change") : t("Add email")}
            </SButton>
          </div>
          {sent && pending && (
            <span className="text-[13px] text-ink-muted">{t("Sent. Check your inbox.")}</span>
          )}
          {error && (
            <span role="alert" className="text-[13px] text-danger">
              {error.kind === "built-in" ? t(error.key) : error.detail}
            </span>
          )}
        </div>
      )}
    </SettingRow>
  );
}
