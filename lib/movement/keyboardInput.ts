/**
 * Keyboard controls for Rara: A / D / Left / Right move, W / Up / Space jump.
 *
 * Only reads the keyboard; the motor decides what it means. Keys are ignored
 * while a text field or slider has focus (e.g. typing a token id into the
 * Wallet & Skins overlay), so typing never moves Rara.
 *
 * Letter keys are registered WITHOUT Phaser's key capture: capture is global
 * and calls preventDefault, which would stop those letters from being typed
 * into the overlay's inputs. Arrows and Space are already captured by the
 * cursor keys (the page never scrolls, and the overlay buttons blur themselves).
 *
 * Only `import type Phaser` (SSR-safe; see lib/rara/RaraCharacter.ts).
 */

import type Phaser from "phaser";

export type KeyboardMovementInput = {
  /** Horizontal direction held: -1, 0 or 1 (0 when neither or both directions are held). */
  readDirection(): -1 | 0 | 1;
  /** Whether any jump key is held. */
  isJumpHeld(): boolean;
  destroy(): void;
};

export function isTypingInField(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select"));
}

/** `onJumpPress` fires once per physical key press (not on key repeat), so holding a jump key never chains jumps. */
export function createKeyboardMovementInput(scene: Phaser.Scene, onJumpPress: () => void): KeyboardMovementInput {
  const keyboard = scene.input.keyboard!;
  const cursors = keyboard.createCursorKeys();
  const letters = keyboard.addKeys("A,D,W", false) as Record<"A" | "D" | "W", Phaser.Input.Keyboard.Key>;

  const leftKeys = [letters.A, cursors.left];
  const rightKeys = [letters.D, cursors.right];
  const jumpKeys = [letters.W, cursors.up, cursors.space];
  const anyDown = (keys: Phaser.Input.Keyboard.Key[]) => !isTypingInField() && keys.some((key) => key.isDown);

  const handleJumpDown = () => {
    if (!isTypingInField()) onJumpPress();
  };
  for (const key of jumpKeys) key.on("down", handleJumpDown);

  return {
    readDirection() {
      const left = anyDown(leftKeys);
      const right = anyDown(rightKeys);
      return left === right ? 0 : left ? -1 : 1;
    },
    isJumpHeld: () => anyDown(jumpKeys),
    destroy() {
      for (const key of jumpKeys) key.off("down", handleJumpDown);
    },
  };
}
