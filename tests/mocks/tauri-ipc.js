(function () {
  // In-memory state
  var notes = [];
  var screenshots = [];
  var eventListeners = {};  // event -> [handlerCallbackId, ...]
  var eventHandleMap = {};  // eventHandle -> { event, handlerCallbackId }
  var callbackRegistry = {};
  var nextId = 1;
  var currentSettings = {
    theme: "dark",
    always_on_top: false,
    opacity: 1.0,
    storage_path: "",
  };

  // Tauri 2 internals: transformCallback stores a JS function and returns a numeric ID.
  // The invoke() success/error paths call these by ID.
  function transformCallback(fn, once) {
    var id = nextId++;
    if (once) {
      callbackRegistry[id] = function (v) {
        delete callbackRegistry[id];
        fn(v);
      };
    } else {
      callbackRegistry[id] = fn;
    }
    return id;
  }

  // Remove a handler from eventListeners by its callbackId
  function removeListener(event, handlerCallbackId) {
    if (!eventListeners[event]) return;
    eventListeners[event] = eventListeners[event].filter(function (id) {
      return id !== handlerCallbackId;
    });
    delete callbackRegistry[handlerCallbackId];
  }

  // Dispatch table for all invoke commands the app uses
  function dispatch(cmd, args) {
    switch (cmd) {
      case "get_notes":
        return Promise.resolve(JSON.parse(JSON.stringify(notes)));

      case "create_new_note": {
        var note = {
          id: crypto.randomUUID(),
          title: (args && args.title) || "Notepad Test",
          content: "",
          created_at: Date.now(),
          private: false,
        };
        notes.push(note);
        return Promise.resolve(JSON.parse(JSON.stringify(note)));
      }

      case "save_note": {
        var updated = JSON.parse(JSON.stringify(args.note));
        var idx = notes.findIndex(function (n) { return n.id === updated.id; });
        if (idx >= 0) notes[idx] = updated;
        else notes.push(updated);
        return Promise.resolve(null);
      }

      case "delete_note":
        notes = notes.filter(function (n) { return n.id !== args.noteId; });
        return Promise.resolve(null);

      case "rename_note": {
        var found = notes.find(function (n) { return n.id === args.noteId; });
        if (found) found.title = args.newTitle;
        return Promise.resolve(null);
      }

      case "get_settings":
        return Promise.resolve(JSON.parse(JSON.stringify(currentSettings)));

      case "install_update":
        return Promise.resolve(null);

      case "list_screenshots":
        return Promise.resolve(JSON.parse(JSON.stringify(screenshots)));

      case "take_screenshot": {
        var shot = {
          name: "shot-" + nextId++ + ".png",
          // 1x1 transparent PNG
          data_url:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/A0kAAAAAElFTkSuQmCC",
        };
        screenshots.unshift(shot);
        return Promise.resolve(JSON.parse(JSON.stringify(shot)));
      }

      case "copy_screenshot":
        return Promise.resolve(null);

      case "delete_screenshot":
        screenshots = screenshots.filter(function (s) { return s.name !== args.name; });
        return Promise.resolve(null);

      // Tauri event system: listen() calls invoke("plugin:event|listen", { event, handler: callbackId })
      case "plugin:event|listen": {
        var event = args.event;
        var handlerCallbackId = args.handler;
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handlerCallbackId);
        // Return a unique eventHandle that maps back to this registration
        var eventHandle = nextId++;
        eventHandleMap[eventHandle] = { event: event, handlerCallbackId: handlerCallbackId };
        return Promise.resolve(eventHandle);
      }

      case "plugin:event|unlisten": {
        // Remove listener by eventId (the handle returned from listen)
        var eventId = args.eventId;
        var entry = eventHandleMap[eventId];
        if (entry) {
          removeListener(entry.event, entry.handlerCallbackId);
          delete eventHandleMap[eventId];
        }
        return Promise.resolve(null);
      }

      default:
        console.warn("[tauri-mock] Unhandled command:", cmd, args);
        return Promise.resolve(null);
    }
  }

  // Tauri 2: __TAURI_INTERNALS__.invoke(cmd, args, options) must return a Promise.
  // The API layer does: return window.__TAURI_INTERNALS__.invoke(cmd, args, options)
  // transformCallback is still needed — listen() uses it to store event handlers.
  window.__TAURI_INTERNALS__ = {
    transformCallback: transformCallback,
    invoke: function (cmd, args) {
      return dispatch(cmd, args);
    },
  };

  // Required by Tauri's _unlisten helper — called synchronously before invoke('unlisten')
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: function (event, eventId) {
      var entry = eventHandleMap[eventId];
      if (entry) {
        removeListener(entry.event, entry.handlerCallbackId);
        delete eventHandleMap[eventId];
      }
    },
  };

  // Test helpers — called from Playwright via page.evaluate()
  window.__TEST_EMIT__ = function (event, payload) {
    var cbIds = (eventListeners[event] || []).slice(); // snapshot to avoid mutation issues
    cbIds.forEach(function (cbId) {
      var cb = callbackRegistry[cbId];
      if (cb) cb({ event: event, payload: payload, id: Date.now() });
    });
  };

  window.__TEST_RESET__ = function () {
    notes = [];
    screenshots = [];
    eventListeners = {};
    eventHandleMap = {};
    callbackRegistry = {};
    nextId = 1;
    currentSettings = {
      theme: "dark",
      always_on_top: false,
      opacity: 1.0,
      storage_path: "",
    };
  };
})();
