/**
 * Game Scroller — paste in browser console on any game list page.
 *
 * Z         → advance to next item, copy name to clipboard
 * Shift+Z   → go back one item
 * Ctrl+Z    → reset position to start
 *
 * Works by finding all list-like elements on the page and iterating them.
 * Copies the text content (or title attribute) to clipboard so the
 * Game Manager ClipboardPiP can match it against your library in real-time.
 */
(function () {
  if (window.__gameScroller) {
    window.__gameScroller.destroy();
    console.log("[GameScroller] Destroyed existing instance.");
  }

  // ── Candidate selectors, tried in order ──────────────────────────────────
  const SELECTORS = [
    // Steam store search / tag browsing
    ".search_result_row",
    // Steam wishlist
    ".wishlist_row",
    // Steam discovery queue
    ".discovery_queue",
    // SteamDB lists
    "tr.app",
    // HowLongToBeat
    "li.search_list_details_block",
    // Generic: any <li> with visible text
    "li[class]",
    // Generic table rows
    "tbody tr",
    // Generic cards/articles
    "article",
    "[data-appid]",
  ];

  // ── Extract a readable name from an element ───────────────────────────────
  function extractName(el) {
    // Try well-known name containers first
    const nameEl =
      el.querySelector(".title, .game_name, .search_name, .app_name, h2, h3, h4, [class*='name' i], [class*='title' i]");
    if (nameEl) {
      const t = nameEl.textContent.trim();
      if (t.length >= 2 && t.length < 200) return t;
    }
    // Fall back to title attribute
    if (el.title && el.title.length >= 2) return el.title;
    // Fall back to data-appid lookup via aria-label or data-name
    if (el.dataset.name) return el.dataset.name;
    // Trim overall text to first 100 chars
    const text = el.textContent.replace(/\s+/g, " ").trim().slice(0, 120);
    if (text.length >= 2) return text;
    return null;
  }

  // ── Find the best candidate list on the page ──────────────────────────────
  function findItems() {
    for (const sel of SELECTORS) {
      const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 50 && r.height > 10; // must be visible
      });
      if (els.length >= 2) return els;
    }
    return [];
  }

  // ── HUD overlay ───────────────────────────────────────────────────────────
  const hud = document.createElement("div");
  Object.assign(hud.style, {
    position: "fixed", bottom: "20px", right: "20px", zIndex: "999999",
    background: "rgba(15,15,35,0.92)", color: "#e2e8f0",
    fontFamily: "system-ui, sans-serif", fontSize: "12px",
    padding: "8px 12px", borderRadius: "8px",
    border: "1px solid #6366f1", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    maxWidth: "300px", lineHeight: "1.5", pointerEvents: "none",
    transition: "opacity 0.3s",
  });
  document.body.appendChild(hud);

  function setHud(msg, color) {
    hud.innerHTML = `<span style="color:${color || "#6366f1"};font-weight:bold">🎮 GameScroller</span><br>${msg}`;
    hud.style.opacity = "1";
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let items = [];
  let pos = -1;
  let lastHighlight = null;

  function highlight(el) {
    if (lastHighlight) {
      lastHighlight.style.outline = "";
      lastHighlight.style.backgroundColor = "";
    }
    el.style.outline = "2px solid #6366f1";
    el.style.backgroundColor = "rgba(99,102,241,0.08)";
    lastHighlight = el;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function copyName(name) {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Fallback for pages that block clipboard
      const ta = document.createElement("textarea");
      ta.value = name;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  async function advance(delta) {
    // Refresh items on each advance in case page loaded more
    items = findItems();
    if (items.length === 0) {
      setHud("No game list found on this page.", "#ef4444");
      return;
    }

    pos = Math.max(0, Math.min(items.length - 1, pos + delta));
    const el = items[pos];
    const name = extractName(el);

    highlight(el);

    if (name) {
      await copyName(name);
      setHud(`[${pos + 1}/${items.length}] <span style="color:#fbbf24">${name.slice(0, 80)}</span><br><span style="color:#64748b;font-size:10px">Z=next · Shift+Z=back · Ctrl+Z=reset</span>`, "#22c55e");
    } else {
      setHud(`[${pos + 1}/${items.length}] (no name found)<br><span style="color:#64748b;font-size:10px">Z=next · Shift+Z=back</span>`, "#f97316");
    }
  }

  // ── Key handler ───────────────────────────────────────────────────────────
  function onKey(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        pos = -1;
        setHud("Reset to start. Press Z to begin.", "#6366f1");
      } else if (e.shiftKey) {
        advance(-1);
      } else {
        advance(+1);
      }
    }
  }

  document.addEventListener("keydown", onKey, true);

  // ── Init ──────────────────────────────────────────────────────────────────
  items = findItems();
  const count = items.length;
  setHud(
    count > 0
      ? `Found <b>${count}</b> items.<br>Press <b>Z</b> to start, <b>Shift+Z</b> to go back.`
      : `No list detected yet. Try Z after page loads.`,
    count > 0 ? "#22c55e" : "#f97316"
  );

  // ── Destroy ───────────────────────────────────────────────────────────────
  window.__gameScroller = {
    destroy() {
      document.removeEventListener("keydown", onKey, true);
      if (lastHighlight) { lastHighlight.style.outline = ""; lastHighlight.style.backgroundColor = ""; }
      hud.remove();
      delete window.__gameScroller;
      console.log("[GameScroller] Removed.");
    },
  };

  console.log(`[GameScroller] Ready. ${count} items found. Z=next, Shift+Z=back, Ctrl+Z=reset.`);
})();
