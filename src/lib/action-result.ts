export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; message?: string; fieldErrors?: Record<string, string[]> };

// Form actions: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
// on success call redirect() where a navigation is expected.
export type FormAction<T = null> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(message?: string, fieldErrors?: Record<string, string[]>): { ok: false; message?: string; fieldErrors?: Record<string, string[]> } {
  return { ok: false, message, fieldErrors };
}
