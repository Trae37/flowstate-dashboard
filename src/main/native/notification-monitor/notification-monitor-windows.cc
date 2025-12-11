#include <napi.h>
#include <windows.h>
#include <string>
#include <functional>
#include <sstream>
#include <iomanip>
#include <chrono>

// Note: WinRT requires C++/WinRT which needs special build setup
// For now, we'll use a simpler approach that can be enhanced later
// This implementation uses Windows APIs that are more compatible

// Forward declarations
class NotificationMonitor;

// Global callback storage
std::function<void(const std::string&, const std::string&, const std::string&)> g_callback;
NotificationMonitor* g_monitorInstance = nullptr;

// C++ class wrapper
class NotificationMonitor : public Napi::ObjectWrap<NotificationMonitor> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    NotificationMonitor(const Napi::CallbackInfo& info);
    ~NotificationMonitor();
    
    void OnNotificationReceived(const std::string& appName, 
                                const std::string& title, 
                                const std::string& body);
    
private:
    static Napi::FunctionReference constructor;
    Napi::FunctionReference callback_;
    bool isMonitoring_;
    
    Napi::Value Start(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    void SetupMonitoring();
};

Napi::FunctionReference NotificationMonitor::constructor;

Napi::Object NotificationMonitor::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "NotificationMonitor", {
        InstanceMethod("start", &NotificationMonitor::Start),
        InstanceMethod("stop", &NotificationMonitor::Stop),
    });
    
    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    
    exports.Set("NotificationMonitor", func);
    return exports;
}

NotificationMonitor::NotificationMonitor(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<NotificationMonitor>(info), isMonitoring_(false) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return;
    }
    
    Napi::Function cb = info[0].As<Napi::Function>();
    this->callback_ = Napi::Persistent(cb);
    
    // Store instance for callback
    g_monitorInstance = this;
    
    // Setup callback
    g_callback = [this](const std::string& appName, const std::string& title, const std::string& body) {
        this->OnNotificationReceived(appName, title, body);
    };
}

NotificationMonitor::~NotificationMonitor() {
    if (isMonitoring_) {
        Stop(Napi::CallbackInfo(nullptr, 0));
    }
}

void NotificationMonitor::SetupMonitoring() {
    // Note: Full WinRT implementation requires C++/WinRT which needs special setup
    // For now, this is a placeholder that will be enhanced
    // The actual monitoring will be done via polling or event-based approach
    
    // TODO: Implement UserNotificationListener API
    // This requires:
    // 1. C++/WinRT headers and libraries
    // 2. Windows 10 SDK 10.0.19041.0 or later
    // 3. Proper WinRT initialization
    
    isMonitoring_ = true;
}

Napi::Value NotificationMonitor::Start(const Napi::CallbackInfo& info) {
    if (!isMonitoring_) {
        SetupMonitoring();
    }
    return info.Env().Undefined();
}

Napi::Value NotificationMonitor::Stop(const Napi::CallbackInfo& info) {
    isMonitoring_ = false;
    return info.Env().Undefined();
}

void NotificationMonitor::OnNotificationReceived(const std::string& appName,
                                                  const std::string& title,
                                                  const std::string& body) {
    Napi::Env env = callback_.Env();
    Napi::HandleScope scope(env);
    
    try {
        Napi::Object notificationObj = Napi::Object::New(env);
        notificationObj.Set("appName", Napi::String::New(env, appName));
        notificationObj.Set("title", Napi::String::New(env, title));
        notificationObj.Set("body", Napi::String::New(env, body));
        
        // Get current timestamp
        auto now = std::chrono::system_clock::now();
        auto time_t = std::chrono::system_clock::to_time_t(now);
        std::stringstream ss;
        ss << std::put_time(std::gmtime(&time_t), "%Y-%m-%dT%H:%M:%SZ");
        notificationObj.Set("timestamp", Napi::String::New(env, ss.str()));
        
        // Call JavaScript callback
        callback_.Call({notificationObj});
    } catch (const std::exception& e) {
        // Error handling
    }
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return NotificationMonitor::Init(env, exports);
}

NODE_API_MODULE(notification_monitor, Init)

