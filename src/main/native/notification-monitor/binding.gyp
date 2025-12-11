{
  "targets": [
    {
      "target_name": "notification-monitor",
      "sources": [
        "notification-monitor.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.14"
      },
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "notification-monitor-macos.mm"
          ],
          "frameworks": [
            "UserNotifications.framework",
            "Foundation.framework",
            "AppKit.framework"
          ]
        }],
        ["OS=='win'", {
          "sources": [
            "notification-monitor-windows.cc"
          ],
          "libraries": [
            "windowsapp.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [
                "/std:c++17",
                "/permissive-"
              ]
            }
          },
          "defines": [
            "_WIN32_WINNT=0x0A00",
            "WINAPI_FAMILY=WINAPI_FAMILY_APP"
          ]
        }]
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}

