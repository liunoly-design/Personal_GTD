import Foundation
import EventKit
import CryptoKit

struct BridgeError: Error { let code: String }
let store = EKEventStore()
let formatter = ISO8601DateFormatter()
func string(_ input: [String: Any], _ key: String) throws -> String {
    guard let value = input[key] as? String, !value.isEmpty else { throw BridgeError(code: "INVALID_INPUT") }
    return value
}
func listValue(_ list: EKCalendar) -> [String: Any] {
    return ["id": list.calendarIdentifier, "name": list.title, "sourceId": list.source.sourceIdentifier]
}
func itemValue(_ item: EKReminder) -> [String: Any] {
    let date = item.alarms?.first?.absoluteDate
    return ["id": item.calendarItemIdentifier, "listId": item.calendar.calendarIdentifier,
            "title": item.title ?? "", "notes": item.notes ?? "", "remindAt": date.map { formatter.string(from: $0) } as Any? ?? NSNull(),
            "marker": item.url?.absoluteString ?? ""]
}
func taskValue(_ item: EKReminder) throws -> [String: Any] {
    var baseline = itemValue(item)
    baseline["due"] = item.dueDateComponents?.description ?? ""
    baseline["priority"] = item.priority
    baseline["alarms"] = item.alarms?.map { $0.absoluteDate?.timeIntervalSince1970.description ?? $0.relativeOffset.description } ?? []
    baseline["start"] = item.startDateComponents?.description ?? ""
    baseline["location"] = item.location ?? ""
    baseline["timeZone"] = item.timeZone?.identifier ?? ""
    let fieldsData = try JSONSerialization.data(withJSONObject: baseline, options: [.sortedKeys])
    let fieldsRevision = SHA256.hash(data: fieldsData).map { String(format: "%02x", $0) }.joined()
    var content = baseline
    content.removeValue(forKey: "id"); content.removeValue(forKey: "listId")
    content["completed"] = item.isCompleted
    content["completionDate"] = item.completionDate?.timeIntervalSince1970 as Any? ?? NSNull()
    let contentData = try JSONSerialization.data(withJSONObject: content, options: [.sortedKeys])
    let contentRevision = SHA256.hash(data: contentData).map { String(format: "%02x", $0) }.joined()
    baseline["completed"] = item.isCompleted
    baseline["modifiedAt"] = item.lastModifiedDate?.timeIntervalSince1970 as Any? ?? NSNull()
    let data = try JSONSerialization.data(withJSONObject: baseline, options: [.sortedKeys])
    let revision = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    return ["id": item.calendarItemIdentifier, "listId": item.calendar.calendarIdentifier,
            "sourceId": item.calendar.source.sourceIdentifier,
            "title": String((item.title ?? "").prefix(200)) + ((item.title ?? "").count > 200 ? "…（标题省略）" : ""),
            "completed": item.isCompleted, "revision": revision, "fieldsRevision": fieldsRevision, "contentRevision": contentRevision,
            "moveSupported": (item.recurrenceRules?.isEmpty ?? true) && (item.alarms?.allSatisfy({ $0.structuredLocation == nil }) ?? true)]
}
func calendar(_ input: [String: Any]) throws -> EKCalendar {
    let id = try string(input, "listId")
    guard let list = store.calendar(withIdentifier: id), list.allowedEntityTypes.contains(.reminder), list.allowsContentModifications,
          list.source.sourceIdentifier == (try string(input, "sourceId")) else { throw BridgeError(code: "LIST_UNAVAILABLE") }
    return list
}
func reminders(_ list: EKCalendar) async throws -> [EKReminder] {
    return try await withCheckedThrowingContinuation { continuation in
        store.fetchReminders(matching: store.predicateForReminders(in: [list])) { values in
            guard let values else { continuation.resume(throwing: BridgeError(code: "READ_FAILED")); return }
            continuation.resume(returning: values)
        }
    }
}
func marker(_ op: String) throws -> String {
    guard op.count == 64, op.allSatisfy({ $0.isHexDigit }) else { throw BridgeError(code: "INVALID_OPERATION") }
    return "pgtd://capture/" + op
}
func execute(_ input: [String: Any]) async throws -> [String: Any] {
    let command = try string(input, "command")
    if command == "status" { return ["authorization": EKEventStore.authorizationStatus(for: .reminder).rawValue] }
    if command == "authorize" {
        let granted = try await store.requestFullAccessToReminders()
        return ["granted": granted]
    }
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { throw BridgeError(code: "PERMISSION_DENIED") }
    if command == "catalog" {
        let lists = store.calendars(for: .reminder).filter { $0.allowsContentModifications }
        return ["lists": lists.map(listValue), "defaultSourceId": store.defaultCalendarForNewReminders()?.source.sourceIdentifier as Any? ?? NSNull()]
    }
    let sourceId = try string(input, "sourceId")
    guard let source = store.source(withIdentifier: sourceId) else { throw BridgeError(code: "SOURCE_UNAVAILABLE") }
    if command == "lists" {
        return ["lists": store.calendars(for: .reminder).filter { $0.source.sourceIdentifier == sourceId && $0.title == "Inbox" }.map(listValue)]
    }
    if command == "createList" {
        let existing = store.calendars(for: .reminder).filter { $0.source.sourceIdentifier == sourceId && $0.title == "Inbox" }
        if existing.count == 1 { return listValue(existing[0]) }
        guard existing.isEmpty else { throw BridgeError(code: "AMBIGUOUS_LIST") }
        let list = EKCalendar(for: .reminder, eventStore: store)
        list.title = "Inbox"; list.source = source
        try store.saveCalendar(list, commit: true)
        return listValue(list)
    }
    if command == "resolveTaskTarget" {
        let sourceList = try calendar(input)
        if input["sourceOnly"] as? Bool == true {
            var value = listValue(sourceList); value["writable"] = true
            return ["state": "ok", "list": value]
        }
        let name = try string(input, "listName")
        guard name.count <= 200, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw BridgeError(code: "INVALID_INPUT") }
        let matches = store.calendars(for: .reminder).filter {
            $0.source.sourceIdentifier == sourceId && $0.title.compare(name, options: .caseInsensitive) == .orderedSame
        }
        if matches.isEmpty { return ["state": "list_not_found"] }
        if matches.count != 1 { return ["state": "ambiguous_list"] }
        guard matches[0].allowsContentModifications else { throw BridgeError(code: "LIST_UNAVAILABLE") }
        var value = listValue(matches[0]); value["writable"] = true
        return ["state": "ok", "list": value]
    }
    if command == "moveTask" {
        let list = try calendar(input)
        var targetInput = input; targetInput["listId"] = try string(input, "targetListId")
        let target = try calendar(targetInput)
        let id = try string(input, "itemId"), expected = try string(input, "expectedRevision"), content = try string(input, "contentRevision")
        _ = try marker(string(input, "operationId"))
        guard expected.count == 64, content.count == 64, expected.allSatisfy({ $0.isHexDigit }), content.allSatisfy({ $0.isHexDigit }),
              let item = store.calendarItem(withIdentifier: id) as? EKReminder,
              item.calendar.source.sourceIdentifier == sourceId else { throw BridgeError(code: "ITEM_UNAVAILABLE") }
        let current = try taskValue(item)
        guard current["contentRevision"] as? String == content else { throw BridgeError(code: "ITEM_CHANGED") }
        if item.calendar.calendarIdentifier == target.calendarIdentifier { return current }
        guard item.calendar.calendarIdentifier == list.calendarIdentifier, current["revision"] as? String == expected else { throw BridgeError(code: "ITEM_CHANGED") }
        // Unsupported structured/recurring fields are blocked rather than silently losing them.
        guard item.recurrenceRules?.isEmpty ?? true,
              item.alarms?.allSatisfy({ $0.structuredLocation == nil }) ?? true else { throw BridgeError(code: "UNSUPPORTED_FIELDS") }
        item.calendar = target
        try store.save(item, commit: true)
        guard item.calendarItemIdentifier == id else { throw BridgeError(code: "RESULT_UNKNOWN") }
        return try taskValue(item)
    }
    if command == "completeTask" {
        let list = try calendar(input)
        let id = try string(input, "itemId"), expected = try string(input, "expectedRevision"), fields = try string(input, "fieldsRevision")
        _ = try marker(string(input, "operationId"))
        guard expected.count == 64, fields.count == 64, expected.allSatisfy({ $0.isHexDigit }), fields.allSatisfy({ $0.isHexDigit }),
              let item = store.calendarItem(withIdentifier: id) as? EKReminder,
              item.calendar.source.sourceIdentifier == sourceId, item.calendar.calendarIdentifier == list.calendarIdentifier else { throw BridgeError(code: "ITEM_UNAVAILABLE") }
        let current = try taskValue(item)
        guard current["fieldsRevision"] as? String == fields else { throw BridgeError(code: "ITEM_CHANGED") }
        if item.isCompleted { return current }
        guard current["revision"] as? String == expected else { throw BridgeError(code: "ITEM_CHANGED") }
        item.isCompleted = true
        try store.save(item, commit: true)
        return try taskValue(item)
    }
    if command == "readTasks" {
        guard let refs = input["items"] as? [[String: Any]], (1...10).contains(refs.count) else { throw BridgeError(code: "INVALID_INPUT") }
        var seen = Set<String>()
        let items = try refs.map { ref -> [String: Any] in
            let id = try string(ref, "id"), listId = try string(ref, "listId")
            guard id.count <= 1024, listId.count <= 1024,
                  !id.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  !listId.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  seen.insert(id).inserted else { throw BridgeError(code: "INVALID_INPUT") }
            guard let item = store.calendarItem(withIdentifier: id) as? EKReminder,
                  item.calendar.source.sourceIdentifier == sourceId, item.calendar.calendarIdentifier == listId else {
                return ["id": id, "state": "unavailable"]
            }
            return ["id": id, "state": "ok", "value": try taskValue(item)]
        }
        return ["items": items]
    }
    if command == "queryTasks" {
        guard let limit = input["limit"] as? Int, (1...50).contains(limit),
              let offset = input["offset"] as? Int, (0...4950).contains(offset) else { throw BridgeError(code: "INVALID_INPUT") }
        var keyword: String? = nil
        if input["keyword"] != nil {
            let value = try string(input, "keyword")
            guard value.unicodeScalars.count <= 200, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw BridgeError(code: "INVALID_INPUT") }
            keyword = value.precomposedStringWithCanonicalMapping.lowercased()
        }
        let list: EKCalendar
        if input["listName"] != nil {
            let name = try string(input, "listName")
            guard name.count <= 200, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !name.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw BridgeError(code: "INVALID_INPUT") }
            let matches = store.calendars(for: .reminder).filter {
                $0.source.sourceIdentifier == sourceId && $0.title.compare(name, options: .caseInsensitive) == .orderedSame
            }
            if matches.isEmpty { return ["state": "list_not_found"] }
            if matches.count > 1 { return ["state": "ambiguous_list", "candidates": matches.map(listValue)] }
            list = matches[0]
        } else {
            let id = try string(input, "listId")
            guard let bound = store.calendar(withIdentifier: id), bound.allowedEntityTypes.contains(.reminder),
                  bound.source.sourceIdentifier == sourceId else { throw BridgeError(code: "LIST_UNAVAILABLE") }
            list = bound
        }
        // EventKit fetches a complete list; cap before returning a bounded page, never mutate objects.
        let all = try await reminders(list)
        guard all.count <= 10000 else { throw BridgeError(code: "QUERY_CAPACITY") }
        let unfinished = all.filter {
            item in
            guard !item.isCompleted else { return false }
            guard let keyword else { return true }
            // NSString literal search matches code-unit substrings, including inside a grapheme,
            // like JavaScript includes after the same NFC/default-lowercase transformation.
            let title = (item.title ?? "").precomposedStringWithCanonicalMapping.lowercased() as NSString
            return title.range(of: keyword, options: .literal).location != NSNotFound
        }.sorted { $0.calendarItemIdentifier < $1.calendarItemIdentifier }
        let items = try unfinished.dropFirst(offset).prefix(limit).map(taskValue)
        return ["state": "ok", "list": listValue(list), "items": items,
                "total": unfinished.count, "hasMore": offset + limit < unfinished.count]
    }
    let list = try calendar(input)
    if command == "boundList" { return listValue(list) }
    if command == "createItem" || command == "findCreate" {
        let expected = try marker(string(input, "operationId"))
        let found = try await reminders(list).filter { $0.url?.absoluteString.components(separatedBy: "?").first == expected }
        if found.count == 1 { return command == "findCreate" ? ["state": "applied", "value": itemValue(found[0])] : itemValue(found[0]) }
        guard found.isEmpty else { throw BridgeError(code: "AMBIGUOUS_OPERATION") }
        if command == "findCreate" { return ["state": "unknown"] }
        let item = EKReminder(eventStore: store)
        item.calendar = list; item.title = try string(input, "title"); item.notes = try string(input, "notes")
        item.url = URL(string: expected)
        try store.save(item, commit: true)
        return itemValue(item)
    }
    let id = try string(input, "itemId")
    guard let item = store.calendarItem(withIdentifier: id) as? EKReminder,
          item.calendar.source.sourceIdentifier == sourceId,
          item.url?.scheme == "pgtd", item.url?.host == "capture" else { throw BridgeError(code: "ITEM_UNAVAILABLE") }
    if command == "getItem" { return itemValue(item) }
    guard item.calendar.calendarIdentifier == list.calendarIdentifier else { throw BridgeError(code: "ITEM_UNAVAILABLE") }
    let op = try string(input, "operationId")
    _ = try marker(op)
    guard let date = formatter.date(from: try string(input, "remindAt")),
          let zone = TimeZone(identifier: try string(input, "timeZone")) else { throw BridgeError(code: "INVALID_TIME") }
    var url = URLComponents(url: item.url!, resolvingAgainstBaseURL: false)!
    if command == "findReminder" {
        let matches = url.queryItems?.contains(where: { $0.name == "reminder" && $0.value == op }) == true
            && item.alarms?.first?.absoluteDate == date
        return matches ? ["state": "applied", "value": itemValue(item)] : ["state": "unknown"]
    }
    guard command == "setReminder" else { throw BridgeError(code: "INVALID_COMMAND") }
    guard date > Date() else { throw BridgeError(code: "PAST_TIME") }
    var cal = Calendar(identifier: .gregorian); cal.timeZone = zone
    var components = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    components.timeZone = zone
    item.dueDateComponents = components
    item.alarms = [EKAlarm(absoluteDate: date)]
    url.queryItems = [URLQueryItem(name: "reminder", value: op)]; item.url = url.url
    try store.save(item, commit: true)
    return itemValue(item)
}

Task {
    do {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        guard data.count <= 100_000, let input = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw BridgeError(code: "INVALID_INPUT") }
        let value = try await execute(input)
        let output = try JSONSerialization.data(withJSONObject: ["ok": true, "value": value], options: [.sortedKeys])
        FileHandle.standardOutput.write(output); exit(0)
    } catch {
        let code = (error as? BridgeError)?.code ?? "APPLE_FAILURE"
        let output = try! JSONSerialization.data(withJSONObject: ["ok": false, "code": code])
        FileHandle.standardOutput.write(output); exit(1)
    }
}
RunLoop.main.run()
