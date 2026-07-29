import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

let available: boolean | null = null;

async function isAvailable(): Promise<boolean> {
  if (available != null) return available;
  try {
    await Haptics.selectionStart();
    await Haptics.selectionEnd();
    available = true;
  } catch {
    available = false;
  }
  return available;
}

async function run(fn: () => Promise<void>) {
  if (!(await isAvailable())) return;
  try {
    await fn();
  } catch {
    // Haptics are best-effort; never break the app for missing native bridge.
  }
}

export const haptic = {
  /** Light tap on buttons, pills, cards. */
  tap: () => run(() => Haptics.impact({ style: ImpactStyle.Light })),
  /** Medium impact on toggles, checkboxes, important state changes. */
  impact: () => run(() => Haptics.impact({ style: ImpactStyle.Medium })),
  /** Heavy impact on destructive actions. */
  heavy: () => run(() => Haptics.impact({ style: ImpactStyle.Heavy })),
  /** Long-press / selection feedback. */
  select: () => run(() => Haptics.selectionStart()),
  /** Success: task done, saved, completed. */
  success: () => run(() => Haptics.notification({ type: NotificationType.Success })),
  /** Error / failure. */
  error: () => run(() => Haptics.notification({ type: NotificationType.Error })),
  /** Warning: soft nudge. */
  warning: () => run(() => Haptics.notification({ type: NotificationType.Warning })),
};
