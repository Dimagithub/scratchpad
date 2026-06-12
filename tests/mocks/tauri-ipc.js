(function () {
  // In-memory state
  var notes = [];
  var eventListeners = {};
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

  // Dispatch table for all invoke commands the app uses
  function dispatch(cmd, args) {
    switch (cmd) {
      case "get_notes":
        return Promise.resolve(JSON.parse(JSON.stringify(notes)));

      case "create_new_note": {
        var note = {
          id: crypto.randomUUID(),
          title: "Notepad Test",
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

      // Tauri event system: listen() calls invoke("plugin:event|listen", { event, handler: callbackId })
      case "plugin:event|listen": {
        var event = args.event;
        var handler = args.handler;
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(handler); // handler is a callback ID in callbackRegistry
        return Promise.resolve(nextId++); // return an event handle (used for unlisten)
      }

      case "plugin:event|unlisten":
        return Promise.resolve(null);

      default:
        console.warn("[tauri-mock] Unhandled command:", cmd, args);
        return Promise.resolve(null);
    }
  }

  // The __TAURI_INTERNALS__ object is what @tauri-apps/api reads.
  // invoke(cmd, args, successCbId, errorCbId) — success/error are callback IDs.
  window.__TAURI_INTERNALS__ = {
    transformCallback: transformCallback,
    invoke: function (cmd, args, successCbId, errorCbId) {
      dispatch(cmd, args)
        .then(function (result) {
          var cb = callbackRegistry[successCbId];
          if (cb) cb(result);
        })
        .catch(function (err) {
          var cb = callbackRegistry[errorCbId];
          if (cb) cb(String(err));
        });
    },
  };

  // Test helpers — called from Playwright via page.evaluate()
  window.__TEST_EMIT__ = function (event, payload) {
    var cbIds = eventListeners[event] || [];
    cbIds.forEach(function (cbId) {
      var cb = callbackRegistry[cbId];
      if (cb) cb({ event: event, payload: payload, id: Date.now() });
    });
  };

  window.__TEST_RESET__ = function () {
    notes = [];
    eventListeners = {};
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
