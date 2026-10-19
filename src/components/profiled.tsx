import { Profiler, type ReactNode } from "react";
import { isProfilerRunning, recordRender } from "@/lib/memory-profiler";

/**
 * Routes React's own render timing into the memory profiler's report.
 *
 * The wrapper stays mounted on purpose: swapping it in when the HUD toggles would remount the
 * subtree under test and discard the state being measured. Until the profiler is started the
 * callback is inert, and an idle Profiler only costs the timing pair React already takes.
 */
export function Profiled({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler
      id={id}
      onRender={(_id, _phase, actualDuration) => {
        if (isProfilerRunning()) recordRender(id, actualDuration);
      }}
    >
      {children}
    </Profiler>
  );
}
