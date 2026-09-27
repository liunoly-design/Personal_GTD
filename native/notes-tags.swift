// Notes has no public scripting tag field. This helper uses the native editor.
import AppKit
import ApplicationServices

struct Failure: Error { let code: String }
func fail(_ code:String) throws -> Never { throw Failure(code:code) }
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
    guard let s=get(e,kAXValueAttribute) as? String,s.utf16.count<=32768 else {try fail("UNSUPPORTED_NOTE")}
    return s
}
func read(_ e:AXUIElement) throws -> (String,[String]) {
    let text=try value(e)
    let raw=text as NSString
    var offsets:[Int]=[]
    for i in 0..<raw.length where raw.character(at:i)==0xfffc {offsets.append(i)}
    guard offsets.count<=128 else {try fail("UNSUPPORTED_NOTE")}
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
    return (result as String,Array(Set(replacements.map{$0.1})).sorted())
}
func select(_ e:AXUIElement,_ r:NSRange) throws {
    var range=CFRange(location:r.location,length:r.length)
    guard AXUIElementSetAttributeValue(e,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success,
          AXUIElementSetAttributeValue(e,kAXSelectedTextRangeAttribute as CFString,AXValueCreate(.cfRange,&range)!) == .success else {try fail("AX_SELECTION_FAILED")}
}
func key(_ code:CGKeyCode,_ flags:CGEventFlags=[]) {
    for down in [true,false] {let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)!;event.flags=flags;event.post(tap:.cghidEventTap)}
}
func front(_ app:NSRunningApplication) throws {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier else {try fail("UI_FOCUS_CHANGED")}
}
func paste(_ text:String,_ app:NSRunningApplication) throws {
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
    key(9,.maskCommand);Thread.sleep(forTimeInterval:0.15)
    try front(app)
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
    guard headings.count<=128 else {try fail("CAPACITY_EXCEEDED")}
    func find(_ node:AXUIElement,_ names:[String],_ depth:Int=0)->AXUIElement? {
        if depth>6{return nil}
        if get(node,kAXRoleAttribute) as? String == "AXMenuItem",let name=get(node,kAXTitleAttribute) as? String,names.contains(name){return node}
        for child in get(node,kAXChildrenAttribute) as? [AXUIElement] ?? [] {if let found=find(child,names,depth+1){return found}}
        return nil
    }
    guard headings.isEmpty || get(root,kAXMenuBarAttribute) != nil else {try fail("HEADING_FORMAT_FAILED")}
    for (range,names) in headings where !names.contains(headingStyle(e,range) ?? "") {
        try front(app);try select(e,range)
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
    guard AXIsProcessTrusted() else {try fail("ACCESSIBILITY_DENIED")}
    guard let app=NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.Notes").first else {try fail("EDITOR_UNAVAILABLE")}
    let root=AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(root,1)
    guard let w=(get(root,kAXWindowsAttribute) as? [AXUIElement])?.first,let e=editor(w) else {try fail("EDITOR_UNAVAILABLE")}
    func trim(_ s:String)->String{s.trimmingCharacters(in:.newlines)}
    guard trim(try value(e))==trim(expectedRaw) else {try fail("CONFLICT")}
    var current=try read(e)
    if command != "read" {
        app.activate();Thread.sleep(forTimeInterval:0.1);try front(app)
        if command == "append" || command == "replace" || command == "formatCreated" {
            guard let expected=input["expectedPlaintext"] as? String,expected==current.0 else {try fail("CONFLICT")}
            let fragment=command == "formatCreated" ? current.0 : try htmlText(input["html"] as? String ?? "")
            var desired=fragment
            if command == "replace" {
                guard desired.hasPrefix("PGTD OKR 最新稿\n"),desired.contains("PGTD-FINAL-") else {try fail("INVALID_INPUT")}
                let extras=input["preserveTags"] as? [String] ?? []
                let extra=extras.filter{tag in
                    let pattern=NSRegularExpression.escapedPattern(for:tag)+"(?![\\p{L}\\p{N}_-])"
                    return desired.range(of:pattern,options:.regularExpression)==nil
                }
                if !extra.isEmpty {desired += extra.joined(separator:" ")+"\n"}
            }
            let raw=try value(e) as NSString
            let resultingLength = (command == "append" ? current.0.utf16.count : 0)+desired.utf16.count
            guard resultingLength<=32768 else {try fail("CAPACITY_EXCEEDED")}
            try select(e,NSRange(location:command == "append" ? raw.length : 0,length:command == "append" ? 0 : raw.length))
            let target=command == "append" ? current.0+desired : desired
            try paste(desired,app)
            current=try read(e)
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
            let tokenPattern="(?<![\\p{L}\\p{N}_])"+NSRegularExpression.escapedPattern(for:tag)+"(?![\\p{L}\\p{N}_-])"
            let r=raw.range(of:tokenPattern,options:.regularExpression)
            guard r.location != NSNotFound else {try fail("TAG_READ_FAILED")}
            // Replace the existing delimiter with itself so no extra spaces accumulate.
            let after=r.location+r.length
            guard after<raw.length,raw.substring(with:NSRange(location:after,length:1)) == " " || raw.substring(with:NSRange(location:after,length:1)) == "\n" else {try fail("TAG_DELIMITER_REQUIRED")}
            let delimiter=raw.substring(with:NSRange(location:after,length:1))
            try select(e,NSRange(location:after,length:1))
            key(delimiter == " " ? 49 : 36);Thread.sleep(forTimeInterval:0.08)
            current=try read(e)
            guard current.1.contains(tag) else {try fail("TAG_WRITE_FAILED")}
        }
    }
    if command != "read" {try formatHeadings(e,root,app)}
    let complete=headingRanges(try value(e)).allSatisfy{range,names in names.contains(headingStyle(e,range) ?? "")}
    return ["ok":true,"value":["plaintext":current.0,"nativeTags":current.1,"headingsComplete":complete]]
}
do {let result=try run();let data=try JSONSerialization.data(withJSONObject:result,options:.sortedKeys);print(String(data:data,encoding:.utf8)!)}
catch {let code=(error as? Failure)?.code ?? "APPLE_RESULT_UNKNOWN";print("{\"ok\":false,\"code\":\"\(code)\"}")}
