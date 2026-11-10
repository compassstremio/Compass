import type { CastMember } from "./types";
import { profileUrl } from "./utils";

export function CastChip({ member, onClick }: { member: CastMember; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open ${member.name}`}
      className="group/chip flex w-[68px] flex-shrink-0 flex-col items-center gap-1.5"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="h-12 w-12 overflow-hidden rounded-full border border-edge-soft bg-elevated/55 transition-[border-color,box-shadow] duration-200 group-hover/chip:border-ink group-hover/chip:ring-2 group-hover/chip:ring-ink/30">
        {member.profilePath ? (
          <img
            src={profileUrl(member.profilePath)}
            alt={member.name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] font-medium text-ink-subtle">
            {member.name.slice(0, 1)}
          </div>
        )}
      </div>
      <span className="line-clamp-1 w-full text-center text-[10.5px] text-ink transition-colors group-hover/chip:text-ink">
        {member.name.split(" ")[0]}
      </span>
    </button>
  );
}
