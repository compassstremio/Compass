import { BingersApiError, bingersRequest } from "./client";
import { accessForError } from "./scrobble-body";
import { getSession, setAccess, setSession } from "./session";
import { parseMe } from "./tokens";

/** Reads who the grant belongs to and whether the account may use the API at all. */
export async function checkAccount(): Promise<void> {
  const owner = getSession();
  if (!owner) return;
  try {
    const me = parseMe(await bingersRequest<unknown>("/me"));
    const current = getSession();
    if (!current || current.connectedAt !== owner.connectedAt) return;
    setAccess("ok");
    if (me.name !== current.name || me.handle !== current.handle) {
      setSession({ ...current, name: me.name, handle: me.handle });
    }
  } catch (err) {
    if (getSession()?.connectedAt !== owner.connectedAt) return;
    const access = err instanceof BingersApiError ? accessForError(err.status, err.code) : null;
    if (access) setAccess(access);
  }
}
