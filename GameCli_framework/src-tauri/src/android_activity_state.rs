//! Activity-instance ownership, independent of JNI and the presentation layer.
//! A cached process may restore only the sole live replacement Activity, after
//! the old Tauri window has actually been removed.
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestoreTicket {
    pub activity: i32,
    revision: u64,
}

impl RestoreTicket {
    /// Wry's queued old-Activity cleanup is keyed by WebView label. Reusing
    /// "main" would let that cleanup erase the replacement's protocol/IPC.
    pub fn window_label(self) -> String {
        format!("main-restored-{:x}-{}", self.activity as u32, self.revision)
    }
}

#[derive(Default)]
pub struct ActivityRestoration {
    owner: Option<i32>,
    live: HashSet<i32>,
    pending: Option<RestoreTicket>,
    in_flight: Option<RestoreTicket>,
    revision: u64,
}

impl ActivityRestoration {
    pub fn initialize(&mut self, activity: i32) {
        self.live.insert(activity);
        self.owner = Some(activity);
    }

    pub fn created(&mut self, activity: i32) {
        self.live.insert(activity);
        if self.owner == Some(activity)
            || self.pending.is_some_and(|t| t.activity == activity)
        {
            return;
        }
        self.revision += 1;
        self.pending = Some(RestoreTicket { activity, revision: self.revision });
    }

    pub fn destroyed(&mut self, activity: i32, changing_configuration: bool) {
        if changing_configuration {
            // Wry retains/reuses this id during configuration recreation.
            return;
        }
        self.live.remove(&activity);
        if self.owner == Some(activity) {
            self.owner = None;
        }
        if self.pending.is_some_and(|t| t.activity == activity) {
            self.pending = None;
        }
    }

    pub fn claim(&mut self, windows_empty: bool) -> Option<RestoreTicket> {
        if !windows_empty || self.in_flight.is_some() || self.live.len() != 1 {
            return None;
        }
        let ticket = self.pending.filter(|t| self.live.contains(&t.activity))?;
        self.in_flight = Some(ticket);
        Some(ticket)
    }

    pub fn complete(&mut self, ticket: RestoreTicket, success: bool) -> bool {
        if self.in_flight != Some(ticket) {
            return false;
        }
        self.in_flight = None;
        if self.pending != Some(ticket) {
            return false;
        }
        // Failure requires an explicit retry/new lifecycle event. Do not
        // repeatedly create windows on every MainEventsCleared callback.
        self.pending = None;
        if success && self.live.contains(&ticket.activity) {
            self.owner = Some(ticket.activity);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_before_old_destroy_waits_for_both_context_and_window_removal() {
        let mut state = ActivityRestoration::default();
        state.initialize(1);
        state.created(2);
        assert_eq!(state.claim(false), None);
        assert_eq!(state.claim(true), None); // Tao still has two live contexts.
        state.destroyed(1, false);
        assert_eq!(state.claim(false), None);
        let ticket = state.claim(true).expect("restore the replacement");
        assert_eq!(ticket.activity, 2);
        assert!(state.complete(ticket, true));
        assert_eq!(state.owner, Some(2));
        state.destroyed(1, false); // A late old callback must not clear B.
        assert_eq!(state.owner, Some(2));
    }

    #[test]
    fn replacement_after_destroy_needs_an_actual_new_activity() {
        let mut state = ActivityRestoration::default();
        state.initialize(10);
        state.destroyed(10, false);
        assert_eq!(state.claim(true), None);
        state.created(20);
        let ticket = state.claim(true).unwrap();
        assert_eq!(ticket.activity, 20);
        assert!(state.complete(ticket, true));
    }

    #[test]
    fn configuration_recreation_keeps_the_existing_window() {
        let mut state = ActivityRestoration::default();
        state.initialize(1);
        state.created(1);
        state.destroyed(1, true);
        assert_eq!(state.claim(true), None);
        assert_eq!(state.owner, Some(1));
        assert!(state.live.contains(&1));
    }

    #[test]
    fn repeated_create_and_claim_do_not_duplicate_a_restore() {
        let mut state = ActivityRestoration::default();
        state.created(2);
        state.created(2);
        let ticket = state.claim(true).unwrap();
        assert_eq!(state.claim(true), None);
        state.created(2);
        assert!(state.complete(ticket, true));
        assert_eq!(state.claim(true), None);
    }

    #[test]
    fn destroyed_replacement_cannot_commit_or_restore() {
        let mut state = ActivityRestoration::default();
        state.created(2);
        let ticket = state.claim(true).unwrap();
        state.destroyed(2, false);
        assert!(!state.complete(ticket, true));
        assert_eq!(state.owner, None);
        assert_eq!(state.claim(true), None);
    }

    #[test]
    fn stale_success_and_failure_preserve_the_latest_request() {
        for success in [false, true] {
            let mut state = ActivityRestoration::default();
            state.created(2);
            let old = state.claim(true).unwrap();
            state.created(3);
            state.destroyed(2, false);
            assert!(!state.complete(old, success));
            let latest = state.claim(true).unwrap();
            assert_eq!(latest.activity, 3);
            assert!(state.complete(latest, true));
            assert!(!state.complete(old, success));
            assert_eq!(state.owner, Some(3));
        }
    }

    #[test]
    fn failed_restore_does_not_spin_and_explicit_retry_gets_a_new_ticket() {
        let mut state = ActivityRestoration::default();
        state.created(2);
        let first = state.claim(true).unwrap();
        assert!(!state.complete(first, false));
        assert_eq!(state.claim(true), None);
        state.created(2);
        let retry = state.claim(true).unwrap();
        assert_ne!(first, retry);
        assert!(state.complete(retry, true));
    }

    #[test]
    fn restored_labels_are_unique_across_retries_and_repeated_activity_ids() {
        let mut state = ActivityRestoration::default();
        let mut labels = HashSet::from(["main".to_owned()]);
        for id in [1, 1, -2, 1] {
            state.created(id);
            let ticket = state.claim(true).unwrap();
            assert!(labels.insert(ticket.window_label()));
            assert!(ticket.window_label().starts_with("main-restored-"));
            assert!(!state.complete(ticket, false));
            state.destroyed(id, false);
        }
    }
}
