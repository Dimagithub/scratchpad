import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  private: boolean;
}

// Subscribe to a Tauri event for the component's lifetime, guarding against the
// async listen() resolving after unmount.
function useTauriEvent<T>(event: string, handler: (payload: T) => void, deps: React.DependencyList = []) {
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<T>(event, (e) => { if (active) handler(e.payload); }).then((fn) => {
      unlisten = fn;
      if (!active) unlisten();
    });
    return () => { active = false; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [didAutoCreate, setDidAutoCreate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const contentLoaded = useRef(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [opacity, setOpacity] = useState(1.0);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [currentMatch, setCurrentMatch] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigatedRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);

  const loadNotes = useCallback(async () => {
    try {
      const data = await invoke<Note[]>("get_notes");
      setNotes(data);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load notes:", err);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    invoke<{ theme: string; opacity: number }>("get_settings")
      .then((s) => {
        setTheme(s.theme as "dark" | "light");
        setOpacity(s.opacity);
      })
      .catch(console.error);
  }, []);

  useTauriEvent<{ theme?: string; opacity?: number }>("settings-changed", (p) => {
    if (p.theme !== undefined) setTheme(p.theme as "dark" | "light");
    if (p.opacity !== undefined) setOpacity(p.opacity);
  });

  const togglePrivacy = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    setNotes((prev) => {
      const note = prev.find((n) => n.id === id);
      if (!note) return prev;
      const updated = { ...note, private: !note.private };
      invoke("save_note", { note: updated }).catch(console.error);
      invoke("set_privacy_menu_state", { isPrivate: updated.private }).catch(console.error);
      return prev.map((n) => (n.id === id ? updated : n));
    });
  }, []);

  useTauriEvent<null>("toggle-privacy", () => togglePrivacy(), [togglePrivacy]);

  useEffect(() => {
    const note = notes.find((n) => n.id === activeId);
    invoke("set_privacy_menu_state", { isPrivate: note?.private ?? false }).catch(console.error);
  }, [activeId, notes]);

  useTauriEvent<string>("update-available", (v) => setUpdateVersion(v));

  const handleInstallUpdate = () => {
    setUpdating(true);
    invoke("install_update").catch((err) => {
      console.error("Update failed:", err);
      setUpdating(false);
    });
  };

  const matches = useMemo(() => {
    if (!query) return [];
    const note = notes.find((n) => n.id === activeId);
    if (!note || note.private) return [];
    const hay = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    const res: number[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) {
      res.push(i);
      i = hay.indexOf(needle, i + needle.length);
    }
    return res;
  }, [query, content, caseSensitive, notes, activeId]);

  // Focus the editor so the native selection is actually painted — a textarea
  // only highlights its selection while focused. Then scroll the match into view.
  const revealMatch = (start: number) => {
    const ta = editorRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, start + query.length);
    // approximate scroll-to: textarea is 14px font with 1.6 line-height
    const line = content.slice(0, start).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * 14 * 1.6 - ta.clientHeight / 2);
  };

  // New query resets the cursor; the first nav lands on match 0, then cycles.
  useEffect(() => { setCurrentMatch(0); navigatedRef.current = false; }, [query, caseSensitive, activeId]);

  const jump = (delta: number) => {
    if (!matches.length) return;
    const idx = navigatedRef.current
      ? (currentMatch + delta + matches.length) % matches.length
      : currentMatch;
    navigatedRef.current = true;
    setCurrentMatch(idx);
    revealMatch(matches[idx]);
  };
  const goNext = () => jump(1);
  const goPrev = () => jump(-1);
  const closeSearch = () => { setSearchOpen(false); editorRef.current?.focus(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (!activeIdRef.current) return;
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.select(), 0);
      } else if (e.key === "Escape" && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  useEffect(() => {
    if (!loaded) return;
    if (notes.length === 0 && !didAutoCreate) {
      setDidAutoCreate(true);
      handleAdd();
    } else if (notes.length > 0 && !activeId) {
      const latest = notes.reduce((a, b) => (a.created_at > b.created_at ? a : b));
      setActiveId(latest.id);
    }
  }, [loaded, notes]);

  useEffect(() => {
    if (activeId) {
      contentLoaded.current = false;
      const note = notes.find((n) => n.id === activeId);
      setContent(note?.content || "");
      requestAnimationFrame(() => {
        contentLoaded.current = true;
      });
    }
  }, [activeId]);

  const saveContent = useCallback(
    async (id: string, text: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      try {
        await invoke("save_note", {
          note: { ...note, content: text },
        });
        setNotes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, content: text } : n))
        );
      } catch (err) {
        console.error("Failed to save:", err);
      }
    },
    [notes]
  );

  const handleAdd = async () => {
    try {
      const title = `Notepad ${new Date().toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      })}`;
      const note = await invoke<Note>("create_new_note", { title });
      setNotes((prev) => [...prev, note]);
      setActiveId(note.id);
    } catch (err) {
      console.error("Failed to create notepad:", err);
    }
  };

  const handleClose = async (id: string) => {
    try {
      await invoke("delete_note", { noteId: id });
    } catch (err) {
      console.error("Failed to delete:", err);
    }
    const remaining = notes.filter((n) => n.id !== id);
    setNotes(remaining);
    if (activeId === id) {
      setActiveId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
  };

  useEffect(() => {
    if (!contentLoaded.current || !activeId) return;
    const timer = setTimeout(() => {
      saveContent(activeId, content);
    }, 600);
    return () => clearTimeout(timer);
  }, [content]);

  const startRenaming = (id: string, title: string) => {
    setRenamingId(id);
    setRenameInput(title);
    setTimeout(() => renameRef.current?.select(), 10);
  };

  const finishRenaming = async () => {
    if (!renamingId) return;
    const trimmed = renameInput.trim();
    if (trimmed && trimmed !== notes.find((n) => n.id === renamingId)?.title) {
      try {
        await invoke("rename_note", { noteId: renamingId, newTitle: trimmed });
        setNotes((prev) =>
          prev.map((n) => (n.id === renamingId ? { ...n, title: trimmed } : n))
        );
      } catch (err) {
        console.error("Failed to rename:", err);
      }
    }
    setRenamingId(null);
    setRenameInput("");
  };

  const activeNote = notes.find((n) => n.id === activeId);

  const styles = useMemo(() => getStyles(theme, opacity), [theme, opacity]);

  return (
    <div style={styles.root} data-testid="app-root">
      <div style={styles.tabBar}>
        <div style={styles.tabs}>
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setActiveId(note.id)}
              data-testid="tab"
              data-active={note.id === activeId ? "true" : "false"}
              style={{
                ...styles.tab,
                ...(note.id === activeId ? styles.tabActive : {}),
              }}
            >
              {renamingId === note.id ? (
                <input
                  ref={renameRef}
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  onBlur={finishRenaming}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") finishRenaming();
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameInput("");
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={styles.renameInput}
                  autoFocus
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRenaming(note.id, note.title);
                  }}
                  style={styles.tabTitle}
                  title="Double-click to rename"
                  data-testid="tab-title"
                >
                  {note.title}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose(note.id);
                }}
                style={styles.tabClose}
                data-testid="tab-close"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {updateVersion && (
          <button
            onClick={handleInstallUpdate}
            disabled={updating}
            style={styles.updateButton}
            title={`Install ScratchPad ${updateVersion} and restart`}
            data-testid="update-button"
          >
            {updating ? "Updating…" : `⬆ New Release ${updateVersion}`}
          </button>
        )}
        {activeNote && !activeNote.private && (
          <button
            onClick={() => {
              setSearchOpen((v) => !v);
              setTimeout(() => searchRef.current?.select(), 0);
            }}
            style={{ ...styles.addButton, fontSize: 14, ...(searchOpen ? styles.privacyActive : {}) }}
            title="Find (⌘F)"
            data-testid="search-toggle"
          >
            🔍
          </button>
        )}
        {activeNote && (
          <button
            onClick={togglePrivacy}
            style={{ ...styles.addButton, fontSize: 15, ...(activeNote.private ? styles.privacyActive : {}) }}
            title={activeNote.private ? "Disable privacy mode" : "Enable privacy mode"}
            data-testid="privacy-toggle"
          >
            {activeNote.private ? "🔒" : "🔓"}
          </button>
        )}
        <button onClick={handleAdd} style={styles.addButton} data-testid="add-tab">
          +
        </button>
      </div>

      {searchOpen && activeNote && !activeNote.private && (
        <div style={styles.searchBar}>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // preventDefault: revealMatch focuses the editor, so without this the
              // Enter keypress would insert a newline into the now-focused textarea.
              if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? goPrev() : goNext(); }
              if (e.key === "Escape") closeSearch();
            }}
            placeholder="Find"
            style={styles.searchInput}
            data-testid="search-input"
            autoFocus
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            style={{ ...styles.searchBtn, ...(caseSensitive ? styles.searchBtnActive : {}) }}
            title="Match case"
            data-testid="search-case"
          >
            Aa
          </button>
          <span style={styles.searchCount} data-testid="search-count">
            {matches.length ? `${currentMatch + 1}/${matches.length}` : query ? "0/0" : ""}
          </span>
          <button onClick={goPrev} disabled={!matches.length} style={styles.searchBtn} title="Previous (⇧⏎)" data-testid="search-prev">↑</button>
          <button onClick={goNext} disabled={!matches.length} style={styles.searchBtn} title="Next (⏎)" data-testid="search-next">↓</button>
          <button onClick={closeSearch} style={styles.searchBtn} title="Close (Esc)" data-testid="search-close">×</button>
        </div>
      )}

      <div style={styles.editor}>
        {activeNote ? (
          activeNote.private ? (
            <textarea
              value={"•".repeat(content.length)}
              readOnly
              style={styles.textarea}
              spellCheck={false}
              data-testid="editor"
            />
          ) : (
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Start typing..."
              style={styles.textarea}
              spellCheck={false}
              data-testid="editor"
            />
          )
        ) : (
          <div style={styles.empty} data-testid="empty-state">
            <p>No notepads open</p>
            <button onClick={handleAdd} style={styles.emptyButton}>
              + New Notepad
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getStyles(theme: "dark" | "light", opacity: number): Record<string, React.CSSProperties> {
  const dark = theme === "dark";
  const bg = dark ? `rgba(30, 30, 30, ${opacity})` : `rgba(255, 255, 255, ${opacity})`;
  const tabBarBg = dark ? `rgba(45, 45, 48, ${opacity})` : `rgba(240, 240, 240, ${opacity})`;
  const tabBg = dark ? `rgba(45, 45, 45, ${opacity})` : `rgba(228, 228, 228, ${opacity})`;
  return {
    root: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: bg,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: 13,
    },
    tabBar: {
      display: "flex",
      background: tabBarBg,
      borderBottom: `1px solid ${dark ? "#474747" : "#d0d0d0"}`,
      minHeight: 36,
      flexShrink: 0,
    },
    tabs: {
      display: "flex",
      flex: 1,
      overflowX: "auto",
      overflowY: "hidden",
      minHeight: 36,
    },
    tab: {
      display: "flex",
      alignItems: "center",
      padding: "0 10px",
      borderRight: `1px solid ${dark ? "#3c3c3c" : "#d0d0d0"}`,
      cursor: "pointer",
      minWidth: 120,
      maxWidth: 180,
      height: 35,
      background: tabBg,
      gap: 6,
      flexShrink: 0,
    },
    tabActive: {
      background: bg,
      borderBottom: `2px solid ${dark ? "#007acc" : "#0078d4"}`,
    },
    tabTitle: {
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontSize: 12,
      cursor: "default",
    },
    renameInput: {
      flex: 1,
      background: dark ? `rgba(60, 60, 60, ${opacity})` : `rgba(255, 255, 255, ${opacity})`,
      border: `1px solid ${dark ? "#007acc" : "#0078d4"}`,
      borderRadius: 2,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      fontSize: 12,
      padding: "1px 4px",
      outline: "none",
      fontFamily: "inherit",
    },
    tabClose: {
      background: "transparent",
      border: "none",
      color: dark ? "#888" : "#666",
      cursor: "pointer",
      fontSize: 14,
      padding: "0 2px",
      lineHeight: 1,
      borderRadius: 3,
    },
    addButton: {
      background: "transparent",
      border: "none",
      color: dark ? "#ccc" : "#444",
      cursor: "pointer",
      fontSize: 20,
      fontWeight: 700,
      padding: "0 14px",
      flexShrink: 0,
      minHeight: 36,
    },
    privacyActive: {
      background: dark ? "rgba(0, 122, 204, 0.25)" : "rgba(0, 120, 212, 0.18)",
    },
    searchBar: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 8px",
      background: tabBarBg,
      borderBottom: `1px solid ${dark ? "#474747" : "#d0d0d0"}`,
      flexShrink: 0,
    },
    searchInput: {
      flex: 1,
      maxWidth: 240,
      background: dark ? `rgba(60, 60, 60, ${opacity})` : `rgba(255, 255, 255, ${opacity})`,
      border: `1px solid ${dark ? "#555" : "#ccc"}`,
      borderRadius: 3,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      fontSize: 12,
      padding: "3px 6px",
      outline: "none",
      fontFamily: "inherit",
    },
    searchBtn: {
      background: "transparent",
      border: "none",
      color: dark ? "#ccc" : "#444",
      cursor: "pointer",
      fontSize: 13,
      padding: "2px 6px",
      borderRadius: 3,
      minWidth: 22,
    },
    searchBtnActive: {
      background: dark ? "rgba(0, 122, 204, 0.35)" : "rgba(0, 120, 212, 0.22)",
    },
    searchCount: {
      fontSize: 11,
      color: dark ? "#999" : "#777",
      minWidth: 36,
      textAlign: "center",
    },
    updateButton: {
      alignSelf: "center",
      margin: "0 6px",
      padding: "4px 10px",
      background: dark ? "#0e639c" : "#0078d4",
      color: "white",
      border: "none",
      borderRadius: 4,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: "nowrap",
      flexShrink: 0,
    },
    editor: {
      flex: 1,
      display: "flex",
      overflow: "hidden",
    },
    textarea: {
      width: "100%",
      height: "100%",
      background: bg,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      border: "none",
      padding: 16,
      fontSize: 14,
      lineHeight: 1.6,
      fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'SF Mono', monospace",
      resize: "none",
      outline: "none",
    },
    empty: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: dark ? "#666" : "#999",
      gap: 12,
    },
    emptyButton: {
      padding: "8px 16px",
      background: dark ? "#0e639c" : "#0078d4",
      color: "white",
      border: "none",
      borderRadius: 3,
      cursor: "pointer",
      fontSize: 13,
    },
  };
}
