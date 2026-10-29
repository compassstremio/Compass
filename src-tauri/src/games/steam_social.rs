//! Read-only Steam wishlist and friend activity for the connected profile's own Web API key.
use super::steam_account::{client, credentials, image, now, request, text, valid_id};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;

type Result<T> = std::result::Result<T, &'static str>;
const WISHLIST_LIMIT: usize = 5000;
const FRIEND_LIMIT: usize = 1000;
const SUMMARY_BATCH: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WishlistItem {
    pub app_id: u32,
    pub added_at: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Wishlist {
    pub items: Vec<WishlistItem>,
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub steam_id: String,
    pub name: String,
    pub avatar: String,
    /// Steam persona state: 0 offline, 1 online, 2 busy, 3 away, 4 snooze, 5 trade, 6 play.
    pub state: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friends {
    /// False when the profile's friend list is private.
    pub visible: bool,
    pub friends: Vec<Friend>,
    pub updated_at: u64,
}

fn parse_wishlist(data: &Value) -> Vec<WishlistItem> {
    let mut items: Vec<WishlistItem> = data["response"]["items"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let app_id = u32::try_from(row["appid"].as_u64()?).ok().filter(|id| *id > 0)?;
                    Some(WishlistItem { app_id, added_at: row["date_added"].as_u64().unwrap_or_default() })
                })
                .take(WISHLIST_LIMIT)
                .collect()
        })
        .unwrap_or_default();
    items.sort_by(|a, b| b.added_at.cmp(&a.added_at).then(a.app_id.cmp(&b.app_id)));
    let mut seen = HashSet::new();
    items.retain(|item| seen.insert(item.app_id));
    items
}

fn friend_ids(data: &Value) -> Vec<String> {
    data["friendslist"]["friends"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter(|row| row["relationship"].as_str().unwrap_or("friend") == "friend")
                .map(|row| text(&row["steamid"], 20))
                .filter(|id| valid_id(id))
                .take(FRIEND_LIMIT)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_friend(row: &Value) -> Option<Friend> {
    let steam_id = text(&row["steamid"], 20);
    let name = text(&row["personaname"], 160);
    if !valid_id(&steam_id) || name.is_empty() {
        return None;
    }
    let game_id = text(&row["gameid"], 20).parse::<u32>().ok().filter(|id| *id > 0);
    let game = Some(text(&row["gameextrainfo"], 300)).filter(|value| !value.is_empty());
    let state = u8::try_from(row["personastate"].as_u64().unwrap_or_default()).ok().filter(|state| *state <= 6).unwrap_or_default();
    Some(Friend { steam_id, name, avatar: image(&row["avatarmedium"]), state, game_id, game })
}

/// Playing first, then online, then everyone else; names break ties.
fn order(friends: &mut [Friend]) {
    let rank = |friend: &Friend| (friend.game.is_none() && friend.game_id.is_none(), friend.state == 0);
    friends.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

pub async fn wishlist(root: PathBuf, profile: String) -> Result<Wishlist> {
    let (key, id) = credentials(&root, &profile)?;
    let data = request(&client()?, "IWishlistService/GetWishlist/v1/", &key, &[("steamid", id)]).await?;
    Ok(Wishlist { items: parse_wishlist(&data), updated_at: now() })
}

pub async fn friends(root: PathBuf, profile: String) -> Result<Friends> {
    let (key, id) = credentials(&root, &profile)?;
    let client = client()?;
    // The key was verified when the account connected, so a refusal here means a private list.
    let list = match request(&client, "ISteamUser/GetFriendList/v1/", &key, &[("steamid", id), ("relationship", "friend".into())]).await {
        Ok(list) => list,
        Err("steam_account_key") => return Ok(Friends { visible: false, friends: Vec::new(), updated_at: now() }),
        Err(error) => return Err(error),
    };
    let ids = friend_ids(&list);
    let mut friends = Vec::with_capacity(ids.len());
    for batch in ids.chunks(SUMMARY_BATCH) {
        let data = request(&client, "ISteamUser/GetPlayerSummaries/v2/", &key, &[("steamids", batch.join(","))]).await?;
        if let Some(rows) = data["response"]["players"].as_array() {
            friends.extend(rows.iter().filter_map(parse_friend));
        }
    }
    order(&mut friends);
    Ok(Friends { visible: true, friends, updated_at: now() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn wishlist_keeps_valid_apps_newest_first() {
        let data = json!({"response": {"items": [
            {"appid": 10, "date_added": 100}, {"appid": 0, "date_added": 900},
            {"appid": 30, "date_added": 70}, {"appid": 20, "date_added": 300},
            {"appid": "40"}, {"appid": 10, "date_added": 50}
        ]}});
        assert_eq!(parse_wishlist(&data), vec![
            WishlistItem { app_id: 20, added_at: 300 },
            WishlistItem { app_id: 10, added_at: 100 },
            WishlistItem { app_id: 30, added_at: 70 },
        ]);
        assert!(parse_wishlist(&json!({"response": {}})).is_empty());
    }

    #[test]
    fn friends_are_validated_and_playing_friends_come_first() {
        let list = json!({"friendslist": {"friends": [
            {"steamid": "76561197960265729", "relationship": "friend"},
            {"steamid": "bad", "relationship": "friend"},
            {"steamid": "76561197960265730", "relationship": "ignored"}
        ]}});
        assert_eq!(friend_ids(&list), vec!["76561197960265729".to_string()]);
        let mut friends: Vec<Friend> = [
            json!({"steamid": "76561197960265731", "personaname": "zed", "personastate": 0}),
            json!({"steamid": "76561197960265732", "personaname": "Amy", "personastate": 1}),
            json!({"steamid": "76561197960265733", "personaname": "Bo", "personastate": 1, "gameid": "570", "gameextrainfo": "Dota 2"}),
            json!({"steamid": "76561197960265734", "personaname": "", "personastate": 1}),
        ].iter().filter_map(parse_friend).collect();
        order(&mut friends);
        assert_eq!(friends.iter().map(|friend| friend.name.as_str()).collect::<Vec<_>>(), ["Bo", "Amy", "zed"]);
        assert_eq!(friends[0].game_id, Some(570));
        assert_eq!(friends[0].game.as_deref(), Some("Dota 2"));
    }
}
