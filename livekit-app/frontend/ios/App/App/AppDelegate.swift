import UIKit
import Capacitor
import WebKit
import PushKit
import CallKit
import UserNotifications
import AVFoundation
import AudioToolbox

final class LaliaBridgeViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let contentController = config.userContentController
        contentController.removeScriptMessageHandler(forName: "laliaIOS")
        contentController.add(LaliaCallManager.shared, name: "laliaIOS")

        let bridgeJs = """
        (function() {
          if (window.LaliaIOS) return;
          function post(payload) {
            try {
              if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.laliaIOS) {
                window.webkit.messageHandlers.laliaIOS.postMessage(payload);
              }
            } catch (e) {}
          }
          window.LaliaIOS = {
            setAuthToken: function(token) {
              post({ action: 'setAuthToken', token: String(token || '') });
            },
            ringIncomingCall: function(callerName, joinUrl, callId) {
              post({
                action: 'ringIncomingCall',
                callerName: String(callerName || 'Someone'),
                joinUrl: String(joinUrl || ''),
                callId: String(callId || '')
              });
            },
            stopIncomingCallRing: function(callId) {
              post({ action: 'stopRing', callId: String(callId || '') });
            },
            requestNotificationPermission: function() {
              post({ action: 'requestNotificationPermission' });
            }
          };
        })();
        """
        let userScript = WKUserScript(
            source: bridgeJs,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        contentController.addUserScript(userScript)
        return config
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        LaliaCallManager.shared.attachWebView(self.webView)
    }
}

final class LaliaCallManager: NSObject, WKScriptMessageHandler, PKPushRegistryDelegate, CXProviderDelegate, UNUserNotificationCenterDelegate {
    static let shared = LaliaCallManager()

    private let prefsAuthTokenKey = "lalia_v2_auth_token"
    private let prefsVoipTokenKey = "lalia_ios_voip_token"
    private let prefsApnsTokenKey = "lalia_ios_apns_token"
    private let apiBaseUrl = "https://lalia.cloud/api/v2"

    private weak var webView: WKWebView?
    private var voipRegistry: PKPushRegistry?
    private var callProvider: CXProvider?
    private let callController = CXCallController()

    private var pollTimer: Timer?
    private var ringTimer: Timer?
    private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid

    private var currentlyRingingCallId: String?
    private var dismissedCallIds = Set<String>()
    private var callUuidByCallId = [String: UUID]()
    private var callInfoByUuid = [UUID: [String: String]]()
    private var answeredCallIds = Set<String>()

    private override init() {
        super.init()
    }

    func start() {
        setupCallKit()
        setupNotifications()
        setupVoipPushKit()
        startCallPolling()
    }

    func attachWebView(_ wv: WKWebView?) {
        self.webView = wv
        syncTokensToWebView()
    }

    // MARK: - Setup

    private func setupCallKit() {
        let config = CXProviderConfiguration(localizedName: "Lalia")
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic, .emailAddress]
        config.includesCallsInRecents = true

        let provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: .main)
        self.callProvider = provider
    }

    private func setupNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        let answerAction = UNNotificationAction(
            identifier: "ANSWER_CALL",
            title: "Answer Call",
            options: [.foreground]
        )
        let declineAction = UNNotificationAction(
            identifier: "DECLINE_CALL",
            title: "Decline",
            options: [.destructive]
        )
        let category = UNNotificationCategory(
            identifier: "INCOMING_CALL",
            actions: [answerAction, declineAction],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        center.setNotificationCategories([category])
        requestNotificationPermission()
    }

    private func setupVoipPushKit() {
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.voipRegistry = registry
    }

    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    // MARK: - Token Management

    private var currentEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        if Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" {
            return "sandbox"
        }
        return "production"
        #endif
    }

    func didRegisterApnsDeviceToken(_ deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: prefsApnsTokenKey)
        syncTokensToWebView()
        uploadIosTokensToBackend()
    }

    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(hex, forKey: prefsVoipTokenKey)
        syncTokensToWebView()
        uploadIosTokensToBackend()
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        UserDefaults.standard.removeObject(forKey: prefsVoipTokenKey)
    }

    private func syncTokensToWebView() {
        let voip = UserDefaults.standard.string(forKey: prefsVoipTokenKey) ?? ""
        let apns = UserDefaults.standard.string(forKey: prefsApnsTokenKey) ?? ""
        guard !voip.isEmpty || !apns.isEmpty else { return }
        let bundleId = Bundle.main.bundleIdentifier ?? "cloud.lalia.app"
        let env = currentEnvironment

        let js = """
        window.__laliaIosTokens = {
          voipToken: "\(voip)",
          apnsToken: "\(apns)",
          bundleId: "\(bundleId)",
          environment: "\(env)"
        };
        window.dispatchEvent(new CustomEvent('lalia:ios-push-tokens', { detail: window.__laliaIosTokens }));
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func uploadIosTokensToBackend() {
        guard let authToken = UserDefaults.standard.string(forKey: prefsAuthTokenKey),
              !authToken.isEmpty else { return }

        let voip = UserDefaults.standard.string(forKey: prefsVoipTokenKey) ?? ""
        let apns = UserDefaults.standard.string(forKey: prefsApnsTokenKey) ?? ""
        guard !voip.isEmpty || !apns.isEmpty else { return }

        guard let url = URL(string: "\(apiBaseUrl)/push/ios-token") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "bundleId": Bundle.main.bundleIdentifier ?? "cloud.lalia.app",
            "environment": currentEnvironment
        ]
        if !voip.isEmpty { body["voipToken"] = voip }
        if !apns.isEmpty { body["apnsToken"] = apns }

        req.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
        URLSession.shared.dataTask(with: req).resume()
    }

    // MARK: - PushKit Incoming VoIP Push

    func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }

        let dict = payload.dictionaryPayload
        let callId = (dict["callId"] as? String) ?? UUID().uuidString
        let callerName = (dict["callerName"] as? String) ?? "Someone"
        let joinUrl = (dict["joinUrl"] as? String) ?? "https://lalia.cloud/v2/app"
        let roomName = (dict["roomName"] as? String) ?? ""

        reportIncomingCallToCallKit(
            callId: callId,
            callerName: callerName,
            joinUrl: joinUrl,
            roomName: roomName,
            completion: completion
        )
    }

    // MARK: - CallKit Reporting & Actions

    private func reportIncomingCallToCallKit(
        callId: String,
        callerName: String,
        joinUrl: String,
        roomName: String,
        completion: (() -> Void)? = nil
    ) {
        if let existingUuid = callUuidByCallId[callId] {
            callInfoByUuid[existingUuid] = [
                "callId": callId,
                "callerName": callerName,
                "joinUrl": joinUrl,
                "roomName": roomName
            ]
            completion?()
            return
        }

        let uuid = UUID()
        callUuidByCallId[callId] = uuid
        callInfoByUuid[uuid] = [
            "callId": callId,
            "callerName": callerName,
            "joinUrl": joinUrl,
            "roomName": roomName
        ]
        currentlyRingingCallId = callId

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = "\(callerName) (Lalia)"
        update.hasVideo = true
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false

        callProvider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            if error != nil {
                // Fallback to local notification + system alert sound if CallKit is blocked
                self?.postLocalIncomingCallNotification(
                    callId: callId,
                    callerName: callerName,
                    joinUrl: joinUrl,
                    roomName: roomName
                )
                self?.startSystemRingTimer(callId: callId)
            }
            completion?()
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        stopSystemRingTimer()
        currentlyRingingCallId = nil
        callUuidByCallId.removeAll()
        callInfoByUuid.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        stopSystemRingTimer()
        if let info = callInfoByUuid[action.callUUID] {
            let callId = info["callId"] ?? ""
            let joinUrl = info["joinUrl"] ?? "https://lalia.cloud/v2/app"
            let roomName = info["roomName"] ?? ""
            if !callId.isEmpty {
                answeredCallIds.insert(callId)
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "accept")
            }
            navigateWebViewToCall(joinUrl: joinUrl, roomName: roomName, callId: callId)
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        stopSystemRingTimer()
        if let info = callInfoByUuid[action.callUUID] {
            let callId = info["callId"] ?? ""
            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                if !answeredCallIds.contains(callId) {
                    respondToCallOnBackend(callId: callId, action: "decline")
                    dispatchDismissedToWebView(callId: callId)
                }
            }
        }
        currentlyRingingCallId = nil
        action.fulfill()
    }

    private func endCallKitCallIfActive(callId: String) {
        guard !callId.isEmpty, let uuid = callUuidByCallId[callId] else { return }
        let endAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endAction)
        callController.request(transaction) { _ in }
        callUuidByCallId.removeValue(forKey: callId)
        callInfoByUuid.removeValue(forKey: uuid)
    }

    // MARK: - Local Notifications & System Sound Ringing

    private func postLocalIncomingCallNotification(
        callId: String,
        callerName: String,
        joinUrl: String,
        roomName: String
    ) {
        let content = UNMutableNotificationContent()
        content.title = "\(callerName) is calling you on Lalia"
        content.body = "Tap to answer with live translation & captions"
        content.sound = .default
        content.categoryIdentifier = "INCOMING_CALL"
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }
        content.userInfo = [
            "callId": callId,
            "callerName": callerName,
            "joinUrl": joinUrl,
            "roomName": roomName
        ]

        let request = UNNotificationRequest(
            identifier: "lalia-call-\(callId)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    private func playSystemRingBurst() {
        AudioServicesPlayAlertSound(1005)
        AudioServicesPlayAlertSound(SystemSoundID(kSystemSoundID_Vibrate))
    }

    private func startSystemRingTimer(callId: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.currentlyRingingCallId = callId
            self.ringTimer?.invalidate()
            self.playSystemRingBurst()
            self.ringTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
                self?.playSystemRingBurst()
            }
        }
    }

    private func stopSystemRingTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.ringTimer?.invalidate()
            self?.ringTimer = nil
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let callId = (userInfo["callId"] as? String) ?? ""
        let joinUrl = (userInfo["joinUrl"] as? String) ?? "https://lalia.cloud/v2/app"
        let roomName = (userInfo["roomName"] as? String) ?? ""

        stopSystemRingTimer()
        if response.actionIdentifier == "DECLINE_CALL" {
            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "decline")
                endCallKitCallIfActive(callId: callId)
                dispatchDismissedToWebView(callId: callId)
            }
        } else {
            if !callId.isEmpty {
                answeredCallIds.insert(callId)
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "accept")
                endCallKitCallIfActive(callId: callId)
            }
            navigateWebViewToCall(joinUrl: joinUrl, roomName: roomName, callId: callId)
        }
        completionHandler()
    }

    // MARK: - Background & Foreground Call Polling

    func applicationDidEnterBackground() {
        guard backgroundTaskId == .invalid else { return }
        backgroundTaskId = UIApplication.shared.beginBackgroundTask(withName: "LaliaCallWatcher") { [weak self] in
            guard let self = self else { return }
            UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
            self.backgroundTaskId = .invalid
        }
        pollIncomingCallsNow()
    }

    func applicationDidBecomeActive() {
        if backgroundTaskId != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTaskId)
            backgroundTaskId = .invalid
        }
        pollIncomingCallsNow()
    }

    private func startCallPolling() {
        DispatchQueue.main.async { [weak self] in
            self?.pollTimer?.invalidate()
            self?.pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
                self?.pollIncomingCallsNow()
            }
        }
    }

    private func pollIncomingCallsNow() {
        guard let authToken = UserDefaults.standard.string(forKey: prefsAuthTokenKey),
              !authToken.isEmpty,
              let url = URL(string: "\(apiBaseUrl)/calls/incoming") else {
            return
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 4.0
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            guard let self = self,
                  error == nil,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let calls = json["incomingCalls"] as? [[String: Any]] else {
                return
            }

            let active = calls.first { item in
                guard let id = item["id"] as? String, !id.isEmpty else { return false }
                return !self.dismissedCallIds.contains(id)
            }

            DispatchQueue.main.async {
                if let call = active,
                   let callId = call["id"] as? String,
                   !callId.isEmpty {
                    let callerName = (call["callerName"] as? String) ?? "Someone"
                    let joinUrl = (call["joinUrl"] as? String) ?? "https://lalia.cloud/v2/app"
                    let roomName = (call["roomName"] as? String) ?? ""

                    if self.currentlyRingingCallId != callId {
                        self.currentlyRingingCallId = callId
                        if UIApplication.shared.applicationState != .active {
                            self.postLocalIncomingCallNotification(
                                callId: callId,
                                callerName: callerName,
                                joinUrl: joinUrl,
                                roomName: roomName
                            )
                            self.reportIncomingCallToCallKit(
                                callId: callId,
                                callerName: callerName,
                                joinUrl: joinUrl,
                                roomName: roomName
                            )
                        } else {
                            self.startSystemRingTimer(callId: callId)
                        }
                    }
                } else if let ringingId = self.currentlyRingingCallId {
                    self.currentlyRingingCallId = nil
                    self.stopSystemRingTimer()
                    self.endCallKitCallIfActive(callId: ringingId)
                    UNUserNotificationCenter.current().removeDeliveredNotifications(
                        withIdentifiers: ["lalia-call-\(ringingId)"]
                    )
                }
            }
        }.resume()
    }

    // MARK: - Backend & WebView Helpers

    private func respondToCallOnBackend(callId: String, action: String) {
        guard let authToken = UserDefaults.standard.string(forKey: prefsAuthTokenKey),
              !authToken.isEmpty,
              let url = URL(string: "\(apiBaseUrl)/calls/\(callId)/respond") else {
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action], options: [])
        URLSession.shared.dataTask(with: req).resume()
    }

    private func navigateWebViewToCall(joinUrl: String, roomName: String, callId: String) {
        let escapedUrl = joinUrl.replacingOccurrences(of: "\"", with: "\\\"")
        let escapedRoom = roomName.replacingOccurrences(of: "\"", with: "\\\"")
        let escapedCallId = callId.replacingOccurrences(of: "\"", with: "\\\"")
        let js = """
        window.dispatchEvent(new CustomEvent('lalia:ios-call-navigate', {
          detail: { joinUrl: "\(escapedUrl)", roomName: "\(escapedRoom)", callId: "\(escapedCallId)" }
        }));
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func dispatchDismissedToWebView(callId: String) {
        let escapedCallId = callId.replacingOccurrences(of: "\"", with: "\\\"")
        let js = """
        window.dispatchEvent(new CustomEvent('lalia:ios-call-dismissed', {
          detail: { callId: "\(escapedCallId)" }
        }));
        """
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "laliaIOS",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }

        switch action {
        case "setAuthToken":
            let token = (body["token"] as? String) ?? ""
            let previous = UserDefaults.standard.string(forKey: prefsAuthTokenKey) ?? ""
            UserDefaults.standard.set(token, forKey: prefsAuthTokenKey)
            if !token.isEmpty && token != previous {
                uploadIosTokensToBackend()
                pollIncomingCallsNow()
            }
        case "ringIncomingCall":
            let callId = (body["callId"] as? String) ?? UUID().uuidString
            let callerName = (body["callerName"] as? String) ?? "Someone"
            let joinUrl = (body["joinUrl"] as? String) ?? "https://lalia.cloud/v2/app"
            let roomName = (body["roomName"] as? String) ?? ""
            if currentlyRingingCallId != callId {
                startSystemRingTimer(callId: callId)
                if UIApplication.shared.applicationState != .active {
                    postLocalIncomingCallNotification(
                        callId: callId,
                        callerName: callerName,
                        joinUrl: joinUrl,
                        roomName: roomName
                    )
                }
            }
        case "stopRing":
            let callId = (body["callId"] as? String) ?? (currentlyRingingCallId ?? "")
            stopSystemRingTimer()
            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                answeredCallIds.insert(callId)
                endCallKitCallIfActive(callId: callId)
                UNUserNotificationCenter.current().removeDeliveredNotifications(
                    withIdentifiers: ["lalia-call-\(callId)"]
                )
            }
            currentlyRingingCallId = nil
        case "requestNotificationPermission":
            if let token = body["token"] as? String, !token.isEmpty {
                UserDefaults.standard.set(token, forKey: prefsAuthTokenKey)
            }
            requestNotificationPermission()
            uploadIosTokensToBackend()
        default:
            break
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        LaliaCallManager.shared.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        LaliaCallManager.shared.didRegisterApnsDeviceToken(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Ignore on Personal Team provisioning profiles without APNs entitlement
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        LaliaCallManager.shared.applicationDidEnterBackground()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        LaliaCallManager.shared.applicationDidBecomeActive()
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
