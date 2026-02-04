import React, { useEffect, useState } from "react";

const modes = ["auto", "light", "dark"];

/* inline SVG icons – small, no extra deps */
const IconAuto = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);
const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);
const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

const icons = { auto: IconAuto, light: IconSun, dark: IconMoon };

function applyTheme(mode) {
  const root = document.documentElement;
  root.dataset.theme =
    mode === "auto"
      ? matchMedia("(prefers-color-scheme:dark)").matches
        ? "dark"
        : "light"
      : mode;
}

export default function ThemeToggle() {
  const [mode, setMode] = useState(
    () => localStorage.getItem("theme-mode") || "auto",
  );

  /* apply on mount + whenever mode changes */
  useEffect(() => {
    applyTheme(mode);

    /* listen for system theme changes when in auto mode */
    const mq = matchMedia("(prefers-color-scheme:dark)");
    const handler = () => {
      if (mode === "auto") applyTheme("auto");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  function select(m) {
    setMode(m);
    localStorage.setItem("theme-mode", m);
  }

  return (
    <div className="theme-toggle">
      {modes.map((m) => {
        const Icon = icons[m];
        return (
          <button
            key={m}
            className={mode === m ? "active" : ""}
            onClick={() => select(m)}
            title={m.charAt(0).toUpperCase() + m.slice(1)}
          >
            <Icon />
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        );
      })}
    </div>
  );
}
