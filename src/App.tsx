import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
// import { listen } from "@tauri-apps/api/event"; // uncommented in Task 6

interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  private: boolean;
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
    invoke<{ theme: string; always_on_top: boolean; opacity: number }>("get_settings")
      .then((s) => {
        setTheme(s.theme as "dark" | "light");
        setOpacity(s.opacity);
      })
      .catch(console.error);
  }, []);

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
      const note = await invoke<Note>("create_new_note");
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
    <div style={styles.root}>
      <div style={styles.tabBar}>
        <div style={styles.tabs}>
          {notes.map((note) => (
            <div
              key={note.id}
              onClick={() => setActiveId(note.id)}
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
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button onClick={handleAdd} style={styles.addButton}>
          +
        </button>
      </div>

      <div style={styles.editor}>
        {activeNote ? (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Start typing..."
            style={styles.textarea}
            spellCheck={false}
          />
        ) : (
          <div style={styles.empty}>
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
      background: dark ? "#3c3c3c" : "#ffffff",
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
