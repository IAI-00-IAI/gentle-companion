//! Recent activity per session, kept in memory so a browser that reconnects or reopens can
//! replay what it missed instead of waiting for the next live event.
//!
//! Every recorded message gets a per-session `seq`. The UI rebuilds its feed from the log and
//! then ignores live frames whose `seq` it has already applied, so fetch and stream can overlap.

use std::collections::{HashMap, VecDeque};

use serde_json::{Value, json};

/// Messages kept per session. Consecutive text deltas are merged, so this covers many turns.
const MAX_MESSAGES: usize = 800;
/// A single merged text block is capped so one long reply cannot grow without bound.
const MAX_TEXT_BYTES: usize = 64 * 1024;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Default)]
pub struct ActivityLog {
    seq: u64,
    messages: VecDeque<Value>,
}

impl ActivityLog {
    /// Record a bridge message and return it stamped with its `seq`.
    pub fn record(&mut self, mut message: Value) -> Value {
        self.seq += 1;
        let seq = self.seq;
        if let Some(object) = message.as_object_mut() {
            object.insert("seq".into(), json!(seq));
            // Original time, so a replayed feed shows when things happened, not when it loaded.
            object.entry("at").or_insert_with(|| json!(now_ms()));
        }
        if !self.merge_delta(&message, seq) {
            self.messages.push_back(message.clone());
            while self.messages.len() > MAX_MESSAGES {
                self.messages.pop_front();
            }
        }
        message
    }

    /// Fold a streaming text delta into the previous delta of the same kind.
    fn merge_delta(&mut self, message: &Value, seq: u64) -> bool {
        if message.get("event").and_then(Value::as_str) != Some("assistant.delta") {
            return false;
        }
        let Some(last) = self.messages.back_mut() else { return false };
        if last.get("event").and_then(Value::as_str) != Some("assistant.delta") {
            return false;
        }
        let kind = |value: &Value| value.pointer("/payload/kind").and_then(Value::as_str).unwrap_or("text").to_string();
        if kind(last) != kind(message) {
            return false;
        }
        let delta = message.pointer("/payload/delta").and_then(Value::as_str).unwrap_or_default();
        let Some(text) = last.pointer_mut("/payload/delta") else { return false };
        let Some(current) = text.as_str() else { return false };
        if current.len() + delta.len() > MAX_TEXT_BYTES {
            return false;
        }
        *text = Value::String(format!("{current}{delta}"));
        last["seq"] = json!(seq);
        true
    }

    pub fn snapshot(&self) -> Value {
        json!({ "seq": self.seq, "messages": self.messages })
    }

    /// Whether anything the agent or its tools produced contains `needle`. What people typed
    /// into the companion is excluded, so a prompt cannot vouch for a path or URL.
    pub fn mentions(&self, needle: &str, kind: MentionKind) -> bool {
        if needle.is_empty() {
            return false;
        }
        self.messages
            .iter()
            .filter(|message| message.get("event").and_then(Value::as_str) != Some("user.message"))
            .any(|message| contains_text(message, needle, kind))
    }
}

/// What a mentioned reference is, which decides where it may continue after the match.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MentionKind {
    /// `http://localhost:3000`: may be followed by a path, but not by more of the host or port.
    Origin,
    /// A file path or name: may not continue into a longer name, extension or sub-path.
    Path,
}

fn contains_text(value: &Value, needle: &str, kind: MentionKind) -> bool {
    match value {
        Value::String(text) => contains_reference(text, needle, kind),
        Value::Array(items) => items.iter().any(|item| contains_text(item, needle, kind)),
        Value::Object(fields) => fields.values().any(|field| contains_text(field, needle, kind)),
        _ => false,
    }
}

fn is_name_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '-'
}

/// Whether `text` holds `needle` as a whole reference. `http://localhost:30001` is not a mention of
/// `http://localhost:3000`, and `report.html.bak` is not a mention of `report.html`.
fn contains_reference(text: &str, needle: &str, kind: MentionKind) -> bool {
    text.match_indices(needle).any(|(start, matched)| {
        let before = text[..start].chars().next_back();
        let after_start = start + matched.len();
        let mut after = text[after_start..].chars();
        let next = after.next();
        let following = after.next();
        let starts_cleanly = match (kind, before) {
            (_, None) => true,
            (MentionKind::Origin, Some(c)) => !is_name_char(c),
            (MentionKind::Path, Some(c)) => !is_name_char(c) && !matches!(c, '/' | '\\' | '.' | '~'),
        };
        let ends_cleanly = match next {
            None => true,
            Some(c) if is_name_char(c) => false,
            Some('.') => !following.is_some_and(is_name_char),
            Some(':') if kind == MentionKind::Origin => !following.is_some_and(|c| c.is_ascii_digit()),
            Some('/' | '\\') if kind == MentionKind::Path => false,
            Some(_) => true,
        };
        starts_cleanly && ends_cleanly
    })
}

#[derive(Default)]
pub struct ActivityStore {
    logs: HashMap<String, ActivityLog>,
}

impl ActivityStore {
    pub fn record(&mut self, session_id: &str, message: Value) -> Value {
        self.logs.entry(session_id.to_string()).or_default().record(message)
    }

    pub fn snapshot(&self, session_id: &str) -> Value {
        self.logs.get(session_id).map(ActivityLog::snapshot).unwrap_or_else(|| json!({ "seq": 0, "messages": [] }))
    }

    pub fn remove(&mut self, session_id: &str) {
        self.logs.remove(session_id);
    }

    pub fn mentions(&self, session_id: &str, needle: &str, kind: MentionKind) -> bool {
        self.logs.get(session_id).is_some_and(|log| log.mentions(needle, kind))
    }
}

/// Whether a bridge message belongs in the activity feed (vs. diffs, file results, …).
pub fn is_activity(message: &Value) -> bool {
    matches!(message.get("type").and_then(Value::as_str), Some("event") | Some("error"))
}

/// The feed entry for something a person sent from the companion, or `None` for commands
/// that are not conversation (diff requests, aborts, …).
pub fn user_message(command: &Value) -> Option<Value> {
    let (title, text) = match command.get("type").and_then(Value::as_str)? {
        "prompt" => ("You", command.get("text")?.as_str()?.to_string()),
        "steer" => ("You · steer", command.get("text")?.as_str()?.to_string()),
        "ask_answer" => {
            let answers = command.get("answers")?.as_object()?;
            let summary = answers
                .values()
                .map(|values| values.as_array().map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default())
                .collect::<Vec<_>>()
                .join(" · ");
            ("You · answer", summary)
        }
        _ => return None,
    };
    Some(json!({ "type": "event", "event": "user.message", "payload": { "title": title, "text": text } }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deltas_merge_and_seq_advances() {
        let mut log = ActivityLog::default();
        log.record(json!({"type":"event","event":"agent.start","payload":{}}));
        log.record(json!({"type":"event","event":"assistant.delta","payload":{"kind":"text","delta":"Hel"}}));
        let last = log.record(json!({"type":"event","event":"assistant.delta","payload":{"kind":"text","delta":"lo"}}));
        assert_eq!(last["seq"], 3);
        let snapshot = log.snapshot();
        assert_eq!(snapshot["seq"], 3);
        let messages = snapshot["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1]["payload"]["delta"], "Hello");
        assert_eq!(messages[1]["seq"], 3);
    }

    #[test]
    fn mentions_ignore_what_people_typed() {
        let mut log = ActivityLog::default();
        log.record(json!({"type":"event","event":"assistant.delta","payload":{"kind":"text","delta":"Wrote /work/report.html"}}));
        log.record(json!({"type":"event","event":"user.message","payload":{"title":"You","text":"show /work/secret.txt"}}));
        assert!(log.mentions("/work/report.html", MentionKind::Path));
        assert!(!log.mentions("/work/secret.txt", MentionKind::Path));
        assert!(!log.mentions("", MentionKind::Path));
    }

    #[test]
    fn mentions_match_whole_references_not_prefixes() {
        let said = |text: &str| {
            let mut log = ActivityLog::default();
            log.record(json!({"type":"event","event":"assistant.delta","payload":{"kind":"text","delta":text}}));
            log
        };
        let cases = [
            ("Serving http://localhost:30001", "http://localhost:3000", MentionKind::Origin, false),
            ("Serving http://localhost:3000/app", "http://localhost:3000", MentionKind::Origin, true),
            ("Open http://localhost:3000.", "http://localhost:3000", MentionKind::Origin, true),
            ("Open (http://localhost:3000)", "http://localhost:3000", MentionKind::Origin, true),
            ("Open http://localhost:3000:", "http://localhost:3000", MentionKind::Origin, true),
            ("Open http://localhost:3000", "http://localhost", MentionKind::Origin, false),
            ("Open xhttp://localhost:3000", "http://localhost:3000", MentionKind::Origin, false),
            ("Open http://localhost.evil.com:3000", "http://localhost", MentionKind::Origin, false),
            ("Wrote /work/report.html.bak", "/work/report.html", MentionKind::Path, false),
            ("Wrote /work/report.html2", "/work/report.html", MentionKind::Path, false),
            ("Wrote /work/report.html.", "/work/report.html", MentionKind::Path, true),
            ("Wrote `/work/report.html`", "/work/report.html", MentionKind::Path, true),
            ("Wrote /other/work/report.html", "/work/report.html", MentionKind::Path, false),
            ("Wrote /work/report.html/extra", "/work/report.html", MentionKind::Path, false),
            ("Wrote ./docs/a.md", "docs/a.md", MentionKind::Path, false),
            ("Wrote mydocs/a.md", "docs/a.md", MentionKind::Path, false),
            ("See [x](docs/a.md)", "docs/a.md", MentionKind::Path, true),
            ("Wrote /work/My Docs/a b.md now", "/work/My Docs/a b.md", MentionKind::Path, true),
        ];
        for (text, needle, kind, expected) in cases {
            assert_eq!(said(text).mentions(needle, kind), expected, "{needle:?} in {text:?}");
        }
    }

    #[test]
    fn log_is_bounded() {
        let mut log = ActivityLog::default();
        for _ in 0..(MAX_MESSAGES + 50) {
            log.record(json!({"type":"event","event":"agent.start","payload":{}}));
        }
        assert_eq!(log.snapshot()["messages"].as_array().unwrap().len(), MAX_MESSAGES);
    }

    #[test]
    fn user_commands_become_feed_entries() {
        let prompt = user_message(&json!({"type":"prompt","text":"hi"})).unwrap();
        assert_eq!(prompt["payload"]["title"], "You");
        let answer = user_message(&json!({"type":"ask_answer","answers":{"a":["x","y"],"b":["z"]}})).unwrap();
        assert!(answer["payload"]["text"].as_str().unwrap().contains("x, y"));
        assert!(user_message(&json!({"type":"git_diff"})).is_none());
    }
}
