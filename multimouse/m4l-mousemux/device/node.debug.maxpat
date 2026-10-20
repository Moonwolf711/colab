{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 0,
      "revision": 10,
      "architecture": "x64"
    },
    "rect": [
      100,
      100,
      340,
      200
    ],
    "boxes": [
      {
        "box": {
          "id": "in",
          "maxclass": "inlet",
          "patching_rect": [
            30,
            25,
            30,
            30
          ],
          "numinlets": 0,
          "numoutlets": 1
        }
      },
      {
        "box": {
          "id": "prefix",
          "maxclass": "newobj",
          "text": "prepend debug",
          "patching_rect": [
            30,
            65,
            100,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1
        }
      },
      {
        "box": {
          "id": "port",
          "maxclass": "newobj",
          "text": "append #1",
          "patching_rect": [
            30,
            100,
            100,
            22
          ],
          "numinlets": 1,
          "numoutlets": 1
        }
      },
      {
        "box": {
          "id": "out",
          "maxclass": "outlet",
          "patching_rect": [
            30,
            140,
            30,
            30
          ],
          "numinlets": 1,
          "numoutlets": 0
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "in",
            0
          ],
          "destination": [
            "prefix",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "prefix",
            0
          ],
          "destination": [
            "port",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "port",
            0
          ],
          "destination": [
            "out",
            0
          ]
        }
      }
    ]
  }
}