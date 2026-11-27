//! Session-local host events (`shared/workbench/notifications.ts`). No remote source, no
//! persisted sample news: the list starts empty at launch and keeps the newest 20.

/// Most entries kept, newest first.
pub const MAX_NOTIFICATIONS: usize = 20;

/// One entry. `title` and `message` are untranslated catalogue keys; `params` fill `{0}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Notification {
    /// Entry identity.
    pub id: String,
    /// Title key.
    pub title: String,
    /// Message key.
    pub message: String,
    /// Values for `{0}`, `{1}`… in the message.
    pub params: Vec<String>,
    /// Optional untranslated detail (a plugin failure text).
    pub detail: Option<String>,
    /// Milliseconds since the Unix epoch.
    pub at: f64,
    /// Whether the entry was read.
    pub read: bool,
}

/// A change to the list (`NotificationAction`).
#[derive(Clone, Debug, PartialEq)]
pub enum NotificationAction {
    /// Adds an entry at the top.
    Add(Notification),
    /// Marks one entry read, or all of them with `None`.
    Read(Option<String>),
    /// Removes one entry.
    Dismiss(String),
    /// Empties the list.
    Clear,
}

/// `reduceNotifications`.
pub fn reduce_notifications(
    items: &[Notification],
    action: &NotificationAction,
) -> Vec<Notification> {
    match action {
        NotificationAction::Add(item) => std::iter::once(item.clone())
            .chain(items.iter().filter(|i| i.id != item.id).cloned())
            .take(MAX_NOTIFICATIONS)
            .collect(),
        NotificationAction::Clear => Vec::new(),
        NotificationAction::Dismiss(id) => items.iter().filter(|i| &i.id != id).cloned().collect(),
        NotificationAction::Read(id) => items
            .iter()
            .map(|i| Notification {
                read: i.read || id.as_ref().is_none_or(|id| *id == i.id),
                ..i.clone()
            })
            .collect(),
    }
}

/// Unread entries (the bell badge).
pub fn unread(items: &[Notification]) -> usize {
    items.iter().filter(|i| !i.read).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> Notification {
        Notification {
            id: id.into(),
            title: "Plugin instalado".into(),
            message: "“{0}” foi instalado. Ative quando quiser usar.".into(),
            params: vec!["Contador".into()],
            detail: None,
            at: 0.0,
            read: false,
        }
    }

    #[test]
    fn newest_first_capped_read_dismiss_clear() {
        let mut items = Vec::new();
        for i in 0..25 {
            items = reduce_notifications(&items, &NotificationAction::Add(item(&i.to_string())));
        }
        assert_eq!(items.len(), MAX_NOTIFICATIONS);
        assert_eq!(items[0].id, "24");
        // Re-adding an id moves it to the front without duplicating it.
        items = reduce_notifications(&items, &NotificationAction::Add(item("10")));
        assert_eq!(
            (items[0].id.as_str(), items.len()),
            ("10", MAX_NOTIFICATIONS)
        );
        items = reduce_notifications(&items, &NotificationAction::Read(Some("10".into())));
        assert_eq!(unread(&items), MAX_NOTIFICATIONS - 1);
        items = reduce_notifications(&items, &NotificationAction::Dismiss("24".into()));
        assert!(items.iter().all(|i| i.id != "24"));
        items = reduce_notifications(&items, &NotificationAction::Read(None));
        assert_eq!(unread(&items), 0);
        assert!(reduce_notifications(&items, &NotificationAction::Clear).is_empty());
    }
}
