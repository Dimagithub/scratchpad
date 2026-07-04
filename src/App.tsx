import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { lintMarkdown, type LintIssue } from "./markdownLint";

type TabPosition = "top" | "left" | "right";

interface Note {
  id: string;
  title: string;
  content: string;
  created_at: number;
  private: boolean;
}

interface Screenshot {
  name: string;
  data_url: string;
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
  const [tabPosition, setTabPosition] = useState<TabPosition>("top");
  const [showPreview, setShowPreview] = useState(false);
  const [lintResults, setLintResults] = useState<LintIssue[] | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [showScreens, setShowScreens] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  const contentRef = useRef("");
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    invoke<{ theme: string; opacity: number; tab_position?: string }>("get_settings")
      .then((s) => {
        setTheme(s.theme as "dark" | "light");
        setOpacity(s.opacity);
        setTabPosition((s.tab_position as TabPosition) || "top");
      })
      .catch(console.error);
  }, []);

  useTauriEvent<{ theme?: string; opacity?: number; tab_position?: string }>("settings-changed", (p) => {
    if (p.theme !== undefined) setTheme(p.theme as "dark" | "light");
    if (p.opacity !== undefined) setOpacity(p.opacity);
    if (p.tab_position !== undefined) setTabPosition(p.tab_position as TabPosition);
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

  useEffect(() => {
    const note = notes.find((n) => n.id === activeId);
    invoke("set_active_note_context", { title: note?.title ?? "" }).catch(console.error);
  }, [activeId, notes]);

  useTauriEvent<string>("update-available", (v) => setUpdateVersion(v));

  // View → Quick Help opens the same modal as the ? key.
  useTauriEvent<null>("show-help", () => setHelpOpen(true));

  useTauriEvent<string>("export-note-to", (path) => {
    invoke("export_note", { path, content: contentRef.current }).catch((err) => {
      console.error("Export failed:", err);
    });
  });

  useTauriEvent<Note>("note-imported", (note) => {
    setNotes((prev) => [...prev, note]);
    setShowScreens(false);
    setActiveId(note.id);
  });

  useEffect(() => {
    invoke<Screenshot[]>("list_screenshots").then(setScreenshots).catch(console.error);
  }, []);

  const handleScreenshot = async () => {
    invoke("play_sound").catch(() => {}); // audible feedback the capture fired
    setCapturing(true);
    try {
      const shot = await invoke<Screenshot | null>("take_screenshot");
      if (shot) {
        setScreenshots((prev) => [shot, ...prev.filter((s) => s.name !== shot.name)]);
        setShowScreens(true);
      }
    } catch (err) {
      console.error("Screenshot failed:", err);
    } finally {
      setCapturing(false);
    }
  };

  // Global ⌃⌘4 hotkey routes through the same capture flow as the 📷 button.
  // Guard against re-entrancy so a held key doesn't stack capture sessions.
  useTauriEvent<null>("take-screenshot", () => { if (!capturing) handleScreenshot(); }, [capturing]);

  const [copiedName, setCopiedName] = useState<string | null>(null);
  const copyScreenshot = (name: string) => {
    invoke("copy_screenshot", { name }).catch(console.error);
    setCopiedName(name);
    setTimeout(() => setCopiedName((c) => (c === name ? null : c)), 1200);
  };

  const openScreenshot = (name: string) =>
    invoke("open_screenshot", { name }).catch(console.error);

  const deleteScreenshot = async (name: string) => {
    try {
      await invoke("delete_screenshot", { name });
    } catch (err) {
      console.error("Delete failed:", err);
    }
    setScreenshots((prev) => {
      const next = prev.filter((s) => s.name !== name);
      if (next.length === 0) setShowScreens(false);
      return next;
    });
  };

  const deleteAllScreenshots = async () => {
    try {
      await invoke("delete_all_screenshots");
    } catch (err) {
      console.error("Delete all failed:", err);
    }
    setScreenshots([]);
    setShowScreens(false);
  };

  const [noteCopied, setNoteCopied] = useState(false);
  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("navigator.clipboard failed, falling back to copy_text:", err);
      invoke("copy_text", { text: content }).catch(console.error);
    }
    setNoteCopied(true);
    setTimeout(() => setNoteCopied(false), 1400);
  };

  const openNote = (id: string) => {
    setShowScreens(false);
    setActiveId(id);
  };

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
      const inField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (!activeIdRef.current) return;
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.select(), 0);
      } else if (e.key === "Escape") {
        // Help sits on top as a modal overlay, so it takes priority over
        // closing the search bar underneath.
        if (helpOpen) setHelpOpen(false);
        else if (searchOpen) closeSearch();
      } else if (e.key === "?" && !inField) {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, helpOpen]);

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

  // Live-rendered, sanitized markdown for the preview pane. Never render the raw
  // marked() output directly — always run it through DOMPurify.
  const previewHtml = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [content]);

  const runValidate = () => setLintResults(lintMarkdown(content));

  const isSidebar = tabPosition !== "top";
  const canMarkdown = !showScreens && !!activeNote && !activeNote.private;

  const styles = useMemo(() => getStyles(theme, opacity, tabPosition), [theme, opacity, tabPosition]);

  const tabsList = (
    <div style={isSidebar ? styles.tabsVertical : styles.tabs} data-testid="tab-list">
      {screenshots.length > 0 && (
        <div
          onClick={() => setShowScreens(true)}
          data-testid="screenshots-tab"
          data-active={showScreens ? "true" : "false"}
          style={{
            ...(isSidebar ? styles.tabVertical : styles.tab),
            ...(showScreens ? (isSidebar ? styles.tabActiveVertical : styles.tabActive) : {}),
            ...(isSidebar ? {} : { minWidth: "auto" }),
          }}
        >
          <span style={styles.tabTitle}>📷 Screenshots ({screenshots.length})</span>
        </div>
      )}
      {notes.map((note) => (
        <div
          key={note.id}
          onClick={() => openNote(note.id)}
          data-testid="tab"
          data-active={!showScreens && note.id === activeId ? "true" : "false"}
          style={{
            ...(isSidebar ? styles.tabVertical : styles.tab),
            ...(!showScreens && note.id === activeId
              ? (isSidebar ? styles.tabActiveVertical : styles.tabActive)
              : {}),
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
  );

  const toolbar = (
    <div style={isSidebar ? styles.toolbarSidebar : styles.toolbarTop}>
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
      {canMarkdown && (
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
      {canMarkdown && (
        <button
          onClick={runValidate}
          style={{ ...styles.addButton, fontSize: 14 }}
          title="Validate Markdown"
          data-testid="md-validate"
        >
          ✓
        </button>
      )}
      {canMarkdown && (
        <button
          onClick={() => setShowPreview((v) => !v)}
          style={{ ...styles.addButton, fontSize: 14, display: "inline-flex", alignItems: "center", ...(showPreview ? styles.privacyActive : {}) }}
          title="Toggle Markdown preview"
          data-testid="md-preview-toggle"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="12" y1="4" x2="12" y2="20" />
          </svg>
        </button>
      )}
      <button
        onClick={handleScreenshot}
        disabled={capturing}
        style={{ ...styles.addButton, fontSize: 15 }}
        title="Take screenshot — ⌃⌘4 (copies to clipboard)"
        data-testid="screenshot-button"
      >
        📷
      </button>
      {!showScreens && activeNote && (
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
  );

  const searchBar = !showScreens && searchOpen && activeNote && !activeNote.private && (
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
  );

  const lintPanel = canMarkdown && lintResults !== null && (
    <div style={styles.lintPanel} data-testid="md-lint-results">
      <div style={styles.lintHeader}>
        <span style={{ fontWeight: 600 }}>Markdown check</span>
        <button
          onClick={() => setLintResults(null)}
          style={styles.searchBtn}
          title="Dismiss"
          data-testid="md-lint-close"
        >
          ×
        </button>
      </div>
      {lintResults.length === 0 ? (
        <div style={styles.lintOk} data-testid="md-lint-ok">✓ Markdown looks good</div>
      ) : (
        <div style={styles.lintList}>
          {lintResults.map((r, i) => (
            <div key={i} style={styles.lintItem} data-testid="md-lint-item">
              line {r.line}: {r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const contentArea = (
    <div style={showScreens ? styles.galleryWrap : styles.editor}>
      {!showScreens && activeNote && !activeNote.private && !showPreview && (
        <div style={styles.copyFab}>
          {noteCopied && <span style={styles.copyTip} data-testid="note-copied-tip">Copied</span>}
          <button
            onClick={copyNote}
            className="copy-fab-btn"
            style={styles.copyBtn}
            title="Copy note"
            aria-label="Copy note"
            data-testid="copy-note"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      )}
      {showScreens ? (
        <>
          <div style={styles.galleryHeader}>
            <button
              onClick={deleteAllScreenshots}
              className="shot-btn"
              style={{ ...styles.shotBtn, flex: "0 0 auto", padding: "3px 12px" }}
              data-testid="shot-delete-all"
            >
              Delete all
            </button>
          </div>
          <div style={styles.gallery} data-testid="gallery">
            {screenshots.map((s) => (
              <div key={s.name} style={styles.shotCard} data-testid="shot-card">
                <img
                  src={s.data_url}
                  alt={s.name}
                  style={{ ...styles.shotImg, cursor: "pointer" }}
                  onClick={() => openScreenshot(s.name)}
                  data-testid="shot-open"
                />
                <div style={styles.shotActions}>
                  <button
                    onClick={() => copyScreenshot(s.name)}
                    className="shot-btn"
                    style={{ ...styles.shotBtn, ...(copiedName === s.name ? styles.shotBtnDone : {}) }}
                    data-testid="shot-copy"
                  >
                    {copiedName === s.name ? "Copied ✓" : "Copy"}
                  </button>
                  <button
                    onClick={() => deleteScreenshot(s.name)}
                    className="shot-btn"
                    style={styles.shotBtn}
                    data-testid="shot-delete"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : activeNote ? (
        activeNote.private ? (
          <textarea
            value={"•".repeat(content.length)}
            readOnly
            style={styles.textarea}
            spellCheck={false}
            data-testid="editor"
          />
        ) : showPreview ? (
          <>
            <textarea
              ref={editorRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Start typing..."
              style={styles.textareaSplit}
              spellCheck={false}
              data-testid="editor"
            />
            <div style={styles.previewPane} data-testid="md-preview">
              <style>{previewCss(theme)}</style>
              <div style={styles.previewToolbar}>
                <button
                  onClick={copyNote}
                  className="shot-btn"
                  style={{ ...styles.shotBtn, ...(noteCopied ? styles.shotBtnDone : {}) }}
                  title="Copy source"
                  data-testid="md-preview-copy"
                >
                  {noteCopied ? "Copied ✓" : "Copy source"}
                </button>
              </div>
              <div
                className="md-preview-body"
                style={styles.previewBody}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </>
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
  );

  const mainColumn = (
    <div style={styles.mainColumn}>
      {searchBar}
      {lintPanel}
      {contentArea}
    </div>
  );

  const helpModal = helpOpen && (
    <div
      style={styles.helpBackdrop}
      data-testid="help-modal"
      onClick={() => setHelpOpen(false)}
    >
      <div style={styles.helpCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.helpHeader}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Quick Help</span>
          <button
            onClick={() => setHelpOpen(false)}
            style={styles.searchBtn}
            title="Close (Esc)"
            data-testid="help-close"
          >
            ×
          </button>
        </div>
        <div style={styles.helpBody}>
          <div>
            <div style={styles.helpSectionTitle}>Notes</div>
            <div>
              Click <kbd style={styles.helpKey}>+</kbd> for a new note.
              Double-click a tab title to rename it. Click{" "}
              <kbd style={styles.helpKey}>×</kbd> on a tab to close it. Notes
              are written in Markdown.
            </div>
          </div>
          <div>
            <div style={styles.helpSectionTitle}>Find</div>
            <div style={styles.helpRow}>
              <span>Search within a note</span>
              <span><kbd style={styles.helpKey}>⌘F</kbd> or 🔍</span>
            </div>
            <div style={styles.helpRow}>
              <span>Toggle match case</span>
              <span>Aa button</span>
            </div>
            <div style={styles.helpRow}>
              <span>Cycle matches</span>
              <span>
                <kbd style={styles.helpKey}>↑</kbd>/<kbd style={styles.helpKey}>↓</kbd> or{" "}
                <kbd style={styles.helpKey}>⏎</kbd>/<kbd style={styles.helpKey}>⇧⏎</kbd>
              </span>
            </div>
          </div>
          <div>
            <div style={styles.helpSectionTitle}>Screenshots</div>
            <div style={styles.helpRow}>
              <span>Capture a region</span>
              <span>📷 or <kbd style={styles.helpKey}>⌃⌘4</kbd></span>
            </div>
            <div>
              Captures are copied to the clipboard and saved to the
              Screenshots tab. In the gallery, click a thumbnail to open it
              full-size, or use Copy / Delete / Delete all.
            </div>
          </div>
          <div>
            <div style={styles.helpSectionTitle}>Markdown</div>
            <div style={styles.helpRow}>
              <span>Toggle side-by-side preview</span>
              <span>▥ button</span>
            </div>
            <div style={styles.helpRow}>
              <span>Lint markdown</span>
              <span>Validate (✓)</span>
            </div>
            <div style={styles.helpRow}>
              <span>Copy note text</span>
              <span>copy button, top-right</span>
            </div>
          </div>
          <div>
            <div style={styles.helpSectionTitle}>Privacy</div>
            <div>
              🔒/🔓 button (or View → Privacy Mode) masks a note's content.
            </div>
          </div>
          <div>
            <div style={styles.helpSectionTitle}>Window &amp; View</div>
            <div>
              Menu bar → View: Tab Position (Top / Left / Right), Theme,
              Opacity, Always on Top.
            </div>
            <div style={styles.helpRow}>
              <span>Show/focus window from anywhere</span>
              <span><kbd style={styles.helpKey}>⌘⇧S</kbd></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={styles.root} data-testid="app-root" data-tabpos={tabPosition}>
      {helpModal}
      {tabPosition === "top" ? (
        <>
          <div style={styles.tabBar}>
            {tabsList}
            {toolbar}
          </div>
          {mainColumn}
        </>
      ) : tabPosition === "left" ? (
        <>
          <div style={styles.sidebar} data-testid="sidebar">
            {toolbar}
            {tabsList}
          </div>
          {mainColumn}
        </>
      ) : (
        <>
          {mainColumn}
          <div style={styles.sidebar} data-testid="sidebar">
            {toolbar}
            {tabsList}
          </div>
        </>
      )}
    </div>
  );
}

// Scoped CSS for rendered-markdown descendants (inline styles can't reach the
// children produced by dangerouslySetInnerHTML).
function previewCss(theme: "dark" | "light"): string {
  const dark = theme === "dark";
  const codeBg = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const border = dark ? "#474747" : "#d0d0d0";
  const link = dark ? "#4ea0ff" : "#0366d6";
  return `
.md-preview-body h1,.md-preview-body h2,.md-preview-body h3,.md-preview-body h4,.md-preview-body h5,.md-preview-body h6{margin:0.6em 0 0.3em;line-height:1.25;}
.md-preview-body h1{font-size:1.6em;} .md-preview-body h2{font-size:1.35em;} .md-preview-body h3{font-size:1.15em;}
.md-preview-body p{margin:0.4em 0;}
.md-preview-body a{color:${link};text-decoration:underline;}
.md-preview-body code{font-family:'SF Mono','Fira Code',monospace;background:${codeBg};padding:1px 4px;border-radius:3px;font-size:0.9em;}
.md-preview-body pre{background:${codeBg};padding:10px;border-radius:4px;overflow-x:auto;}
.md-preview-body pre code{background:none;padding:0;}
.md-preview-body ul,.md-preview-body ol{margin:0.4em 0;padding-left:1.4em;}
.md-preview-body blockquote{margin:0.4em 0;padding-left:0.8em;border-left:3px solid ${border};color:${dark ? "#999" : "#666"};}
.md-preview-body table{border-collapse:collapse;margin:0.5em 0;}
.md-preview-body th,.md-preview-body td{border:1px solid ${border};padding:4px 8px;}
.md-preview-body img{max-width:100%;}
.md-preview-body hr{border:none;border-top:1px solid ${border};margin:0.8em 0;}
`;
}

function getStyles(theme: "dark" | "light", opacity: number, tabPosition: TabPosition): Record<string, React.CSSProperties> {
  const dark = theme === "dark";
  const bg = dark ? `rgba(30, 30, 30, ${opacity})` : `rgba(255, 255, 255, ${opacity})`;
  const tabBarBg = dark ? `rgba(45, 45, 48, ${opacity})` : `rgba(240, 240, 240, ${opacity})`;
  const tabBg = dark ? `rgba(45, 45, 45, ${opacity})` : `rgba(228, 228, 228, ${opacity})`;
  const border = dark ? "#474747" : "#d0d0d0";
  const isSidebar = tabPosition !== "top";
  const SIDEBAR_W = 184;
  return {
    root: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: isSidebar ? "row" : "column",
      background: bg,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      fontSize: 13,
    },
    mainColumn: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minWidth: 0,
    },
    sidebar: {
      display: "flex",
      flexDirection: "column",
      width: SIDEBAR_W,
      flexShrink: 0,
      background: tabBarBg,
      overflow: "hidden",
      borderRight: tabPosition === "left" ? `1px solid ${border}` : undefined,
      borderLeft: tabPosition === "right" ? `1px solid ${border}` : undefined,
    },
    toolbarTop: {
      display: "flex",
      alignItems: "center",
      flexShrink: 0,
    },
    toolbarSidebar: {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      padding: "4px 4px",
      borderBottom: `1px solid ${border}`,
      flexShrink: 0,
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
    tabsVertical: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
    },
    tabVertical: {
      display: "flex",
      alignItems: "center",
      padding: "0 8px",
      borderBottom: `1px solid ${dark ? "#3c3c3c" : "#d0d0d0"}`,
      cursor: "pointer",
      width: "100%",
      minHeight: 34,
      background: tabBg,
      gap: 6,
      flexShrink: 0,
      boxSizing: "border-box",
    },
    tabActiveVertical: {
      background: bg,
      borderLeft: `3px solid ${dark ? "#007acc" : "#0078d4"}`,
      paddingLeft: 5,
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
      position: "relative",
    },
    copyFab: {
      position: "absolute",
      top: 10,
      right: 14,
      zIndex: 5,
      display: "flex",
      alignItems: "center",
      gap: 8,
    },
    copyBtn: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 30,
      height: 30,
      padding: 0,
      borderRadius: 8,
      cursor: "pointer",
      color: dark ? "#cfd5df" : "#4a4a4a",
      background: dark ? "rgba(60,60,63,0.85)" : "rgba(255,255,255,0.9)",
      border: `1px solid ${dark ? "#4a4a4d" : "#d5d5d5"}`,
      backdropFilter: "blur(4px)",
      boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
    },
    copyTip: {
      fontSize: 11,
      fontWeight: 600,
      color: "#fff",
      background: dark ? "#2ea043" : "#1a7f37",
      padding: "3px 8px",
      borderRadius: 6,
      whiteSpace: "nowrap",
      boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
    },
    galleryWrap: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    galleryHeader: {
      display: "flex",
      justifyContent: "flex-end",
      padding: "8px 16px 0",
      flexShrink: 0,
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
    textareaSplit: {
      flex: 1,
      minWidth: 0,
      height: "100%",
      background: bg,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      border: "none",
      borderRight: `1px solid ${border}`,
      padding: 16,
      fontSize: 14,
      lineHeight: 1.6,
      fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'SF Mono', monospace",
      resize: "none",
      outline: "none",
    },
    previewPane: {
      flex: 1,
      minWidth: 0,
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: bg,
      overflow: "hidden",
    },
    previewToolbar: {
      display: "flex",
      justifyContent: "flex-end",
      padding: "6px 8px",
      borderBottom: `1px solid ${border}`,
      flexShrink: 0,
    },
    previewBody: {
      flex: 1,
      overflowY: "auto",
      padding: "8px 16px",
      fontSize: 14,
      lineHeight: 1.6,
      color: dark ? "#d4d4d4" : "#1a1a1a",
      wordWrap: "break-word",
    },
    lintPanel: {
      background: tabBarBg,
      borderBottom: `1px solid ${border}`,
      padding: "6px 10px",
      flexShrink: 0,
      maxHeight: 160,
      overflowY: "auto",
      fontSize: 12,
    },
    lintHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    lintList: {
      display: "flex",
      flexDirection: "column",
      gap: 2,
    },
    lintItem: {
      color: dark ? "#e0a0a0" : "#a03030",
      fontFamily: "'SF Mono', monospace",
      fontSize: 12,
    },
    lintOk: {
      color: dark ? "#8fce8f" : "#2e7d32",
    },
    gallery: {
      flex: 1,
      overflowY: "auto",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
      gap: 12,
      padding: 16,
      alignContent: "start",
    },
    shotCard: {
      display: "flex",
      flexDirection: "column",
      border: `1px solid ${dark ? "#474747" : "#d0d0d0"}`,
      borderRadius: 4,
      overflow: "hidden",
      background: dark ? "rgba(45,45,48,1)" : "rgba(248,248,248,1)",
    },
    shotImg: {
      width: "100%",
      height: 120,
      objectFit: "contain",
      background: dark ? "#1e1e1e" : "#fff",
    },
    shotActions: {
      display: "flex",
      gap: 6,
      padding: 6,
      justifyContent: "center",
    },
    shotBtn: {
      flex: 1,
      background: "transparent",
      border: `1px solid ${dark ? "#555" : "#ccc"}`,
      borderRadius: 3,
      color: dark ? "#ccc" : "#444",
      cursor: "pointer",
      fontSize: 12,
      padding: "3px 0",
    },
    shotBtnDone: {
      background: dark ? "rgba(48,209,88,0.22)" : "rgba(40,167,69,0.18)",
      borderColor: dark ? "#30d158" : "#28a745",
      color: dark ? "#7ee787" : "#1a7f37",
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
    helpBackdrop: {
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    helpCard: {
      width: 440,
      maxWidth: "90%",
      maxHeight: "82%",
      display: "flex",
      flexDirection: "column",
      background: dark ? "rgb(37, 37, 38)" : "rgb(255, 255, 255)",
      color: dark ? "#d4d4d4" : "#1a1a1a",
      border: `1px solid ${border}`,
      borderRadius: 8,
      boxShadow: "0 8px 30px rgba(0, 0, 0, 0.4)",
      overflow: "hidden",
    },
    helpHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 14px",
      borderBottom: `1px solid ${border}`,
      flexShrink: 0,
    },
    helpBody: {
      padding: "12px 16px",
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      gap: 14,
      fontSize: 12.5,
      lineHeight: 1.5,
    },
    helpSectionTitle: {
      fontWeight: 600,
      fontSize: 12.5,
      marginBottom: 6,
      color: dark ? "#9cdcfe" : "#0078d4",
    },
    helpRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "3px 0",
    },
    helpKey: {
      fontFamily: "'SF Mono', 'Fira Code', monospace",
      fontSize: 11,
      background: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.08)",
      border: `1px solid ${border}`,
      borderRadius: 4,
      padding: "1px 6px",
      whiteSpace: "nowrap",
    },
  };
}
