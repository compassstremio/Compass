import { CommunityBrowseList, type BrowseMode } from "./community-browse-list";

export function BrowsePane({
  mode,
  category,
  search,
  installedIds,
  onOpen,
  onRefetch,
}: {
  mode: BrowseMode;
  category: string | null;
  search?: string | null;
  installedIds: Set<string>;
  onOpen: (id: string) => void;
  onRefetch?: () => void;
}) {
  return (
    <CommunityBrowseList
      mode={mode}
      category={category}
      search={search}
      installedIds={installedIds}
      onOpen={onOpen}
      onChange={onRefetch}
    />
  );
}
