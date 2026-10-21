import { useState } from "react";
import { ArrowLeft, Check, Loader2 } from "@/views/settings/icons";
import { recoverIdentity } from "@/lib/account/identity";
import { normaliseEmail, requestPasswordReset } from "@/lib/account/email";
import { accountErrorMessage, type AccountErrorMessage } from "@/lib/account/error-messages";
import { useEmailCapabilities } from "@/hooks/use-email-capabilities";
import { PasswordField, TextField } from "./fields";
import { RECOVERY_KEY_LENGTH, RecoveryKeyInput } from "./recovery-key-input";
import { useT } from "@/lib/i18n";
import { Section } from "@/views/settings/shared";
import { ROW_ACTION_PRIMARY } from "@/views/settings/kit";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

type Mode = "key" | "email";

export function AccountRecoverForm({
  onBack,
  onReset,
  inline = false,
}: {
  onBack: () => void;
  onReset: (newCode: string) => void;
  inline?: boolean;
}) {
  const t = useT();
  const caps = useEmailCapabilities();
  const [mode, setMode] = useState<Mode>("key");
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountErrorMessage | null>(null);

  const usernameOk = USERNAME_RE.test(username.trim());
  const keyReady = usernameOk && key.length >= RECOVERY_KEY_LENGTH && password.length >= 8;
  const emailReady = normaliseEmail(email) !== "";

  const submitKey = async () => {
    if (!keyReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { recoveryCode } = await recoverIdentity(username.trim(), key, password);
      onReset(recoveryCode);
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async () => {
    if (!emailReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSentTo(normaliseEmail(email));
    } catch (err) {
      setError(accountErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setSentTo(null);
  };

  const goBack = () => (mode === "key" ? onBack() : switchMode("key"));

  const heading = mode === "key" ? t("Reset your password") : t("Reset by email");
  const subheading =
    mode === "key"
      ? t(
          "Enter your username and the recovery key you saved. We'll set a new password and sign you in.",
        )
      : t(
          "Enter the email you confirmed on your account. We'll send a link to choose a new password.",
        );

  const errorLine = error && (
    <p
      role={inline ? "alert" : undefined}
      className={
        inline
          ? "rounded-md bg-danger/10 px-3.5 py-3 text-[15.5px] leading-[22px] text-danger"
          : "text-[12.5px] text-danger"
      }
    >
      {error.kind === "built-in" ? t(error.key) : error.detail}
    </p>
  );

  const submitClass = inline
    ? `${ROW_ACTION_PRIMARY} self-end justify-center`
    : "flex h-11 items-center justify-center gap-2 rounded-md bg-accent text-[14px] font-semibold text-canvas transition-all duration-150 hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100";

  const linkClass =
    "min-h-11 self-start text-[14px] font-medium text-ink-muted transition-colors hover:text-ink";

  const content = (
    <div
      className={inline ? "flex min-w-0 flex-col gap-6 pt-4" : "flex flex-col gap-6 bg-surface p-6"}
    >
      {!inline && (
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={goBack}
            aria-label={t("Back")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
          >
            <ArrowLeft size={17} strokeWidth={2} />
          </button>
          <div className="flex flex-col">
            <h2 className="text-[20px] font-semibold leading-7 tracking-tight text-ink">
              {heading}
            </h2>
            <p className="mt-1 text-[15px] leading-[22px] text-ink-muted">{subheading}</p>
          </div>
        </div>
      )}

      {mode === "key" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitKey();
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label={t("Username")}
            value={username}
            onChange={setUsername}
            placeholder={t("yourname")}
            maxLength={24}
            autoComplete="username"
          />
          <RecoveryKeyInput onChange={setKey} inline={inline} />
          <PasswordField
            label={t("New password")}
            value={password}
            onChange={setPassword}
            placeholder={t("At least 8 characters")}
            onEnter={submitKey}
          />

          {errorLine}

          <button type="submit" disabled={!keyReady || busy} className={submitClass}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {t("Reset password")}
          </button>

          {caps.email && (
            <button type="button" onClick={() => switchMode("email")} className={linkClass}>
              {t("Lost your recovery key? Reset by email")}
            </button>
          )}
        </form>
      )}

      {mode === "email" &&
        (sentTo ? (
          <p className="flex items-start gap-2.5 rounded-md bg-canvas px-3.5 py-3 text-[15px] leading-[22px] text-ink-muted">
            <Check size={16} strokeWidth={2.4} className="mt-0.5 shrink-0 text-success" />
            {t(
              "If {email} is confirmed on a Compass account, a reset link is on its way. It works once, for one hour.",
              { email: sentTo },
            )}
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitEmail();
            }}
            className="flex flex-col gap-4"
          >
            <TextField
              label={t("Email")}
              value={email}
              onChange={setEmail}
              placeholder={t("you@example.com")}
              maxLength={254}
              inputMode="email"
              autoComplete="email"
              onEnter={submitEmail}
            />

            {errorLine}

            <button type="submit" disabled={!emailReady || busy} className={submitClass}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {t("Send reset link")}
            </button>
          </form>
        ))}
    </div>
  );

  if (!inline) return content;
  return (
    <div className="hset-account-auth relative w-full max-w-[560px] [&_.hset-section-title]:pe-14 [&_.compass-settings-section>p]:pe-14 [&_label]:text-[16.5px] [&_label]:leading-6 [&_label~span]:text-[15.5px] [&_label~span]:leading-[22px] [&_input]:bg-elevated [&_input]:rounded-[10px]">
      <Section title={heading} subtitle={subheading}>
        {content}
      </Section>
      <button
        type="button"
        onClick={goBack}
        aria-label={t("Back")}
        className="absolute end-0 top-0 grid h-11 w-11 place-items-center rounded-md text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
      >
        <ArrowLeft size={17} strokeWidth={2} className="rtl:rotate-180" />
      </button>
    </div>
  );
}
