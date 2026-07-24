import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCommandManager } from './CommandManager.js';
import { createCommand } from './Command.js';
import { createVaultMutationCommand } from './VaultMutationCommand.js';
import { createVaultService } from '../services/VaultService.js';
import { eventBus, VAULT_EVENT_CHANNEL } from '../services/EventBus.js';

// createCommandManager() subscribes to the shared EventBus singleton and
// never unsubscribes (fine in production - it's created once per app
// session - but across many tests in one process it would otherwise trip
// Node's "possible EventEmitter memory leak" warning).
beforeAll(() => {
  eventBus.setMaxListeners(100);
});

function createMockCommand(label = 'mock') {
  const calls = { execute: 0, undo: 0, redo: 0 };
  const command = createCommand({
    label,
    execute: () => {
      calls.execute += 1;
      return `${label}-result`;
    },
    undo: () => {
      calls.undo += 1;
    },
    redo: () => {
      calls.redo += 1;
    },
  });
  return { command, calls };
}

describe('CommandManager stack semantics (mock commands)', () => {
  test('execute() runs the command, returns its result, and enables undo', () => {
    const cm = createCommandManager();
    const { command, calls } = createMockCommand();

    const result = cm.execute(command);
    expect(result).toBe('mock-result');
    expect(calls.execute).toBe(1);
    expect(cm.canUndo()).toBe(true);
    expect(cm.canRedo()).toBe(false);
  });

  test('undo() reverses the most recent command and enables redo', () => {
    const cm = createCommandManager();
    const { command, calls } = createMockCommand();
    cm.execute(command);

    const undone = cm.undo();
    expect(undone).toBe(true);
    expect(calls.undo).toBe(1);
    expect(cm.canUndo()).toBe(false);
    expect(cm.canRedo()).toBe(true);
  });

  test('redo() re-applies an undone command', () => {
    const cm = createCommandManager();
    const { command, calls } = createMockCommand();
    cm.execute(command);
    cm.undo();

    const redone = cm.redo();
    expect(redone).toBe(true);
    expect(calls.redo).toBe(1);
    expect(cm.canUndo()).toBe(true);
    expect(cm.canRedo()).toBe(false);
  });

  test('undo()/redo() on an empty stack return false and are no-ops', () => {
    const cm = createCommandManager();
    expect(cm.undo()).toBe(false);
    expect(cm.redo()).toBe(false);
  });

  test('executing a new command after an undo discards the redo branch', () => {
    const cm = createCommandManager();
    const first = createMockCommand('first');
    const second = createMockCommand('second');

    cm.execute(first.command);
    cm.undo();
    expect(cm.canRedo()).toBe(true);

    cm.execute(second.command);
    expect(cm.canRedo()).toBe(false);
    expect(cm.redo()).toBe(false);
    expect(second.calls.redo).toBe(0);
  });

  test('undo/redo processes commands in correct LIFO order across multiple steps', () => {
    const cm = createCommandManager();
    const a = createMockCommand('a');
    const b = createMockCommand('b');
    const c = createMockCommand('c');
    cm.execute(a.command);
    cm.execute(b.command);
    cm.execute(c.command);

    cm.undo(); // undoes c
    cm.undo(); // undoes b
    expect(c.calls.undo).toBe(1);
    expect(b.calls.undo).toBe(1);
    expect(a.calls.undo).toBe(0);

    cm.redo(); // redoes b
    expect(b.calls.redo).toBe(1);
    expect(cm.canUndo()).toBe(true);
    expect(cm.canRedo()).toBe(true); // c is still pending redo
  });

  test('clear() empties both stacks', () => {
    const cm = createCommandManager();
    cm.execute(createMockCommand().command);
    cm.undo();
    expect(cm.canRedo()).toBe(true);

    cm.clear();
    expect(cm.canUndo()).toBe(false);
    expect(cm.canRedo()).toBe(false);
  });

  test('history is bounded to 50 entries', () => {
    const cm = createCommandManager();
    for (let i = 0; i < 60; i += 1) {
      cm.execute(createMockCommand(`cmd-${i}`).command);
    }
    let undoCount = 0;
    while (cm.undo()) undoCount += 1;
    expect(undoCount).toBe(50);
  });
});

describe('CommandManager auto-clear on vault lifecycle events', () => {
  test('clears the stack when a vault.locked event fires on the shared EventBus', () => {
    const cm = createCommandManager();
    cm.execute(createMockCommand().command);
    expect(cm.canUndo()).toBe(true);

    eventBus.emit(VAULT_EVENT_CHANNEL, { action: 'vault.locked', details: {}, timestamp: new Date().toISOString() });
    expect(cm.canUndo()).toBe(false);
  });

  test('does not clear on unrelated events', () => {
    const cm = createCommandManager();
    cm.execute(createMockCommand().command);

    eventBus.emit(VAULT_EVENT_CHANNEL, { action: 'entry.created', details: {}, timestamp: new Date().toISOString() });
    expect(cm.canUndo()).toBe(true);
  });
});

describe('CommandManager + VaultMutationCommand integration (real VaultService)', () => {
  function createTestVaultService() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xela-cm-integration-'));
    const svc = createVaultService({ vaultFilePath: path.join(dir, 'vault.xam'), backupDir: path.join(dir, 'backups') });
    svc.create('supersecretpassword');
    return svc;
  }

  test('undo restores the exact prior vault state, redo re-applies it', () => {
    const svc = createTestVaultService();
    const cm = createCommandManager();
    const withUndo = (label, run) => cm.execute(createVaultMutationCommand(svc, label, run));

    withUndo('Add category', () => svc.addCategory('Personal', 'category'));
    expect(svc.getVault().categories).toHaveLength(1);

    cm.undo();
    expect(svc.getVault().categories).toHaveLength(0);

    cm.redo();
    expect(svc.getVault().categories).toHaveLength(1);
    expect(svc.getVault().categories[0].name).toBe('Personal');
  });

  test('vault.locked (emitted by svc.lock()) clears the undo stack', () => {
    const svc = createTestVaultService();
    const cm = createCommandManager();
    cm.execute(createVaultMutationCommand(svc, 'Add category', () => svc.addCategory('Personal', 'category')));
    expect(cm.canUndo()).toBe(true);

    svc.lock();
    expect(cm.canUndo()).toBe(false);
  });

  test('multi-step undo/redo round-trips through category -> folder -> entry creation', () => {
    const svc = createTestVaultService();
    const cm = createCommandManager();
    const withUndo = (label, run) => cm.execute(createVaultMutationCommand(svc, label, run));

    const category = withUndo('Add category', () => svc.addCategory('Personal', 'category'));
    const folder = withUndo('Add folder', () => svc.addFolder(category.id, null, 'General'));
    withUndo('Add entry', () => svc.addEntry(category.id, folder.id, { title: 'GitHub', template: 'Custom' }));

    expect(svc.getVault().categories[0].folders[0].entries).toHaveLength(1);

    cm.undo();
    expect(svc.getVault().categories[0].folders[0].entries).toHaveLength(0);
    cm.undo();
    expect(svc.getVault().categories[0].folders).toHaveLength(0);
    cm.undo();
    expect(svc.getVault().categories).toHaveLength(0);

    cm.redo();
    cm.redo();
    cm.redo();
    expect(svc.getVault().categories[0].folders[0].entries).toHaveLength(1);
  });
});
