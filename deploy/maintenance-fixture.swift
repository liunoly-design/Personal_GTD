import Foundation
import EventKit
let store = EKEventStore()
func fetch(_ list: EKCalendar) async throws -> [EKReminder] {
    try await withCheckedThrowingContinuation { continuation in
        store.fetchReminders(matching: store.predicateForReminders(in: [list])) { items in
            if let items { continuation.resume(returning: items) }
            else { continuation.resume(throwing: NSError(domain: "Fixture", code: 1)) }
        }
    }
}
func run(_ input: [String: Any]) async throws -> [String: Any] {
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess,
          input["allowSyntheticWrites"] as? Bool == true,
          let sourceId = input["sourceId"] as? String, let source = store.source(withIdentifier: sourceId),
          let token = input["runId"] as? String, UUID(uuidString: token) != nil else { throw NSError(domain: "FixtureScope", code: 1) }
    let prefix = "PGTD验收-" + token
    let marker = "pgtd://maintenance-acceptance/" + token + "/"
    if input["command"] as? String == "prepare" {
        guard !store.calendars(for: .reminder).contains(where: { $0.title.hasPrefix(prefix) }) else { throw NSError(domain: "FixtureExists", code: 1) }
        var lists = [EKCalendar]()
        for suffix in ["Waiting", "Next"] {
            let list = EKCalendar(for: .reminder, eventStore: store); list.title = prefix + "-" + suffix; list.source = source
            try store.saveCalendar(list, commit: true); lists.append(list)
        }
        for i in 1...5 {
            let item = EKReminder(eventStore: store); item.calendar = lists[0]; item.title = "PGTD合成验收\(i)"
            item.notes = "合成字段保留验收"; item.url = URL(string: marker + String(i)); item.priority = 5
            item.dueDateComponents = DateComponents(calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(identifier: "Asia/Shanghai"), year: 2030, month: 10, day: 3, hour: 10)
            item.addAlarm(EKAlarm(absoluteDate: Date(timeIntervalSince1970: 1917223200)))
            try store.save(item, commit: true)
        }
        return ["sourceListId": lists[0].calendarIdentifier, "sourceName": lists[0].title,
                "targetListId": lists[1].calendarIdentifier, "targetName": lists[1].title]
    }
    guard input["command"] as? String == "cleanup",
          let listIds = input["listIds"] as? [String], listIds.count == 2, Set(listIds).count == 2 else { throw NSError(domain: "FixtureCommand", code: 1) }
    var owned = [(EKCalendar, [EKReminder])]()
    for id in listIds {
        guard let list = store.calendar(withIdentifier: id), list.source.sourceIdentifier == sourceId,
              [prefix + "-Waiting", prefix + "-Next"].contains(list.title) else { throw NSError(domain: "FixtureIdentity", code: 1) }
        let items = try await fetch(list)
        guard items.allSatisfy({ $0.url?.absoluteString.hasPrefix(marker) == true }) else { throw NSError(domain: "FixtureChanged", code: 1) }
        owned.append((list, items))
    }
    for (list, items) in owned {
        for item in items { try store.remove(item, commit: true) }
        try store.removeCalendar(list, commit: true)
    }
    return ["cleaned": true]
}
Task {
    do {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let input = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let value = try await run(input)
        let output = try JSONSerialization.data(withJSONObject: ["ok": true, "value": value])
        FileHandle.standardOutput.write(output)
    } catch {
        FileHandle.standardOutput.write(Data("{\"ok\":false,\"code\":\"FIXTURE_FAILED\"}".utf8))
    }
    exit(0)
}
dispatchMain()
