import AppKit
import XCTest

final class SafariHostSmokeTests: XCTestCase {
    func testConvertedHostAppLaunchesAndContainsExtension() throws {
        let environment = ProcessInfo.processInfo.environment
        let appPath = try XCTUnwrap(environment["MBD_SAFARI_APP"])
        let appURL = URL(fileURLWithPath: appPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: appURL.path))

        let plugIns = appURL.appendingPathComponent("Contents/PlugIns")
        let extensions = try FileManager.default.contentsOfDirectory(
            at: plugIns,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension == "appex" }
        XCTAssertFalse(extensions.isEmpty, "Converted host must embed the Safari Web Extension")

        let launched = expectation(description: "host application launch")
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.openApplication(at: appURL, configuration: configuration) { app, error in
            XCTAssertNil(error)
            XCTAssertNotNil(app)
            app?.terminate()
            launched.fulfill()
        }
        wait(for: [launched], timeout: 20)
    }
}
