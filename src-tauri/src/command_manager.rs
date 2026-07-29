// Rust port of src/commands/Command.js + VaultMutationCommand.js +
// CommandManager.js, adapted for Rust's ownership model.
//
// The JS version stores Commands as {execute, undo, redo} closures that
// capture a shared `vaultService` object and snapshot the whole vault
// before/after each mutation runs. That closure-capturing pattern doesn't
// translate directly to Rust's borrow checker (many long-lived closures
// each wanting `&mut VaultService`), but the *actual* behavior underneath
// - whole-vault snapshotting, not a hand-written inverse per operation -
// doesn't need closures at all: by the time a command is pushed, the
// mutation has already run and both snapshots already exist as plain data.
// So a command here is just `{ label, before, after }`; undo/redo return
// the snapshot to restore and the caller (the IPC layer, which already
// owns the VaultService) applies it via `VaultService::restore_snapshot`.

#![allow(dead_code)]

use crate::model::Vault;

const MAX_HISTORY: usize = 50;

/// Vault lifecycle actions after which a previously-recorded snapshot would
/// no longer make sense to restore - mirrors CommandManager.js's
/// CLEARING_ACTIONS. Callers should call `clear()` when a VaultService
/// mutation emits one of these.
pub fn is_clearing_action(action: &str) -> bool {
    matches!(action, "vault.created" | "vault.imported" | "vault.locked")
}

pub struct UndoableCommand {
    pub label: String,
    pub before: Vault,
    pub after: Vault,
}

#[derive(Default)]
pub struct CommandManager {
    undo_stack: Vec<UndoableCommand>,
    redo_stack: Vec<UndoableCommand>,
}

impl CommandManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a mutation that already ran (equivalent to JS's execute(),
    /// minus actually running anything - the caller already did that to
    /// produce `before`/`after`).
    pub fn push(&mut self, command: UndoableCommand) {
        self.undo_stack.push(command);
        if self.undo_stack.len() > MAX_HISTORY {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    /// Pops the most recent command and returns the snapshot to restore, or
    /// None if there's nothing to undo.
    pub fn undo(&mut self) -> Option<Vault> {
        let command = self.undo_stack.pop()?;
        let before = command.before.clone();
        self.redo_stack.push(command);
        Some(before)
    }

    pub fn redo(&mut self) -> Option<Vault> {
        let command = self.redo_stack.pop()?;
        let after = command.after.clone();
        self.undo_stack.push(command);
        Some(after)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::vault::create_vault;

    fn snapshot(label: &str) -> Vault {
        let mut v = create_vault();
        v.settings.theme = label.to_string(); // cheap way to make snapshots distinguishable
        v
    }

    fn cmd(label: &str, before: &str, after: &str) -> UndoableCommand {
        UndoableCommand { label: label.into(), before: snapshot(before), after: snapshot(after) }
    }

    #[test]
    fn undo_redo_round_trip() {
        let mut cm = CommandManager::new();
        assert!(!cm.can_undo());

        cm.push(cmd("Add category", "s0", "s1"));
        assert!(cm.can_undo());
        assert!(!cm.can_redo());

        let restored = cm.undo().unwrap();
        assert_eq!(restored.settings.theme, "s0");
        assert!(!cm.can_undo());
        assert!(cm.can_redo());

        let restored = cm.redo().unwrap();
        assert_eq!(restored.settings.theme, "s1");
        assert!(cm.can_undo());
        assert!(!cm.can_redo());
    }

    #[test]
    fn undo_and_redo_on_empty_stacks_return_none() {
        let mut cm = CommandManager::new();
        assert!(cm.undo().is_none());
        assert!(cm.redo().is_none());
    }

    #[test]
    fn pushing_a_new_command_clears_the_redo_stack() {
        let mut cm = CommandManager::new();
        cm.push(cmd("A", "s0", "s1"));
        cm.undo();
        assert!(cm.can_redo());

        cm.push(cmd("B", "s1", "s2"));
        assert!(!cm.can_redo());
    }

    #[test]
    fn history_is_bounded_to_max_history() {
        let mut cm = CommandManager::new();
        for i in 0..(MAX_HISTORY + 10) {
            cm.push(cmd("x", &format!("s{i}"), &format!("s{}", i + 1)));
        }
        // Undo everything and make sure we don't get more than MAX_HISTORY pops.
        let mut count = 0;
        while cm.undo().is_some() {
            count += 1;
        }
        assert_eq!(count, MAX_HISTORY);
    }

    #[test]
    fn clear_empties_both_stacks() {
        let mut cm = CommandManager::new();
        cm.push(cmd("A", "s0", "s1"));
        cm.undo();
        assert!(cm.can_redo());
        cm.clear();
        assert!(!cm.can_undo());
        assert!(!cm.can_redo());
    }

    #[test]
    fn clearing_actions_match_vault_lifecycle_transitions() {
        assert!(is_clearing_action("vault.created"));
        assert!(is_clearing_action("vault.imported"));
        assert!(is_clearing_action("vault.locked"));
        assert!(!is_clearing_action("entry.created"));
    }
}
