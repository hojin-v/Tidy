import AppKit
import ApplicationServices

// Keep AX references alive so choosing a picker cell never retargets another window.
var windows: [String: AXUIElement] = [:]
var windowOrder: [String] = []
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)

enum NativeError: Error { case message(String) }
func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func rectOf(_ window: AXUIElement) -> [String: Double]? {
    guard let p = attribute(window, kAXPositionAttribute), let s = attribute(window, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(unsafeBitCast(p, to: AXValue.self), .cgPoint, &point),
          AXValueGetValue(unsafeBitCast(s, to: AXValue.self), .cgSize, &size) else { return nil }
    // AX uses a top-left origin in points, matching Electron on macOS.
    return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}
func snapshot(_ ignorePid: Int32) -> [String: Any] {
    var result: [String: Any] = ["window": NSNull(), "mouseDown": CGEventSource.buttonState(.combinedSessionState, button: .left),
                                "trusted": AXIsProcessTrusted()]
    guard AXIsProcessTrusted(), let front = NSWorkspace.shared.frontmostApplication,
          front.processIdentifier != ignorePid else { return result }
    let app = AXUIElementCreateApplication(front.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.25)
    guard let value = attribute(app, kAXFocusedWindowAttribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return result }
    let window = unsafeBitCast(value, to: AXUIElement.self)
    guard let rect = rectOf(window) else { return result }
    let id = "\(front.processIdentifier):\(CFHash(window))"
    if windows[id] == nil { windowOrder.append(id) }
    windows[id] = window
    if windowOrder.count > 256 { windows.removeValue(forKey: windowOrder.removeFirst()) }
    var movable = DarwinBoolean(false), sizable = DarwinBoolean(false)
    AXUIElementIsAttributeSettable(window, kAXPositionAttribute as CFString, &movable)
    AXUIElementIsAttributeSettable(window, kAXSizeAttribute as CFString, &sizable)
    result["window"] = ["id": id, "pid": front.processIdentifier, "rect": rect,
        "resizable": movable.boolValue && sizable.boolValue,
        "fullscreen": (attribute(window, "AXFullScreen") as? Bool) ?? false]
    return result
}
func place(_ request: [String: Any]) throws -> [String: Double] {
    guard AXIsProcessTrusted() else {
        throw NativeError.message("Allow Tidy in System Settings > Privacy & Security > Accessibility, then restart Tidy.")
    }
    guard let target = request["window"] as? [String: Any], let id = target["id"] as? String,
          let expectedPid = target["pid"] as? Int32, let window = windows[id],
          let rect = request["rect"] as? [String: Double], let x = rect["x"], let y = rect["y"],
          let width = rect["width"], let height = rect["height"], width > 0, height > 0 else {
        throw NativeError.message("The selected window has closed or its size is invalid.")
    }
    var pid: pid_t = 0
    guard AXUIElementGetPid(window, &pid) == .success, pid == expectedPid else {
        throw NativeError.message("The selected window has closed.")
    }
    guard (attribute(window, "AXFullScreen") as? Bool) != true else {
        throw NativeError.message("Leave fullscreen before arranging this window.")
    }
    var point = CGPoint(x: x, y: y), size = CGSize(width: width, height: height)
    let position = AXValueCreate(.cgPoint, &point)!
    let dimensions = AXValueCreate(.cgSize, &size)!
    // Some apps constrain position using the old size; repeat position after resize.
    AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position)
    let resize = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, dimensions)
    let move = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, position)
    guard resize == .success, move == .success else {
        throw NativeError.message("This app refused to move or resize (AX error \(move.rawValue)/\(resize.rawValue)).")
    }
    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    NSRunningApplication(processIdentifier: pid)?.activate(options: [])
    guard let actual = rectOf(window) else { throw NativeError.message("Could not read the resized window.") }
    return actual
}
func respond(_ line: String) -> [String: Any] {
    var id: Any = NSNull()
    do {
        guard let data = line.data(using: .utf8),
              let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativeError.message("Invalid request.")
        }
        id = request["id"] ?? NSNull()
        let result: Any
        switch request["op"] as? String {
        case "snapshot": result = snapshot((request["ignorePid"] as? Int32) ?? 0)
        case "place": result = try place(request)
        case "permissions":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: request["prompt"] as? Bool ?? false]
            result = ["trusted": AXIsProcessTrustedWithOptions(options as CFDictionary)]
        default: throw NativeError.message("Unknown native operation.")
        }
        return ["id": id, "result": result]
    } catch NativeError.message(let message) { return ["id": id, "error": message] }
    catch { return ["id": id, "error": error.localizedDescription] }
}
while let line = readLine() {
    autoreleasepool {
        let response = respond(line)
        if let data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print(text)
            fflush(stdout)
        }
    }
}
