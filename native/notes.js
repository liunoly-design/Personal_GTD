// JXA, executed by /usr/bin/osascript. JSON arrives via stdin, never script interpolation.
ObjC.import('Foundation');
function run() {
  try {
    var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    var input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
    var app = Application('Notes');
    function fail(code) { throw new Error(code); }
    function unique(items) { if (items.length !== 1) fail('LOCATION_NOT_UNIQUE'); return items[0]; }
    function folderFor(account, id) {
      return unique(account.folders.whose({ id: id })());
    }
    function snapshot(note) {
      if (note.passwordProtected() || note.shared() || note.attachments.length > 0) fail('UNSUPPORTED_NOTE');
      var body = note.body();
      if (body.length > 32768) fail('CAPACITY_EXCEEDED');
      return { id: note.id(), body: body, plaintext: note.plaintext() };
    }
    if (input.command === 'bind') {
      var account = unique(app.accounts.whose({ name: input.account })());
      var folder = unique(account.folders.whose({ name: input.folder })());
      if (folder.shared()) fail('UNSUPPORTED_FOLDER');
      return JSON.stringify({ ok: true, value: { accountId: account.id(), folderId: folder.id() } });
    }
    var account = unique(app.accounts.whose({ id: input.accountId })());
    var folder = folderFor(account, input.folderId);
    if (folder.shared()) fail('UNSUPPORTED_FOLDER');
    if (folder.notes.length > 1000) fail('CAPACITY_EXCEEDED');
    var value;
    if (input.command === 'create') {
      var probeTitle = /^PGTD F101 合成测试 PGTD-F101-[a-f0-9-]{36}$/.test(input.title);
      var okrTitle = input.title === 'PGTD OKR 日志' && /PGTD-OKR-[a-f0-9-]{36}/.test(input.body);
      if ((!probeTitle && !okrTitle) || typeof input.body !== 'string' || input.body.length > 32768) fail('INVALID_INPUT');
      var note = app.Note({ body: input.body });
      folder.notes.push(note);
      value = snapshot(note);
    } else if (input.command === 'find') {
      var candidates = folder.notes.whose({ name: input.title })();
      if (candidates.length > 10) fail('CAPACITY_EXCEEDED');
      value = candidates.map(snapshot).filter(function(n) { return n.plaintext.indexOf(input.marker) >= 0; });
    } else if (input.command === 'read' || input.command === 'append') {
      var note = unique(folder.notes.whose({ id: input.noteId })());
      var before = snapshot(note);
      if (input.command === 'append') {
        if (before.body !== input.expectedBody) fail('CONFLICT');
        if ((before.body + input.addition).length > 32768) fail('CAPACITY_EXCEEDED');
        note.body = before.body + input.addition;
      }
      value = snapshot(note);
    } else fail('INVALID_INPUT');
    return JSON.stringify({ ok: true, value: value });
  } catch (error) {
    var known = ['LOCATION_NOT_UNIQUE', 'UNSUPPORTED_NOTE', 'UNSUPPORTED_FOLDER', 'CAPACITY_EXCEEDED', 'CONFLICT', 'INVALID_INPUT'];
    var code = known.indexOf(error.message) >= 0 ? error.message : (error.errorNumber === -1743 ? 'PERMISSION_DENIED' : 'APPLE_RESULT_UNKNOWN');
    return JSON.stringify({ ok: false, code: code });
  }
}
