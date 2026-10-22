import { useEffect, useState } from "react";
import {
  cachedAccountCapabilities,
  loadAccountCapabilities,
  NO_CAPABILITIES,
  type AccountCapabilities,
} from "@/lib/account/capabilities";

export function useAccountCapabilities(): AccountCapabilities {
  const [caps, setCaps] = useState<AccountCapabilities>(
    () => cachedAccountCapabilities() ?? NO_CAPABILITIES,
  );
  useEffect(() => {
    let live = true;
    void loadAccountCapabilities().then((next) => {
      if (live) setCaps(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return caps;
}
