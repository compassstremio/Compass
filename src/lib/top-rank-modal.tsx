import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type TopRankDept = "Acting" | "Directing" | "Production" | "Writing";

type Ctx = {
  openDept: TopRankDept | null;
  open: (dept: TopRankDept) => void;
  close: () => void;
};

const C = createContext<Ctx | null>(null);

export function TopRankModalProvider({ children }: { children: ReactNode }) {
  const [openDept, setOpenDept] = useState<TopRankDept | null>(null);
  const open = useCallback((dept: TopRankDept) => setOpenDept(dept), []);
  const close = useCallback(() => setOpenDept(null), []);
  // Stable value: a fresh object here re-rendered every RankBadge on every provider render.
  const value = useMemo<Ctx>(() => ({ openDept, open, close }), [openDept, open, close]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useTopRankModal(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useTopRankModal outside provider");
  return v;
}
