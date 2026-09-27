#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p runtime/bin
chmod 700 runtime runtime/bin
xcrun swiftc native/reminders.swift -o runtime/bin/pgtd-reminders -framework EventKit -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/Info.plist
codesign --force --sign - --identifier local.personal-gtd.reminders runtime/bin/pgtd-reminders
