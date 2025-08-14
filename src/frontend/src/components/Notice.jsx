import React, { useEffect } from "react";

/**
 * Small, theme-aware modal notification replacement for window.alert().
 *
 * Props:
 *   type: "success" | "error" | "info"
 *   message: string (main line)
 *   sub: string (secondary small text, optional)
 *   autoCloseMs: number (ms until auto-close; 0 = never)
 *   onClose: fn
 */
export default function Notice({
  type = "info",
  message = "",
  sub = "",
  autoCloseMs = 4000,
  onClose = () => {},
}) {
  /* auto-dismiss ------------------------------------------------ */
  useEffect(() => {
    if (!autoCloseMs) return;
    const id = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(id);
  }, [autoCloseMs, onClose]);

  /* prevent body scroll while visible -------------------------- */
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);

  /* close on Escape for smoother UX ---------------------------- */
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const icon =
    type === "success" ? "✅" :
    type === "error"   ? "⚠️" :
    "ℹ️";

  return (
    <div className="modal-overlay" onClick={onClose} role="alertdialog" aria-live="assertive">
      <div
        className={`modal-dialog notice-modal ${type}`}
        onClick={e => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="close">×</button>
        <span className="notice-icon" aria-hidden>{icon}</span>
        <p>{message}</p>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}
