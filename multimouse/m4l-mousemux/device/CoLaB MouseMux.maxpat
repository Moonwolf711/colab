{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 10,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      100,
      100,
      750,
      680
    ],
    "openrect": [
      0,
      0,
      620,
      169
    ],
    "devicewidth": 620,
    "openinpresentation": 1,
    "default_fontsize": 11,
    "default_fontname": "Arial",
    "gridsize": [
      8,
      8
    ],
    "subpatcher_template": "AbletonLive",
    "description": "Native MouseMux control and two-mouse status for Ableton Live",
    "digest": "Controls the installed MouseMux engine; MIDI passes through.",
    "boxes": [
      {
        "box": {
          "id": "panel",
          "maxclass": "v8ui",
          "patching_rect": [
            12,
            12,
            620,
            169
          ],
          "numinlets": 1,
          "numoutlets": 0,
          "parameter_enable": 0,
          "presentation": 1,
          "presentation_rect": [
            0,
            0,
            620,
            169
          ],
          "background": 1,
          "ignoreclick": 1,
          "filename": "colab-mousemux-panel.js",
          "textfile": {
            "filename": "colab-mousemux-panel.js",
            "flags": 0,
            "embed": 0,
            "autowatch": 0
          }
        }
      },
      {
        "box": {
          "id": "launch",
          "maxclass": "live.text",
          "patching_rect": [
            15,
            230,
            106,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            12,
            123,
            106,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Start MouseMux",
          "texton": "Start MouseMux",
          "annotation_name": "Start MouseMux",
          "annotation": "Open the installed MouseMux application; then click Connect.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "launch-message",
          "maxclass": "message",
          "patching_rect": [
            15,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "startmousemux",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "connect",
          "maxclass": "live.text",
          "patching_rect": [
            103,
            230,
            70,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            124,
            123,
            70,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Connect",
          "texton": "Connect",
          "annotation_name": "Connect",
          "annotation": "Connect to the installed MouseMux Web SDK without changing its mode.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "connect-message",
          "maxclass": "message",
          "patching_rect": [
            103,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "connect",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "disconnect",
          "maxclass": "live.text",
          "patching_rect": [
            191,
            230,
            80,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            200,
            123,
            80,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Disconnect",
          "texton": "Disconnect",
          "annotation_name": "Disconnect",
          "annotation": "Disconnect this controller; leave MouseMux's desktop mode unchanged.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "disconnect-message",
          "maxclass": "message",
          "patching_rect": [
            191,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "disconnect",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "refresh",
          "maxclass": "live.text",
          "patching_rect": [
            279,
            230,
            58,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            286,
            123,
            58,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Refresh",
          "texton": "Refresh",
          "annotation_name": "Refresh",
          "annotation": "Read the current MouseMux mode and physical mouse users.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "refresh-message",
          "maxclass": "message",
          "patching_rect": [
            279,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "refresh",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "native",
          "maxclass": "live.text",
          "patching_rect": [
            367,
            230,
            68,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            350,
            123,
            68,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Native",
          "texton": "Native",
          "annotation_name": "Native",
          "annotation": "Requests a desktop-wide MouseMux mode. Wait for the reported mode above.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "native-message",
          "maxclass": "message",
          "patching_rect": [
            367,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "mode native",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "switched",
          "maxclass": "live.text",
          "patching_rect": [
            455,
            230,
            78,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            424,
            123,
            78,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Switched",
          "texton": "Switched",
          "annotation_name": "Switched",
          "annotation": "Requests a desktop-wide MouseMux mode. Wait for the reported mode above.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "switched-message",
          "maxclass": "message",
          "patching_rect": [
            455,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "mode switched",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "multiplex",
          "maxclass": "live.text",
          "patching_rect": [
            543,
            230,
            84,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "presentation": 1,
          "presentation_rect": [
            508,
            123,
            84,
            23
          ],
          "mode": 0,
          "parameter_enable": 0,
          "parameter_mappable": 0,
          "text": "Multiplex",
          "texton": "Multiplex",
          "annotation_name": "Multiplex",
          "annotation": "Requests a desktop-wide MouseMux mode. Wait for the reported mode above.",
          "outlettype": [
            "bang",
            ""
          ],
          "fontsize": 10,
          "activebgcolor": [
            0.24,
            0.27,
            0.31,
            1
          ],
          "activebgoncolor": [
            0.35,
            0.55,
            0.48,
            1
          ],
          "activetextcolor": [
            0.92,
            0.94,
            0.96,
            1
          ],
          "activetextoncolor": [
            1,
            1,
            1,
            1
          ]
        }
      },
      {
        "box": {
          "id": "multiplex-message",
          "maxclass": "message",
          "patching_rect": [
            543,
            300,
            85,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "mode multiplex",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "manager",
          "maxclass": "newobj",
          "patching_rect": [
            15,
            380,
            470,
            22
          ],
          "numinlets": 1,
          "numoutlets": 2,
          "text": "node.script colab-mousemux-manager.js @autostart 1 @watch 0 @restart 0 @defer 1",
          "outlettype": [
            "",
            ""
          ],
          "saved_object_attributes": {
            "autostart": 1,
            "watch": 0,
            "restart": 0,
            "defer": 1
          }
        }
      },
      {
        "box": {
          "id": "node-status",
          "maxclass": "newobj",
          "patching_rect": [
            480,
            415,
            114,
            22
          ],
          "numinlets": 1,
          "numoutlets": 0,
          "text": "print MouseMux-Node",
          "outlettype": []
        }
      },
      {
        "box": {
          "id": "thisdevice",
          "maxclass": "newobj",
          "patching_rect": [
            15,
            450,
            90,
            22
          ],
          "numinlets": 1,
          "numoutlets": 3,
          "text": "live.thisdevice",
          "outlettype": [
            "",
            "",
            ""
          ]
        }
      },
      {
        "box": {
          "id": "defer-init",
          "maxclass": "newobj",
          "patching_rect": [
            15,
            480,
            65,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "text": "deferlow",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "init",
          "maxclass": "message",
          "patching_rect": [
            15,
            510,
            40,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "init",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "host",
          "maxclass": "newobj",
          "patching_rect": [
            15,
            540,
            150,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "text": "v8 colab-mousemux-host.js",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "midi-in",
          "maxclass": "newobj",
          "patching_rect": [
            320,
            450,
            65,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "text": "midiin",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "midi-out",
          "maxclass": "newobj",
          "patching_rect": [
            320,
            485,
            65,
            22
          ],
          "numinlets": 1,
          "numoutlets": 0,
          "text": "midiout",
          "outlettype": []
        }
      },
      {
        "box": {
          "id": "free",
          "maxclass": "newobj",
          "patching_rect": [
            450,
            450,
            65,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "text": "freebang",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "stop",
          "maxclass": "message",
          "patching_rect": [
            450,
            480,
            40,
            22
          ],
          "numinlets": 2,
          "numoutlets": 1,
          "text": "stop",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "debug-toggle",
          "maxclass": "toggle",
          "patching_rect": [
            450,
            545,
            20,
            20
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "int"
          ],
          "parameter_enable": 0
        }
      },
      {
        "box": {
          "id": "debug",
          "maxclass": "newobj",
          "patching_rect": [
            480,
            545,
            90,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1,
          "text": "node.debug 9229",
          "outlettype": [
            ""
          ]
        }
      },
      {
        "box": {
          "id": "debug-label",
          "maxclass": "comment",
          "patching_rect": [
            450,
            575,
            275,
            38
          ],
          "numinlets": 1,
          "numoutlets": 0,
          "text": "Optional local Node inspector. Off by default.\nnode.debug is the supplied abstraction."
        }
      },
      {
        "box": {
          "id": "scope",
          "maxclass": "comment",
          "patching_rect": [
            15,
            605,
            650,
            40
          ],
          "numinlets": 1,
          "numoutlets": 0,
          "text": "Installed MouseMux performs all cursor operations. Loading or removing this device does not change desktop mode.\nUse Native explicitly to restore standard MouseMux behavior."
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "launch",
            0
          ],
          "destination": [
            "launch-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "launch-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "connect",
            0
          ],
          "destination": [
            "connect-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "connect-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "disconnect",
            0
          ],
          "destination": [
            "disconnect-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "disconnect-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "refresh",
            0
          ],
          "destination": [
            "refresh-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "refresh-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "native",
            0
          ],
          "destination": [
            "native-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "native-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "switched",
            0
          ],
          "destination": [
            "switched-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "switched-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "multiplex",
            0
          ],
          "destination": [
            "multiplex-message",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "multiplex-message",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "manager",
            0
          ],
          "destination": [
            "panel",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "manager",
            1
          ],
          "destination": [
            "node-status",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "thisdevice",
            0
          ],
          "destination": [
            "defer-init",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "defer-init",
            0
          ],
          "destination": [
            "init",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "init",
            0
          ],
          "destination": [
            "host",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "host",
            0
          ],
          "destination": [
            "panel",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "midi-in",
            0
          ],
          "destination": [
            "midi-out",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "free",
            0
          ],
          "destination": [
            "stop",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "stop",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "debug-toggle",
            0
          ],
          "destination": [
            "debug",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "debug",
            0
          ],
          "destination": [
            "manager",
            0
          ]
        }
      }
    ],
    "dependency_cache": [
      {
        "name": "colab-mousemux-manager.js",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "colab-mousemux-panel.js",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "colab-mousemux-host.js",
        "type": "TEXT",
        "implicit": 1
      },
      {
        "name": "node.debug.maxpat",
        "type": "JSON",
        "implicit": 1
      }
    ],
    "autosave": 0
  }
}