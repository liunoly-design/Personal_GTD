// Notes has no public scripting tag field. This helper uses the native editor.
import AppKit
import ApplicationServices

struct Failure: Error { let code: String }
var nativePhase="read"
func fail(_ code:String) throws -> Never { throw Failure(code:code) }
// Shared by the read-only diagnostic and the native tag activation path.
func tagActivationRange(_ raw:NSString,_ tag:String) throws -> (range:NSRange,temporaryDelimiter:Bool) {
    let pattern="(?<![\\p{L}\\p{N}_])"+NSRegularExpression.escapedPattern(for:tag)+"(?![\\p{L}\\p{N}_-])"
    let regex=try NSRegularExpression(pattern:pattern)
    let matches=regex.matches(in:raw as String,range:NSRange(location:0,length:raw.length))
    guard !matches.isEmpty else {try fail("TAG_READ_FAILED")}
    // Prose may mention the same tag before its heading, followed by punctuation.
    // Activate an existing whitespace delimiter without inserting or changing text.
    let eligible=matches.filter {match in
        let before=match.range.location
        let after=before+match.range.length
        guard after<raw.length else {return false}
        let delimiter=raw.substring(with:NSRange(location:after,length:1))
        let prefix=before==0 ? "\n" : raw.substring(with:NSRange(location:before-1,length:1))
        // Notes does not activate a pasted token touching a preceding colon.
        return (delimiter == " " || delimiter == "\n") && (prefix == " " || prefix == "\n" || prefix == "\t")
    }
    let heading=eligible.first {match in
        let prefix=raw.substring(to:match.range.location).components(separatedBy:"\n").last ?? ""
        return ["# ","## ","### "].contains(prefix)
    }
    if let match=heading ?? eligible.first {return (match.range,false)}
    // With no supported prefix, keep an existing delimiter unchanged; do not
    // turn a failed activation into an extra inserted space.
    let fallback=matches[0].range
    let after=fallback.location+fallback.length
    let delimiter=after<raw.length ? raw.substring(with:NSRange(location:after,length:1)) : ""
    return (fallback,delimiter != " " && delimiter != "\n")
}
func get(_ e:AXUIElement,_ key:String)->CFTypeRef? {
    var value:CFTypeRef?
    AXUIElementCopyAttributeValue(e,key as CFString,&value)
    return value
}
func editor(_ e:AXUIElement,_ depth:Int=0)->AXUIElement? {
    if depth>8 {return nil}
    let role=get(e,kAXRoleAttribute) as? String ?? ""
    if role == "AXTextArea" {return e}
    if role == "AXOutline" || role == "AXTable" {return nil}
    for child in get(e,kAXChildrenAttribute) as? [AXUIElement] ?? [] {
        if let found=editor(child,depth+1) {return found}
    }
    return nil
}
func value(_ e:AXUIElement) throws -> String {
    guard let s=get(e,kAXValueAttribute) as? String,s.utf16.count<=65536 else {try fail("UNSUPPORTED_NOTE")}
    return s
}
func read(_ e:AXUIElement) throws -> (String,[String]) {
    let text=try value(e)
    let raw=text as NSString
    var offsets:[Int]=[]
    for i in 0..<raw.length where raw.character(at:i)==0xfffc {offsets.append(i)}
    guard offsets.count<=512 else {try fail("UNSUPPORTED_NOTE")}
    var replacements:[(Int,String)]=[]
    // Notes virtualizes offscreen attachments. Select each exact character range
    // to expose its native AXAttachment instead of guessing from screen order.
    let originalSelection=get(e,kAXSelectedTextRangeAttribute)
    defer {if let original=originalSelection {AXUIElementSetAttributeValue(e,kAXSelectedTextRangeAttribute as CFString,original)}}
    for offset in offsets {
        var range=CFRange(location:offset,length:1)
        let rv=AXValueCreate(.cfRange,&range)!
        guard AXUIElementSetAttributeValue(e,kAXSelectedTextRangeAttribute as CFString,rv) == .success else {try fail("TAG_READ_FAILED")}
        var tag:String?
        for _ in 0..<4 {
            var out:CFTypeRef?
            AXUIElementCopyParameterizedAttributeValue(e,"AXAttributedStringForRange" as CFString,rv,&out)
            if let attr=out as? NSAttributedString,attr.length>0,let attachment=attr.attribute(NSAttributedString.Key("AXAttachment"),at:0,effectiveRange:nil) {
                let element=attachment as! AXUIElement
                tag=(get(element,kAXChildrenAttribute) as? [AXUIElement] ?? []).compactMap{get($0,kAXValueAttribute) as? String}.first
                if tag != nil {break}
            }
            Thread.sleep(forTimeInterval:0.03)
        }
        guard let name=tag,name.hasPrefix("#"),!name.contains("\n") else {try fail("UNSUPPORTED_NOTE")}
        replacements.append((offset,name))
    }
    let result=NSMutableString(string:text)
    for (offset,tag) in replacements.sorted(by:{$0.0>$1.0}) {result.replaceCharacters(in:NSRange(location:offset,length:1),with:tag)}
    guard try value(e)==text else {try fail("TAG_READ_FAILED")}
    return (result as String,Array(Set(replacements.map{$0.1})).sorted())
}
func select(_ e:AXUIElement,_ r:NSRange,_ expectedRaw:String? = nil) throws {
    if let expected=expectedRaw,try value(e) != expected {try fail("UI_FOCUS_CHANGED")}
    var range=CFRange(location:r.location,length:r.length)
    guard AXUIElementSetAttributeValue(e,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success,
          AXUIElementSetAttributeValue(e,kAXSelectedTextRangeAttribute as CFString,AXValueCreate(.cfRange,&range)!) == .success else {try fail("AX_SELECTION_FAILED")}
    if let expected=expectedRaw,try value(e) != expected {try fail("UI_FOCUS_CHANGED")}
    // AX selection can be accepted before the editor has applied it. Keyboard
    // input must use the observed range, not merely a successful setter reply.
    let deadline=ProcessInfo.processInfo.systemUptime+1
    var stable=0
    repeat {
        if let expected=expectedRaw,try value(e) != expected {try fail("UI_FOCUS_CHANGED")}
        var actual=CFRange(location:-1,length:-1)
        if let v=get(e,kAXSelectedTextRangeAttribute) {
            AXValueGetValue(v as! AXValue,.cfRange,&actual)
        }
        if actual.location==r.location && actual.length==r.length {stable += 1} else {stable=0}
        if stable>=2 {return}
        Thread.sleep(forTimeInterval:0.03)
    } while ProcessInfo.processInfo.systemUptime<deadline
    try fail("AX_SELECTION_FAILED")
}
func key(_ code:CGKeyCode,_ flags:CGEventFlags=[]) {
    for down in [true,false] {let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)!;event.flags=flags;event.post(tap:.cghidEventTap)}
}
func front(_ app:NSRunningApplication) throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier else {try fail("UI_FOCUS_CHANGED")}
}
// Observe completion while the temporary clipboard still belongs to this write.
// The action is dispatched once; waiting never replays a mutation.
func awaitWriteReadback(_ target:String,_ timeout:TimeInterval,_ observe:() throws -> String) throws {
    let deadline=ProcessInfo.processInfo.systemUptime+timeout
    repeat {
        do {
            // A full attachment read already checks that AXValue stayed unchanged.
            // Accept that coherent matching snapshot even if the read consumed the
            // polling window; requiring another full read falsely rejects success.
            if try observe().trimmingCharacters(in:.newlines)==target.trimmingCharacters(in:.newlines) {return}
        } catch let failure as Failure where ["UNSUPPORTED_NOTE","TAG_READ_FAILED"].contains(failure.code) {
            // Attachment accessibility metadata can lag behind the AX text value.
            // Observe again without redispatching the preceding write.
        }
        Thread.sleep(forTimeInterval:0.03)
    } while ProcessInfo.processInfo.systemUptime<deadline
    try fail("WRITE_RESULT_UNKNOWN")
}
func readReady(_ e:AXUIElement) throws -> (String,[String]) {
    let deadline=ProcessInfo.processInfo.systemUptime+2
    var lastFailure="UNSUPPORTED_NOTE"
    repeat {
        do {return try read(e)}
        catch let failure as Failure where ["UNSUPPORTED_NOTE","TAG_READ_FAILED"].contains(failure.code) {lastFailure=failure.code}
        Thread.sleep(forTimeInterval:0.03)
    } while ProcessInfo.processInfo.systemUptime<deadline
    try fail(lastFailure)
}
func paste(_ text:String,_ app:NSRunningApplication,_ e:AXUIElement,_ target:String,_ expectedRaw:String) throws {
    try front(app)
    let pb=NSPasteboard.general
    let saved=(pb.pasteboardItems ?? []).map {item in item.types.compactMap {t in item.data(forType:t).map{(t,$0)}}}
    pb.clearContents();pb.setString(text,forType:.string)
    let change=pb.changeCount
    defer {
        // Do not overwrite a clipboard change made by the user while we were editing.
        if pb.changeCount==change {
            pb.clearContents()
            let items=saved.map {entries -> NSPasteboardItem in let item=NSPasteboardItem();for (type,data) in entries {item.setData(data,forType:type)};return item}
            pb.writeObjects(items)
        }
    }
    guard pb.string(forType:.string)==text else {try fail("INVALID_INPUT")}
    try front(app)
    let beforeRaw=try value(e)
    guard beforeRaw==expectedRaw else {try fail("UI_FOCUS_CHANGED")}
    // Reading tag attachments changes selection. Do not inspect them while
    // the paste is queued, or the replacement range could be disturbed.
    nativePhase="paste-readback"
    key(9,.maskCommand)
    try awaitWriteReadback(target,2) {
        try front(app)
        let raw=try value(e)
        if raw==beforeRaw {return "\u{0}"}
        return try read(e).0
    }
}
func headingRanges(_ text:String)->[(NSRange,[String])] {
    var offset=0;var result:[(NSRange,[String])]=[]
    for line in text.components(separatedBy:"\n") {
        let names=line.hasPrefix("### ") ? ["副标题","Subheading"] : line.hasPrefix("## ") ? ["小标题","Heading"] : line.hasPrefix("# ") ? ["标题","Title"] : []
        if !names.isEmpty {result.append((NSRange(location:offset,length:(line as NSString).length),names))}
        offset += (line as NSString).length+1
    }
    return result
}
func headingStyle(_ e:AXUIElement,_ range:NSRange)->String? {
    var r=CFRange(location:range.location,length:1);var out:CFTypeRef?
    AXUIElementCopyParameterizedAttributeValue(e,"AXAttributedStringForRange" as CFString,AXValueCreate(.cfRange,&r)!,&out)
    guard let attributes=out as? NSAttributedString,attributes.length>0,let style=attributes.attribute(NSAttributedString.Key("AXStyleName"),at:0,effectiveRange:nil) as? String else {return nil}
    // Collapsible headings append state such as ", 包含段落, 已展开".
    return style.components(separatedBy:",").first?.trimmingCharacters(in:.whitespaces)
}
func formatHeadings(_ e:AXUIElement,_ root:AXUIElement,_ app:NSRunningApplication) throws {
    let before=try value(e);let headings=headingRanges(before)
    guard headings.count<=512 else {try fail("CAPACITY_EXCEEDED")}
    func find(_ node:AXUIElement,_ names:[String],_ depth:Int=0)->AXUIElement? {
        if depth>6{return nil}
        if get(node,kAXRoleAttribute) as? String == "AXMenuItem",let name=get(node,kAXTitleAttribute) as? String,names.contains(name){return node}
        for child in get(node,kAXChildrenAttribute) as? [AXUIElement] ?? [] {if let found=find(child,names,depth+1){return found}}
        return nil
    }
    guard headings.isEmpty || get(root,kAXMenuBarAttribute) != nil else {try fail("HEADING_FORMAT_FAILED")}
    for (range,names) in headings where !names.contains(headingStyle(e,range) ?? "") {
        try front(app);try select(e,range,before)
        guard let menu=find(get(root,kAXMenuBarAttribute) as! AXUIElement,names),AXUIElementPerformAction(menu,kAXPressAction as CFString) == .success else {try fail("HEADING_FORMAT_FAILED")}
        Thread.sleep(forTimeInterval:0.03)
        guard names.contains(headingStyle(e,range) ?? "") else {try fail("HEADING_FORMAT_FAILED")}
    }
    guard try value(e)==before else {try fail("WRITE_RESULT_UNKNOWN")}
}
func htmlText(_ s:String) throws -> String {
    // Only the application's generated div/br fragments are accepted, not arbitrary HTML.
    let stripped=s.replacingOccurrences(of:"(?i)<br\\s*/?>",with:"\n",options:.regularExpression)
        .replacingOccurrences(of:"(?i)</div>\\s*",with:"\n",options:.regularExpression)
        .replacingOccurrences(of:"(?i)<div>",with:"",options:.regularExpression)
    guard !stripped.contains("<"),!stripped.contains(">") else {try fail("INVALID_INPUT")}
    return stripped.replacingOccurrences(of:"&quot;",with:"\"").replacingOccurrences(of:"&lt;",with:"<")
        .replacingOccurrences(of:"&gt;",with:">").replacingOccurrences(of:"&amp;",with:"&")
}
func run() throws -> [String:Any] {
    let data=FileHandle.standardInput.readDataToEndOfFile()
    guard let input=try JSONSerialization.jsonObject(with:data) as? [String:Any],
          let expectedRaw=input["rawPlaintext"] as? String,let command=input["command"] as? String else {try fail("INVALID_INPUT")}
    if command == "checkWriteReadback" {
        nativePhase="paste-readback"
        guard let target=input["target"] as? String,let delay=input["delayMs"] as? Int,
              let timeout=input["timeoutMs"] as? Int,delay>=0,delay<=2000,timeout>0,timeout<=2000 else {try fail("INVALID_INPUT")}
        let start=ProcessInfo.processInfo.systemUptime
        try awaitWriteReadback(target,Double(timeout)/1000) {
            if let observationDelay=input["observeDelayMs"] as? Int {
                guard observationDelay>=0,observationDelay<=3000 else {try fail("INVALID_INPUT")}
                Thread.sleep(forTimeInterval:Double(observationDelay)/1000)
            }
            let ready=ProcessInfo.processInfo.systemUptime-start>=Double(delay)/1000
            if input["transientAttachment"] as? Bool == true && !ready {try fail("UNSUPPORTED_NOTE")}
            return ready ? target : expectedRaw
        }
        return ["ok":true,"value":["matched":true]]
    }
    if command == "checkTagActivation" {
        guard expectedRaw.utf16.count<=65536 else {try fail("CAPACITY_EXCEEDED")}
        guard let tag=input["tag"] as? String,tag.utf16.count<=200,tag.range(of:"^#(?:O|KR)[0-9]+$",options:.regularExpression) != nil else {try fail("INVALID_INPUT")}
        let r=try tagActivationRange(expectedRaw as NSString,tag)
        return ["ok":true,"value":["location":r.range.location,"length":r.range.length,"temporaryDelimiter":r.temporaryDelimiter]]
    }
    guard AXIsProcessTrusted() else {try fail("ACCESSIBILITY_DENIED")}
    guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Notes").first else {try fail("EDITOR_UNAVAILABLE")}
    let root=AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root,1)
    func trim(_ s:String)->String{s.trimmingCharacters(in:.newlines)}
    // Showing an ID-bound note is asynchronous too. Wait only for selection,
    // before any write is dispatched; ambiguity remains a hard conflict.
    let editorDeadline=ProcessInfo.processInfo.systemUptime+2
    var selected:AXUIElement?
    var hadEditor=false
    repeat {
        let windows=get(root,kAXWindowsAttribute) as? [AXUIElement] ?? []
        guard windows.count<=16 else {try fail("EDITOR_UNAVAILABLE")}
        let editors=windows.compactMap{editor($0)}
        hadEditor = hadEditor || !editors.isEmpty
        let matching=editors.filter{candidate in
            guard let text=try? value(candidate) else {return false}
            return trim(text)==trim(expectedRaw)
        }
        guard matching.count<=1 else {try fail("CONFLICT")}
        if let candidate=matching.first {selected=candidate;break}
        Thread.sleep(forTimeInterval:0.03)
    } while ProcessInfo.processInfo.systemUptime<editorDeadline
    guard let e=selected else {try fail(hadEditor ? "CONFLICT" : "EDITOR_UNAVAILABLE")}
    var current=try readReady(e)
    if command != "read" {
        app.activate();Thread.sleep(forTimeInterval:0.1);try front(app)
        if command == "append" || command == "replace" || command == "formatCreated" {
            guard let expected=input["expectedPlaintext"] as? String,expected==current.0 else {try fail("CONFLICT")}
            let fragment=command == "formatCreated" ? current.0 : try htmlText(input["html"] as? String ?? "")
            var desired=fragment
            if command == "replace" {
                guard (desired.hasPrefix("PGTD OKR 最新稿\n") && desired.contains("PGTD-FINAL-")) || (desired.hasPrefix("PGTD OKR 讨论稿\n") && desired.contains("PGTD-OKR-")) else {try fail("INVALID_INPUT")}
                let extras=input["preserveTags"] as? [String] ?? []
                let extra=extras.filter{tag in
                    let pattern=NSRegularExpression.escapedPattern(for:tag)+"(?![\\p{L}\\p{N}_-])"
                    return desired.range(of:pattern,options:.regularExpression)==nil
                }
                if !extra.isEmpty {desired += extra.joined(separator:" ")+"\n"}
            }
            let raw=try value(e) as NSString
            let resultingLength = (command == "append" ? current.0.utf16.count : 0)+desired.utf16.count
            guard resultingLength<=65536 else {try fail("CAPACITY_EXCEEDED")}
            let target=command == "append" ? current.0+desired : desired
            // Check structural limits before any paste, including repeated history headings.
            guard headingRanges(target).count<=512 else {try fail("CAPACITY_EXCEEDED")}
            let prospective=try NSRegularExpression(pattern:"(?<![\\p{L}\\p{N}_])#(?:O|KR)[0-9]+(?![\\p{L}\\p{N}_-])")
            let tokens=prospective.matches(in:target,range:NSRange(location:0,length:(target as NSString).length)).map{(target as NSString).substring(with:$0.range)}
            guard Set(tokens+(input["preserveTags"] as? [String] ?? [])).count<=32 else {try fail("CAPACITY_EXCEEDED")}
            if trim(current.0) != trim(target) {
                try select(e,NSRange(location:command == "append" ? raw.length : 0,length:command == "append" ? 0 : raw.length),raw as String)
                try paste(desired,app,e,target,raw as String)
            }
            current=try readReady(e)
            guard trim(current.0)==trim(target) else {try fail("WRITE_RESULT_UNKNOWN")}
        } else if command != "ensureTags" {try fail("INVALID_INPUT")}
        let pattern="(?<![\\p{L}\\p{N}_])#(?:O|KR)[0-9]+(?![\\p{L}\\p{N}_-])"
        let regex=try NSRegularExpression(pattern:pattern)
        let requested=(input["preserveTags"] as? [String] ?? [])
        let matches=regex.matches(in:current.0,range:NSRange(location:0,length:(current.0 as NSString).length)).map{(current.0 as NSString).substring(with:$0.range)}
        let tags=Array(Set(matches+requested)).sorted()
        guard tags.count<=32 else {try fail("CAPACITY_EXCEEDED")}
        for tag in tags where !current.1.contains(tag) {
            try front(app)
            let raw=try value(e) as NSString
            let r=try tagActivationRange(raw,tag)
            // Replace the existing delimiter with itself so no extra spaces accumulate.
            let after=r.range.location+r.range.length
            if r.temporaryDelimiter {
                // Prose-only tags can be followed solely by punctuation. Use a
                // temporary space, then remove only that verified inserted byte.
                try select(e,NSRange(location:after,length:0),raw as String)
                nativePhase="tag-insert"
                key(49)
                let originalText=current.0
                let inserted=raw.replacingCharacters(in:r.range,with:"\u{fffc} ")
                try awaitWriteReadback("ready",2) {try value(e)==inserted ? "ready" : ""}
                try select(e,NSRange(location:r.range.location+1,length:1),inserted)
                nativePhase="tag-delete"
                let insertedRaw=try value(e)
                key(51)
                try awaitWriteReadback(originalText,2) {
                    if try value(e)==insertedRaw {return "\u{0}"}
                    return try read(e).0
                }
            } else {
                let delimiter=raw.substring(with:NSRange(location:after,length:1))
                try select(e,NSRange(location:after,length:1),raw as String)
                key(delimiter == " " ? 49 : 36)
            }
            nativePhase="tag-readback"
            do {try awaitWriteReadback(tag,2) {
                // Expanding existing attachments changes selection. Wait for
                // this key to consume its original range before inspecting them.
                if try value(e)==raw as String {return ""}
                return try read(e).1.contains(tag) ? tag : ""
            }}
            catch let failure as Failure where failure.code == "WRITE_RESULT_UNKNOWN" {try fail("TAG_WRITE_FAILED")}
            current=try readReady(e)
        }
    }
    if command != "read" {nativePhase="heading-format";try formatHeadings(e,root,app)}
    let complete=headingRanges(try value(e)).allSatisfy{range,names in names.contains(headingStyle(e,range) ?? "")}
    return ["ok":true,"value":["plaintext":current.0,"nativeTags":current.1,"headingsComplete":complete]]
}
do {let result=try run();let data=try JSONSerialization.data(withJSONObject:result,options:.sortedKeys);print(String(data:data,encoding:.utf8)!)}
catch {let code=(error as? Failure)?.code ?? "APPLE_RESULT_UNKNOWN";print("{\"ok\":false,\"code\":\"\(code)\",\"nativePhase\":\"\(nativePhase)\"}")}
