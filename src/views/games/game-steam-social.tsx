import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bookmark, Gift, RefreshCw, Users, X } from "lucide-react";
import { ModalShell, useModalExit } from "@/components/modal-shell";
import { useT, useUiLanguage } from "@/lib/i18n";
import { useSectionBack } from "@/lib/section-back";
import { loadSteamAppSummaries } from "@/lib/games/catalog";
import { steamAccountError } from "@/lib/games/steam-account";
import type { GameSummary } from "@/lib/games/types";
import type { SteamAccount } from "@/hooks/use-steam-account";
import { GameArt } from "./game-art";
import { useAccountDialogFocus } from "./game-steam-account";
import "./game-library-accounts.css";
import "./game-steam-social.css";

type Friend = { steamId: string; name: string; avatar: string; state: number; gameId?: number; game?: string };
type Friends = { visible: boolean; friends: Friend[]; updatedAt: number };
type Wishlist = { items: { appId: number; addedAt: number }[]; updatedAt: number };
type Tab = "friends" | "wishlist";
type Props = { account: SteamAccount; active: boolean; open: (game: GameSummary, origin?: HTMLElement) => void; saveMany: (games: GameSummary[]) => number };

/** Wishlist and friend activity read with the profile's own connected Steam key. */
export function GameSteamSocialControl(props: Props) {
  const t = useT(), [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => { if (!props.active || !props.account.status.connected) setTab(null); }, [props.active, props.account.status.connected]);
  if (!props.account.status.connected) return null;
  return <div className="games-library-account-control games-steam-social-control">
    <button className="games-button games-library-account-button" onClick={() => setTab("friends")}><Users size={18}/>{t("games.steamSocial.friends")}</button>
    <button className="games-button games-library-account-button" onClick={() => setTab("wishlist")}><Gift size={18}/>{t("games.steamSocial.wishlist")}</button>
    {tab && props.active && <SocialDialog {...props} tab={tab} setTab={setTab} close={() => setTab(null)}/>}
  </div>;
}

function SocialDialog({ account, open, saveMany, tab, setTab, close: onClose }: Props & { tab: Tab; setTab: (tab: Tab) => void; close: () => void }) {
  const t = useT(), id = useId(), root = useAccountDialogFocus(), { closing, close } = useModalExit(onClose);
  useSectionBack(close, true);
  const view = (game: GameSummary) => { close(); open(game); };
  return <ModalShell closing={closing} onDismiss={close} width={640} labelledBy={id} backdropClassName="games-account-backdrop"><div className="games-account-dialog games-steam-social" ref={root}>
    <header><div><p className="games-eyebrow">Steam · {account.status.snapshot?.name}</p><h2 id={id}>{t(tab === "friends" ? "games.steamSocial.friends" : "games.steamSocial.wishlist")}</h2></div><button className="games-icon-button" aria-label={t("common.close")} onClick={close}><X size={20}/></button></header>
    <div className="games-steam-social-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "friends"} onClick={() => setTab("friends")}><Users size={16}/>{t("games.steamSocial.friends")}</button>
      <button role="tab" aria-selected={tab === "wishlist"} onClick={() => setTab("wishlist")}><Gift size={16}/>{t("games.steamSocial.wishlist")}</button>
    </div>
    {tab === "friends" ? <FriendsPanel account={account} open={view}/> : <WishlistPanel account={account} saveMany={saveMany} open={view}/>}
  </div></ModalShell>;
}

const friendGame = (friend: Friend): GameSummary => ({ id: `steam:${friend.gameId}`, steamId: friend.gameId, name: friend.game ?? "", capsule: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${friend.gameId}/header.jpg`, platforms: [] });

function FriendsPanel({ account, open }: { account: SteamAccount; open: (game: GameSummary) => void }) {
  const t = useT(), [data, setData] = useState<Friends | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setError("");
    void invoke<Friends>("games_steam_friends", { profile: account.profile }).then(value => { if (current) setData(value); }, reason => { if (current) setError(steamAccountError(reason)); });
    return () => { current = false; };
  }, [account.profile, attempt]);
  const playing = data?.friends.filter(friend => friend.game || friend.gameId).length ?? 0;
  const status = (friend: Friend) => friend.game ? t("games.steamSocial.playing", { game: friend.game }) : t(`games.steamSocial.state.${friend.state}`);
  return <><div className="games-account-dialog-scroll">
    {error ? <div className="games-account-error" role="alert"><span>{t(error)}</span><button className="games-text-action" onClick={() => setAttempt(value => value + 1)}>{t("common.retry")}</button></div>
      : !data ? <p className="games-account-loading" role="status">{t("common.loading")}</p>
      : !data.visible ? <p className="games-steam-social-note">{t("games.steamSocial.private")}</p>
      : !data.friends.length ? <p className="games-steam-social-note">{t("games.steamSocial.noFriends")}</p>
      : <><p className="games-steam-social-note" role="status">{t("games.steamSocial.friendsSummary", { count: data.friends.length, playing })}</p>
        <ul className="games-steam-friends">{data.friends.map(friend => <li key={friend.steamId} data-state={friend.game || friend.gameId ? "playing" : friend.state ? "online" : "offline"}>
          <span className="games-steam-friend-avatar">{friend.avatar ? <GameArt src={friend.avatar}/> : <Users size={18}/>}</span>
          <span className="games-steam-friend-copy"><strong dir="auto">{friend.name}</strong><small dir="auto">{status(friend)}</small></span>
          {friend.gameId && <button className="games-text-action" onClick={() => open(friendGame(friend))}>{t("games.discovery.viewGame")}</button>}
        </li>)}</ul></>}
  </div><footer><span>{t("games.steamSocial.friendsNote")}</span><button className="games-button" disabled={!data && !error} onClick={() => { setData(null); setAttempt(value => value + 1); }}><RefreshCw size={16}/>{t("games.unified.refresh")}</button></footer></>;
}

function WishlistPanel({ account, saveMany, open }: { account: SteamAccount; saveMany: Props["saveMany"]; open: (game: GameSummary) => void }) {
  const t = useT(), language = useUiLanguage();
  const [games, setGames] = useState<GameSummary[] | null>(null), [total, setTotal] = useState(0), [error, setError] = useState(""), [attempt, setAttempt] = useState(0), [notice, setNotice] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setNotice(null);
    void (async () => {
      try {
        const wishlist = await invoke<Wishlist>("games_steam_wishlist", { profile: account.profile });
        if (controller.signal.aborted) return;
        setTotal(wishlist.items.length);
        const summaries = wishlist.items.length ? await loadSteamAppSummaries(wishlist.items.map(item => item.appId), controller.signal) : [];
        if (!controller.signal.aborted) setGames(summaries);
      } catch (reason) { if (!controller.signal.aborted) setError(typeof reason === "string" ? steamAccountError(reason) : "games.steamSocial.storeError"); }
    })();
    return () => controller.abort();
  }, [account.profile, attempt]);
  return <><div className="games-account-dialog-scroll">
    {error ? <div className="games-account-error" role="alert"><span>{t(error)}</span><button className="games-text-action" onClick={() => setAttempt(value => value + 1)}>{t("common.retry")}</button></div>
      : !games ? <p className="games-account-loading" role="status">{t("common.loading")}</p>
      : !games.length ? <p className="games-steam-social-note">{t(total ? "games.steamSocial.wishlistUnavailable" : "games.steamSocial.wishlistEmpty")}</p>
      : <><p className="games-steam-social-note" role="status">{t("games.steamSocial.wishlistSummary", { count: games.length.toLocaleString(language) })}</p>
        <ul className="games-steam-wishlist">{games.map(game => <li key={game.id}><button onClick={() => open(game)}><GameArt src={game.capsule}/><span dir="auto">{game.name}</span></button></li>)}</ul></>}
    {notice !== null && <p className="games-steam-social-note" role="status">{t(notice < 0 ? "games.steamSocial.saveFailed" : notice ? "games.steamSocial.saved" : "games.steamSocial.alreadySaved", { count: notice })}</p>}
  </div><footer><span>{t("games.steamSocial.wishlistNote")}</span><button className="games-button games-button-primary" disabled={!games?.length} onClick={() => { if (games) setNotice(saveMany(games)); }}><Bookmark size={16}/>{t("games.steamSocial.saveAll")}</button></footer></>;
}
