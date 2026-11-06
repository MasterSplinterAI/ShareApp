import UIKit
import Capacitor
import WebKit
import PushKit
import CallKit
import UserNotifications
import AVFoundation
import AudioToolbox
import MediaPlayer

final class LaliaBridgeViewController: CAPBridgeViewController {
    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        return config
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        LaliaCallManager.shared.installIntoUserContentController(configuration.userContentController)
        let wv = super.webView(with: frame, configuration: configuration)
        LaliaCallManager.shared.attachWebView(wv)
        return wv
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        if let uc = self.webView?.configuration.userContentController {
            LaliaCallManager.shared.installIntoUserContentController(uc)
        }
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
    private var inLiveRoom: Bool = false
    private var pollCount: Int = 0

    private var currentlyRingingCallId: String?
    private var dismissedCallIds = Set<String>()
    private var callUuidByCallId = [String: UUID]()
    private var callInfoByUuid = [UUID: [String: String]]()
    private var answeredCallIds = Set<String>()
    private var pendingAnsweredJoinUrl: String?
    private var pendingAnsweredRoomName: String?
    private var pendingAnsweredCallId: String?

    private override init() {
        super.init()
    }

    func start() {
        clearNowPlayingInfo()
        setupCallKit()
        setupNotifications()
        setupVoipPushKit()
        setupLifecycleObservers()
        startCallPolling()
        sendDebugBeacon(event: "native_start", detail: [:])
    }

    private func clearNowPlayingInfo() {
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            UIApplication.shared.endReceivingRemoteControlEvents()
        }
    }

    func installIntoUserContentController(_ contentController: WKUserContentController) {
        contentController.removeScriptMessageHandler(forName: "laliaIOS")
        contentController.add(self, name: "laliaIOS")

        let bridgeJs = """
        (function() {
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
    }

    func attachWebView(_ wv: WKWebView?) {
        guard let wv = wv else { return }
        self.webView = wv
        syncTokensToWebView()
        pullAuthTokenFromWebView()
        sendDebugBeacon(event: "webview_attached", detail: [:])
    }

    // MARK: - Telemetry Beacon

    private func sendDebugBeacon(event: String, detail: [String: Any]) {
        guard let url = URL(string: "\(apiBaseUrl)/push/ios-debug") else { return }
        let build = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        let hasToken = !(UserDefaults.standard.string(forKey: prefsAuthTokenKey) ?? "").isEmpty
        let stateStr: String = {
            switch UIApplication.shared.applicationState {
            case .active: return "active"
            case .inactive: return "inactive"
            case .background: return "background"
            @unknown default: return "unknown"
            }
        }()

        var payload: [String: Any] = [
            "source": "ios_swift",
            "event": event,
            "build": build,
            "appState": stateStr,
            "hasAuthToken": hasToken,
            "inLiveRoom": inLiveRoom
        ]
        for (k, v) in detail {
            payload[k] = v
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 4.0
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload, options: [])
        URLSession.shared.dataTask(with: req).resume()
    }

    // MARK: - Setup

    private func setupLifecycleObservers() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationDidEnterBackground()
        }
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.applicationDidBecomeActive()
        }
    }

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
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, err in
            self?.sendDebugBeacon(
                event: "notif_permission_result",
                detail: ["granted": granted, "error": err?.localizedDescription ?? ""]
            )
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

    private func updateAuthToken(_ token: String) {
        let clean = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let previous = UserDefaults.standard.string(forKey: prefsAuthTokenKey) ?? ""
        UserDefaults.standard.set(clean, forKey: prefsAuthTokenKey)
        if !clean.isEmpty && clean != previous {
            sendDebugBeacon(event: "auth_token_synced", detail: ["tokenLen": clean.count])
            uploadIosTokensToBackend()
            pollIncomingCallsNow()
        }
    }

    private func pullAuthTokenFromWebView() {
        guard UIApplication.shared.applicationState == .active, let wv = self.webView else { return }
        let js = """
        (function() {
          try {
            return JSON.stringify({
              token: localStorage.getItem('v2_token') || '',
              path: window.location ? window.location.pathname : ''
            });
          } catch (e) {
            return '';
          }
        })()
        """
        wv.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self,
                  let str = result as? String,
                  !str.isEmpty,
                  let data = str.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return
            }
            if let token = obj["token"] as? String, !token.isEmpty {
                self.updateAuthToken(token)
            }
            if let path = obj["path"] as? String {
                let nowInRoom = path.hasPrefix("/room/")
                if nowInRoom != self.inLiveRoom {
                    let wasInRoom = self.inLiveRoom
                    self.inLiveRoom = nowInRoom
                    if nowInRoom {
                        self.pendingAnsweredJoinUrl = nil
                        self.pendingAnsweredRoomName = nil
                        self.pendingAnsweredCallId = nil
                    } else if wasInRoom {
                        // User left the LiveKit room in the app -> end any active CallKit call cleanly
                        self.endAllActiveCallKitCalls()
                    }
                }
            }
        }
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

    // MARK: - PushKit Incoming VoIP Push (Pure Signal / WhatsApp Flow)

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

        sendDebugBeacon(
            event: "voip_push_received",
            detail: ["callId": callId, "callerName": callerName]
        )

        reportIncomingCallToCallKit(
            callId: callId,
            callerName: callerName,
            joinUrl: joinUrl,
            roomName: roomName,
            completion: completion
        )
    }

    // MARK: - Signal / WhatsApp Style CallKit Reporting & Actions

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
            self?.sendDebugBeacon(
                event: "callkit_reported",
                detail: ["callId": callId, "error": error?.localizedDescription ?? ""]
            )
            completion?()
        }
    }

    func providerDidReset(_ provider: CXProvider) {
        currentlyRingingCallId = nil
        callUuidByCallId.removeAll()
        callInfoByUuid.removeAll()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        clearNowPlayingInfo()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        currentlyRingingCallId = nil

        if let info = callInfoByUuid[action.callUUID] {
            let callId = info["callId"] ?? ""
            let callerName = info["callerName"] ?? "Someone"
            let joinUrl = info["joinUrl"] ?? "https://lalia.cloud/v2/app"
            let roomName = info["roomName"] ?? ""
            if !callId.isEmpty {
                answeredCallIds.insert(callId)
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "accept")
                UNUserNotificationCenter.current().removeDeliveredNotifications(
                    withIdentifiers: ["lalia-call-\(callId)"]
                )
            }
            sendDebugBeacon(event: "callkit_answered", detail: ["callId": callId, "joinUrl": joinUrl])
            pendingAnsweredJoinUrl = joinUrl
            pendingAnsweredRoomName = roomName
            pendingAnsweredCallId = callId

            navigateWebViewToCall(joinUrl: joinUrl, roomName: roomName, callId: callId)

            // Release CallKit's lock on the iOS microphone/camera after answering so WKWebView's
            // PreJoinScreen and LiveKit WebRTC engine have 100% exclusive access to camera & mic
            let uuid = action.callUUID
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
                guard let self = self else { return }
                self.callUuidByCallId.removeValue(forKey: callId)
                self.callInfoByUuid.removeValue(forKey: uuid)
                let endAction = CXEndCallAction(call: uuid)
                self.callController.request(CXTransaction(action: endAction)) { _ in
                    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
                }
                if UIApplication.shared.applicationState != .active {
                    self.postAnsweredCallOpenBanner(
                        callId: callId,
                        callerName: callerName,
                        joinUrl: joinUrl,
                        roomName: roomName
                    )
                }
            }
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        if let info = callInfoByUuid[action.callUUID] {
            let callId = info["callId"] ?? ""
            callUuidByCallId.removeValue(forKey: callId)
            callInfoByUuid.removeValue(forKey: action.callUUID)

            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                UNUserNotificationCenter.current().removeDeliveredNotifications(
                    withIdentifiers: ["lalia-call-\(callId)", "lalia-open-\(callId)"]
                )
                if !answeredCallIds.contains(callId) {
                    respondToCallOnBackend(callId: callId, action: "decline")
                    dispatchDismissedToWebView(callId: callId)
                } else if inLiveRoom {
                    inLiveRoom = false
                    DispatchQueue.main.async { [weak self] in
                        self?.webView?.evaluateJavaScript("window.location.href = '/v2/app';", completionHandler: nil)
                    }
                }
            }
        }
        currentlyRingingCallId = nil
        action.fulfill()
        clearNowPlayingInfo()
    }

    private func endCallKitCallIfActive(callId: String) {
        guard !callId.isEmpty, let uuid = callUuidByCallId[callId] else { return }
        callUuidByCallId.removeValue(forKey: callId)
        callInfoByUuid.removeValue(forKey: uuid)
        let endAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endAction)
        callController.request(transaction) { _ in }
    }

    private func endAllActiveCallKitCalls() {
        for (callId, uuid) in callUuidByCallId {
            let endAction = CXEndCallAction(call: uuid)
            callController.request(CXTransaction(action: endAction)) { _ in }
            UNUserNotificationCenter.current().removeDeliveredNotifications(
                withIdentifiers: ["lalia-call-\(callId)", "lalia-open-\(callId)"]
            )
        }
        callUuidByCallId.removeAll()
        callInfoByUuid.removeAll()
        clearNowPlayingInfo()
    }

    // MARK: - Local Notifications

    private func postAnsweredCallOpenBanner(
        callId: String,
        callerName: String,
        joinUrl: String,
        roomName: String
    ) {
        let content = UNMutableNotificationContent()
        content.title = "🟢 Connected with \(callerName)"
        content.body = "Tap to open live translation & video room"
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
            identifier: "lalia-open-\(callId)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
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

        currentlyRingingCallId = nil

        if response.actionIdentifier == "DECLINE_CALL" {
            sendDebugBeacon(event: "notification_declined", detail: ["callId": callId])
            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "decline")
                endCallKitCallIfActive(callId: callId)
                dispatchDismissedToWebView(callId: callId)
            }
        } else {
            sendDebugBeacon(event: "notification_answered", detail: ["callId": callId, "joinUrl": joinUrl])
            if !callId.isEmpty {
                answeredCallIds.insert(callId)
                dismissedCallIds.insert(callId)
                respondToCallOnBackend(callId: callId, action: "accept")
                endCallKitCallIfActive(callId: callId)
            }
            try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            pendingAnsweredJoinUrl = joinUrl
            pendingAnsweredRoomName = roomName
            pendingAnsweredCallId = callId
            navigateWebViewToCall(joinUrl: joinUrl, roomName: roomName, callId: callId)
        }
        completionHandler()
    }

    // MARK: - Lifecycle & Foreground Polling

    func applicationDidEnterBackground() {
        clearNowPlayingInfo()
        sendDebugBeacon(event: "entered_background", detail: [:])
    }

    func applicationDidBecomeActive() {
        clearNowPlayingInfo()
        if let joinUrl = pendingAnsweredJoinUrl {
            let roomName = pendingAnsweredRoomName ?? ""
            let callId = pendingAnsweredCallId ?? ""
            pendingAnsweredJoinUrl = nil
            pendingAnsweredRoomName = nil
            pendingAnsweredCallId = nil
            if !inLiveRoom {
                navigateWebViewToCall(joinUrl: joinUrl, roomName: roomName, callId: callId)
            }
        }
        pullAuthTokenFromWebView()
        sendDebugBeacon(event: "became_active", detail: [:])
        pollIncomingCallsNow()
    }

    private func startCallPolling() {
        DispatchQueue.main.async { [weak self] in
            self?.pollTimer?.invalidate()
            let timer = Timer(timeInterval: 2.5, repeats: true) { [weak self] _ in
                guard let self = self,
                      UIApplication.shared.applicationState == .active || self.currentlyRingingCallId != nil else { return }
                self.pullAuthTokenFromWebView()
                self.pollIncomingCallsNow()
            }
            RunLoop.main.add(timer, forMode: .common)
            self?.pollTimer = timer
        }
    }

    private func pollIncomingCallsNow() {
        guard let authToken = UserDefaults.standard.string(forKey: prefsAuthTokenKey),
              !authToken.isEmpty,
              let url = URL(string: "\(apiBaseUrl)/calls/incoming") else {
            return
        }

        pollCount += 1
        if pollCount == 1 || pollCount % 15 == 0 {
            sendDebugBeacon(event: "native_poll_heartbeat", detail: ["pollCount": pollCount])
        }

        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.timeoutInterval = 4.0
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("LaliaNativeIOS/9", forHTTPHeaderField: "X-Lalia-Client")

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
                        self.sendDebugBeacon(
                            event: "incoming_call_detected_native",
                            detail: ["callId": callId, "callerName": callerName]
                        )
                        self.reportIncomingCallToCallKit(
                            callId: callId,
                            callerName: callerName,
                            joinUrl: joinUrl,
                            roomName: roomName
                        )
                    }
                } else if let ringingId = self.currentlyRingingCallId {
                    self.currentlyRingingCallId = nil
                    if !self.answeredCallIds.contains(ringingId) {
                        self.endCallKitCallIfActive(callId: ringingId)
                    }
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
        inLiveRoom = true
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
            updateAuthToken(token)
        case "ringIncomingCall":
            let callId = (body["callId"] as? String) ?? UUID().uuidString
            let callerName = (body["callerName"] as? String) ?? "Someone"
            let joinUrl = (body["joinUrl"] as? String) ?? "https://lalia.cloud/v2/app"
            let roomName = (body["roomName"] as? String) ?? ""
            if currentlyRingingCallId != callId {
                reportIncomingCallToCallKit(
                    callId: callId,
                    callerName: callerName,
                    joinUrl: joinUrl,
                    roomName: roomName
                )
            }
        case "stopRing":
            let callId = (body["callId"] as? String) ?? (currentlyRingingCallId ?? "")
            if !callId.isEmpty {
                dismissedCallIds.insert(callId)
                answeredCallIds.insert(callId)
                UNUserNotificationCenter.current().removeDeliveredNotifications(
                    withIdentifiers: ["lalia-call-\(callId)"]
                )
            }
            currentlyRingingCallId = nil
        case "requestNotificationPermission":
            if let token = body["token"] as? String, !token.isEmpty {
                updateAuthToken(token)
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
