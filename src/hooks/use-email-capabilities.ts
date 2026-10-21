import { useEffect, useState } from "react";
import {
  cachedEmailCapabilities,
  loadEmailCapabilities,
  NO_EMAIL,
  type EmailCapabilities,
} from "@/lib/account/email";

export function useEmailCapabilities(): EmailCapabilities {
  const [caps, setCaps] = useState<EmailCapabilities>(() => cachedEmailCapabilities() ?? NO_EMAIL);
  useEffect(() => {
    let live = true;
    void loadEmailCapabilities().then((next) => {
      if (live) setCaps(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return caps;
}
