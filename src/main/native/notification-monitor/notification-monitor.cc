#include <napi.h>
#include "notification-monitor.h"

// This file serves as the main entry point
// Platform-specific implementations are in:
// - notification-monitor-macos.mm (macOS)
// - notification-monitor-windows.cc (Windows)

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  // Platform-specific initialization happens in platform files
  return exports;
}

NODE_API_MODULE(notification_monitor, Init)





