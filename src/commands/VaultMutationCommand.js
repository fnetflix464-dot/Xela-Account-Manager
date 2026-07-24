import { createCommand } from './Command.js';

/**
 * Wraps a VaultService mutation as an undoable Command via whole-vault
 * snapshotting rather than a hand-written inverse operation.
 * VaultService already treats `vault` as fully immutable (every mutation
 * is a fresh `{ ...vault, ... }`), so unchanged subtrees are literally the
 * same object references across snapshots (structural sharing) - keeping
 * a bounded history of them is cheap, and it sidesteps an entire class of
 * bugs a per-operation inverse would risk (e.g. "undo of delete must not
 * create a second recycle-bin record").
 *
 * `undo`/`redo` restore a previously-captured snapshot rather than
 * re-running `run` a second time - re-running would mint fresh
 * UUIDs/timestamps via the model factories and diverge from the state
 * that was actually undone.
 * @param {Object} vaultService
 * @param {string} label
 * @param {function(): *} run performs the mutation via vaultService and returns its result
 */
export function createVaultMutationCommand(vaultService, label, run) {
  let beforeSnapshot = null;
  let afterSnapshot = null;

  return createCommand({
    label,
    execute: () => {
      beforeSnapshot = vaultService.getVault();
      const result = run();
      afterSnapshot = vaultService.getVault();
      return result;
    },
    undo: () => {
      vaultService.restoreSnapshot(beforeSnapshot);
    },
    redo: () => {
      vaultService.restoreSnapshot(afterSnapshot);
    },
  });
}
